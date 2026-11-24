import { randomUUID } from 'node:crypto'
import { streamRestorer, Vault } from '@switchyard/pii'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import { keyring } from './auth.js'
import { type Config, TIERS, type Tier } from './config.js'
import { costMicros, GROUPS, type Ledger, monthOf } from './finops/ledger.js'
import {
  type Adapter,
  type Delta,
  type Fetch,
  type Message,
  ProviderError,
  type Usage,
} from './providers/types.js'
import { Breakers } from './routing/breaker.js'
import { classify } from './routing/classify.js'
import {
  adapters,
  type Candidate,
  candidates,
  firstAvailable,
  NoRoute,
} from './routing/dispatch.js'

export interface Deps {
  config: Config
  ledger: Ledger
  fetch?: Fetch
  env?: NodeJS.ProcessEnv
  now?: () => number
}

const text = z.union([
  z.string(),
  z
    .array(z.object({ type: z.literal('text'), text: z.string() }))
    .transform((parts) => parts.map((p) => p.text).join('')),
])

const completionBody = z.object({
  model: z.string().default('auto'),
  messages: z
    .array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: text }))
    .min(1),
  max_tokens: z.number().int().positive().max(64_000).default(1024),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().default(false),
})

const FEATURE = /^[a-z0-9][a-z0-9._-]{0,63}$/

class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

interface Vars {
  Variables: { team: string; requestId: string }
}

export function createApp({
  config,
  ledger,
  fetch = globalThis.fetch,
  env = process.env,
  now = Date.now,
}: Deps) {
  const teamFor = keyring(config)
  const breakers = new Breakers(now)
  const providers = adapters(config, fetch, env)

  const app = new Hono<Vars>()

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(
        { error: { message: err.message, type: 'switchyard_error', code: err.code } },
        err.status,
      )
    }
    if (err instanceof NoRoute) {
      return c.json(
        { error: { message: err.message, type: 'switchyard_error', code: 'no_route' } },
        503,
      )
    }
    if (err instanceof ProviderError) {
      return c.json(
        { error: { message: err.message, type: 'upstream_error', code: err.status } },
        502,
      )
    }
    if (err instanceof z.ZodError) {
      return c.json(
        { error: { message: z.prettifyError(err), type: 'invalid_request_error', code: null } },
        400,
      )
    }
    process.stderr.write(`${c.get('requestId')} ${err.stack ?? err}\n`)
    return c.json(
      { error: { message: 'internal error', type: 'switchyard_error', code: null } },
      500,
    )
  })

  app.get('/healthz', (c) => c.json({ ok: true, breakers: breakers.snapshot() }))

  app.use('/v1/*', async (c, next) => {
    c.set('requestId', randomUUID())
    const team = teamFor(c.req.header('authorization')?.replace(/^Bearer\s+/i, ''))
    if (!team) throw new ApiError(401, 'invalid_api_key', 'unknown API key')
    c.set('team', team)
    await next()
  })

  app.post('/v1/chat/completions', async (c) => {
    const started = now()
    const teamName = c.get('team')
    const team = config.teams[teamName]
    if (!team) throw new ApiError(401, 'invalid_api_key', 'unknown team')
    const body = completionBody.parse(await c.req.json())

    const feature = c.req.header('x-switchyard-feature') ?? 'untagged'
    if (!FEATURE.test(feature))
      throw new ApiError(400, 'bad_feature', 'x-switchyard-feature must be a slug')

    const month = monthOf(new Date(started))
    if (ledger.spentMicros(teamName, month) >= team.budgetUsd * 1_000_000) {
      throw new ApiError(
        402,
        'budget_exceeded',
        `${teamName} has used its $${team.budgetUsd} for ${month}`,
      )
    }

    // Redaction happens before routing on purpose: nothing below this line,
    // logs included, ever sees the original values.
    const vault = new Vault()
    const messages: Message[] =
      team.pii === 'off'
        ? body.messages
        : body.messages.map((m) => ({ ...m, content: vault.redact(m.content) }))
    if (team.pii === 'block' && vault.size > 0) {
      throw new ApiError(
        422,
        'pii_blocked',
        `request contains personal data: ${Object.keys(vault.counts).join(', ')}`,
      )
    }

    const { tier, list, reasons } = route(body.model, messages, body.max_tokens, teamName)
    // Client disconnect or provider timeout, whichever comes first.
    const signal = (cand: Candidate) =>
      AbortSignal.any([
        c.req.raw.signal,
        AbortSignal.timeout(config.providers[cand.model.provider]?.timeoutMs ?? 60_000),
      ])
    const request = (cand: Candidate) => ({
      model: cand.model.id,
      messages,
      maxTokens: body.max_tokens,
      ...(body.temperature !== undefined && { temperature: body.temperature }),
    })
    const adapter = (cand: Candidate) => providers.get(cand.model.provider) as Adapter

    const record = (
      cand: Candidate,
      usage: Usage,
      status: number,
      fallbacks: number,
      estimated: boolean,
    ) => {
      const cost = costMicros(cand.model, usage)
      ledger.record({
        at: new Date(started),
        team: teamName,
        feature,
        tier,
        model: cand.name,
        provider: cand.model.provider,
        inputTokens: usage.input,
        outputTokens: usage.output,
        costMicros: cost,
        latencyMs: Math.round(now() - started),
        status,
        redactions: vault.size,
        fallbacks,
        estimated,
      })
      return cost
    }

    const routed = (cand: Candidate, fallbacks: number) => {
      c.header('x-switchyard-tier', tier)
      c.header('x-switchyard-model', cand.name)
      c.header('x-switchyard-redactions', String(vault.size))
      c.header('x-switchyard-fallbacks', String(fallbacks))
      c.header('x-switchyard-route', reasons.join('; ') || 'pinned')
    }

    const id = `chatcmpl-sy-${c.get('requestId')}`
    const created = Math.floor(now() / 1000)

    if (!body.stream) {
      const { value, candidate, skipped } = await firstAvailable(list, breakers, (cand) =>
        adapter(cand).complete(request(cand), signal(cand)),
      )
      const cost = record(candidate, value.usage, 200, skipped.length, false)
      routed(candidate, skipped.length)
      c.header('x-switchyard-cost-micros', String(cost))
      return c.json({
        id,
        object: 'chat.completion',
        created,
        model: candidate.name,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: vault.restore(value.text) },
            finish_reason: value.finish,
          },
        ],
        usage: {
          prompt_tokens: value.usage.input,
          completion_tokens: value.usage.output,
          total_tokens: value.usage.input + value.usage.output,
        },
      })
    }

    // Fallback is only possible before the first byte: once a client has
    // seen tokens from one model, switching models mid-answer is worse than
    // failing.
    const {
      value: deltas,
      candidate,
      skipped,
    } = await firstAvailable(list, breakers, (cand) =>
      adapter(cand).stream(request(cand), signal(cand)),
    )
    routed(candidate, skipped.length)

    return streamSSE(c, async (sse) => {
      const restorer = streamRestorer(vault)
      const chunk = (delta: object, finish: string | null = null) =>
        sse.writeSSE({
          data: JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model: candidate.name,
            choices: [{ index: 0, delta, finish_reason: finish }],
          }),
        })

      let produced = ''
      let end: Extract<Delta, { type: 'end' }> | undefined
      try {
        for await (const d of deltas) {
          if (d.type === 'end') {
            end = d
            break
          }
          produced += d.text
          const out = restorer.push(d.text)
          if (out) await chunk({ content: out })
        }
        const rest = restorer.flush()
        if (rest) await chunk({ content: rest })
        await chunk({}, end?.finish ?? 'stop')
      } catch (err) {
        await sse.writeSSE({
          data: JSON.stringify({ error: { message: 'upstream stream failed' } }),
        })
        process.stderr.write(`${c.get('requestId')} stream: ${err}\n`)
      }

      const usage = end?.usage ?? {
        input: Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4),
        output: Math.ceil(produced.length / 4),
      }
      record(candidate, usage, end ? 200 : 502, skipped.length, !end?.usage)
      await sse.writeSSE({ data: '[DONE]' })
    })
  })

  app.get('/v1/usage', (c) => {
    const teamName = c.get('team')
    const month = c.req.query('month') ?? monthOf(new Date(now()))
    const group = c.req.query('group_by') ?? 'feature'
    if (!/^\d{4}-\d{2}$/.test(month)) throw new ApiError(400, 'bad_month', 'month must be YYYY-MM')
    if (!(GROUPS as readonly string[]).includes(group)) {
      throw new ApiError(400, 'bad_group', `group_by must be one of ${GROUPS.join(', ')}`)
    }
    const admin = config.teams[teamName]?.admin ?? false
    const rows = ledger.breakdown(
      month,
      group as (typeof GROUPS)[number],
      admin ? undefined : teamName,
    )
    return c.json({ month, group_by: group, scope: admin ? 'all' : teamName, rows })
  })

  function route(requested: string, messages: Message[], maxTokens: number, teamName: string) {
    const team = config.teams[teamName]
    if (!team) throw new ApiError(401, 'invalid_api_key', 'unknown team')

    let tier: Tier
    let reasons: string[] = []
    let list: Candidate[]
    if (requested === 'auto') {
      const verdict = classify(messages, maxTokens)
      tier = verdict.tier
      reasons = [`score ${verdict.score}`, ...verdict.reasons]
      list = candidates(config, tier, team)
    } else if ((TIERS as readonly string[]).includes(requested)) {
      tier = requested as Tier
      list = candidates(config, tier, team)
    } else if (config.models[requested]) {
      tier = (TIERS.find((t) => config.tiers[t]?.includes(requested)) ?? 'balanced') as Tier
      list = candidates(config, tier, team).filter((cand) => cand.name === requested)
    } else {
      throw new ApiError(400, 'model_not_found', `unknown model or tier: ${requested}`)
    }
    if (list.length === 0) throw new NoRoute([])
    return { tier, list, reasons }
  }

  return app
}
