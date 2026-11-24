import { describe, expect, it } from 'vitest'
import { boot, json, KEYS, reply } from './upstream.js'

const TRIAGE = 'Classify this ticket as billing, bug or other: "my invoice is wrong"'
const HARD =
  'Why does our checkout deadlock under load? Compare the two locking designs, analyse the trade-offs ' +
  'and plan the migration step by step.'

describe('auth', () => {
  it('rejects unknown keys before anything else happens', async () => {
    const t = boot()
    const res = await t.chat('sy_nope', t.ask('hi'))
    expect(res.status).toBe(401)
    expect(t.calls).toEqual([])
  })
})

describe('personal data', () => {
  it('never lets the original value leave, and puts it back in the answer', async () => {
    const t = boot()
    t.handlers['anthropic.test'] = (body) => {
      const sent = JSON.stringify(body)
      return reply.anthropic(`Done, I emailed ${sent.match(/⟦EMAIL_\d⟧/)?.[0]}.`)
    }
    const res = await t.chat(KEYS.finance, {
      model: 'claude-sonnet',
      ...t.ask('Send the refund to jeanne.martin@acme.fr, IBAN FR7630006000011234567890189'),
    })
    const answer = await json(res)

    const upstream = JSON.stringify(t.calls[0]?.body)
    expect(upstream).not.toContain('jeanne.martin@acme.fr')
    expect(upstream).not.toContain('FR7630006000011234567890189')
    expect(upstream).toContain('⟦EMAIL_1⟧')
    expect(upstream).toContain('⟦IBAN_1⟧')
    expect(answer.choices[0].message.content).toBe('Done, I emailed jeanne.martin@acme.fr.')
    expect(res.headers.get('x-switchyard-redactions')).toBe('2')
  })

  it('refuses outright for teams on the block policy', async () => {
    const t = boot()
    const res = await t.chat(KEYS.legal, t.ask('Client NIR is 2 69 05 49 588 157 80'))
    expect(res.status).toBe(422)
    expect((await json(res)).error.code).toBe('pii_blocked')
    expect(t.calls).toEqual([])
  })
})

describe('routing', () => {
  it('sends triage to the fast tier and reasoning to the big model', async () => {
    const t = boot()
    const easy = await t.chat(KEYS.finance, t.ask(TRIAGE))
    const hard = await t.chat(KEYS.finance, t.ask(HARD))
    expect(easy.headers.get('x-switchyard-tier')).toBe('fast')
    expect(easy.headers.get('x-switchyard-model')).toBe('mistral-small')
    expect(hard.headers.get('x-switchyard-tier')).toBe('reasoning')
    expect(hard.headers.get('x-switchyard-model')).toBe('claude-opus')
    expect(t.calls.map((c) => c.body.model)).toEqual(['mistral-small-latest', 'claude-opus-5-5'])
  })

  it('keeps an EU-only team inside the EU even for hard questions', async () => {
    const t = boot()
    const res = await t.chat(KEYS.support, t.ask(HARD))
    expect(res.headers.get('x-switchyard-model')).toBe('mistral-large')
    expect(t.calls.every((c) => c.host === 'mistral.test')).toBe(true)
  })

  it('refuses a pinned model that breaks residency instead of quietly swapping it', async () => {
    const t = boot()
    const res = await t.chat(KEYS.support, { model: 'claude-opus', ...t.ask('hi') })
    expect(res.status).toBe(503)
    expect((await json(res)).error.code).toBe('no_route')
  })

  it('translates the system prompt into the Messages API shape', async () => {
    const t = boot()
    await t.chat(KEYS.finance, {
      model: 'claude-sonnet',
      messages: [
        { role: 'system', content: 'Answer in French.' },
        { role: 'user', content: 'hello' },
      ],
    })
    expect(t.calls[0]?.body).toMatchObject({
      system: 'Answer in French.',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 1024,
    })
  })
})

describe('fallback', () => {
  it('moves to the next vendor on a 5xx and says so', async () => {
    const t = boot()
    t.handlers['anthropic.test'] = () => reply.status(529)
    const res = await t.chat(KEYS.finance, { model: 'balanced', ...t.ask('hello') })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-switchyard-model')).toBe('mistral-large')
    expect(res.headers.get('x-switchyard-fallbacks')).toBe('1')
  })

  it('stops calling a vendor once its breaker opens, and probes again after the cooldown', async () => {
    const t = boot()
    t.handlers['anthropic.test'] = () => reply.status(503)
    for (let i = 0; i < 3; i++) await t.chat(KEYS.finance, { model: 'balanced', ...t.ask('hello') })
    const before = t.calls.filter((c) => c.host === 'anthropic.test').length

    await t.chat(KEYS.finance, { model: 'balanced', ...t.ask('hello') })
    expect(t.calls.filter((c) => c.host === 'anthropic.test').length).toBe(before)

    t.advance(30_000)
    t.handlers['anthropic.test'] = () => reply.anthropic('back')
    const res = await t.chat(KEYS.finance, { model: 'balanced', ...t.ask('hello') })
    expect(res.headers.get('x-switchyard-model')).toBe('claude-sonnet')
  })

  it('does not retry a request the vendor rejected as malformed', async () => {
    const t = boot()
    t.handlers['anthropic.test'] = () => reply.status(400)
    const res = await t.chat(KEYS.finance, { model: 'balanced', ...t.ask('hello') })
    expect(res.status).toBe(502)
    expect(t.calls.map((c) => c.host)).toEqual(['anthropic.test'])
  })
})

describe('finops', () => {
  it('charges each request to team and feature in integer micro-dollars', async () => {
    const t = boot()
    const res = await t.chat(
      KEYS.finance,
      { model: 'claude-sonnet', ...t.ask('hi') },
      { 'x-switchyard-feature': 'invoice-ocr' },
    )
    // 120 in × $3/M + 40 out × $15/M = 360 + 600 µ$
    expect(res.headers.get('x-switchyard-cost-micros')).toBe('960')

    const usage = await t.app.request('/v1/usage?group_by=feature', {
      headers: { authorization: `Bearer ${KEYS.finance}` },
    })
    expect((await json(usage)).rows).toEqual([
      expect.objectContaining({ key: 'invoice-ocr', requests: 1, cost_micros: 960 }),
    ])
  })

  it('cuts a team off once its monthly budget is spent', async () => {
    const t = boot()
    expect((await t.chat(KEYS.growth, t.ask(TRIAGE))).status).toBe(200)
    const res = await t.chat(KEYS.growth, t.ask(TRIAGE))
    expect(res.status).toBe(402)
    expect((await json(res)).error.code).toBe('budget_exceeded')
  })

  it('shows a team only its own spend, and admins everything', async () => {
    const t = boot()
    await t.chat(KEYS.support, t.ask(TRIAGE))
    await t.chat(KEYS.finance, t.ask(TRIAGE))
    const read = async (key: string) =>
      (
        await json(
          await t.app.request('/v1/usage?group_by=team', {
            headers: { authorization: `Bearer ${key}` },
          }),
        )
      ).rows.map((r: { key: string }) => r.key)
    expect(await read(KEYS.support)).toEqual(['support'])
    expect((await read(KEYS.finance)).sort()).toEqual(['finance', 'support'])
  })

  it('rejects anything but a known grouping column', async () => {
    const t = boot()
    const res = await t.app.request('/v1/usage?group_by=team;drop table usage', {
      headers: { authorization: `Bearer ${KEYS.finance}` },
    })
    expect(res.status).toBe(400)
  })
})

describe('streaming', () => {
  const collect = async (res: Response) => {
    const text = await res.text()
    const frames = text
      .split('\n\n')
      .map((f) => f.replace(/^data: /, '').trim())
      .filter(Boolean)
    const done = frames.at(-1)
    const chunks = frames.slice(0, -1).map((f) => JSON.parse(f))
    return { done, chunks, content: chunks.map((c) => c.choices[0].delta.content ?? '').join('') }
  }

  it('re-emits Anthropic events as OpenAI chunks and restores split tokens', async () => {
    const t = boot()
    t.handlers['anthropic.test'] = () =>
      reply.anthropicStream(['Wrote to ⟦EM', 'AIL_1', '⟧, done.'])
    const res = await t.chat(KEYS.finance, {
      model: 'claude-sonnet',
      stream: true,
      ...t.ask('Reply to bo@corp.io'),
    })
    const { done, chunks, content } = await collect(res)
    expect(content).toBe('Wrote to bo@corp.io, done.')
    expect(chunks.at(-1).choices[0].finish_reason).toBe('stop')
    expect(done).toBe('[DONE]')

    const [row] = t.ledger.breakdown('2026-11', 'model') as { key: string; input_tokens: number }[]
    expect(row).toMatchObject({ key: 'claude-sonnet', input_tokens: 90 })
  })

  it('takes usage from the final OpenAI chunk', async () => {
    const t = boot()
    t.handlers['mistral.test'] = () => reply.openaiStream(['Bon', 'jour'])
    const res = await t.chat(KEYS.support, {
      model: 'mistral-small',
      stream: true,
      ...t.ask('salut'),
    })
    expect((await collect(res)).content).toBe('Bonjour')
    const [row] = t.ledger.breakdown('2026-11', 'model') as { output_tokens: number }[]
    expect(row?.output_tokens).toBe(21)
  })
})
