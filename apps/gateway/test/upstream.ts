import { createHash } from 'node:crypto'
import { createApp } from '../src/app.js'
import { parseConfig } from '../src/config.js'
import { Ledger } from '../src/finops/ledger.js'

const hash = (key: string) => createHash('sha256').update(key).digest('hex')

export const KEYS = {
  support: 'sy_support',
  growth: 'sy_growth',
  legal: 'sy_legal',
  finance: 'sy_finance',
}

export const config = parseConfig({
  providers: {
    anthropic: { kind: 'anthropic', baseUrl: 'https://anthropic.test', region: 'us' },
    mistral: { kind: 'openai', baseUrl: 'https://mistral.test/v1', region: 'eu' },
  },
  models: {
    'mistral-small': {
      provider: 'mistral',
      id: 'mistral-small-latest',
      price: { input: 0.1, output: 0.3 },
    },
    'mistral-large': {
      provider: 'mistral',
      id: 'mistral-large-latest',
      price: { input: 2, output: 6 },
    },
    'claude-haiku': {
      provider: 'anthropic',
      id: 'claude-haiku-5-5',
      price: { input: 1, output: 5 },
    },
    'claude-sonnet': {
      provider: 'anthropic',
      id: 'claude-sonnet-5-5',
      price: { input: 3, output: 15 },
    },
    'claude-opus': {
      provider: 'anthropic',
      id: 'claude-opus-5-5',
      price: { input: 15, output: 75 },
    },
  },
  tiers: {
    fast: ['mistral-small', 'claude-haiku'],
    balanced: ['claude-sonnet', 'mistral-large'],
    reasoning: ['claude-opus', 'mistral-large'],
  },
  teams: {
    support: { keys: [hash(KEYS.support)], budgetUsd: 50, residency: ['eu'] },
    growth: { keys: [hash(KEYS.growth)], budgetUsd: 0.00002 },
    legal: { keys: [hash(KEYS.legal)], budgetUsd: 50, pii: 'block' },
    finance: { keys: [hash(KEYS.finance)], budgetUsd: 50, admin: true },
  },
})

type Handler = (body: Record<string, unknown>) => Response | Promise<Response>

const sse = (frames: unknown[]) =>
  new Response(
    new ReadableStream({
      start(ctrl) {
        const enc = new TextEncoder()
        for (const f of frames)
          ctrl.enqueue(enc.encode(`data: ${typeof f === 'string' ? f : JSON.stringify(f)}\n\n`))
        ctrl.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )

export const reply = {
  anthropic: (text: string, usage = { input_tokens: 120, output_tokens: 40 }) =>
    Response.json({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage }),
  openai: (text: string, usage = { prompt_tokens: 120, completion_tokens: 40 }) =>
    Response.json({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage }),
  anthropicStream: (pieces: string[]) =>
    sse([
      { type: 'message_start', message: { usage: { input_tokens: 90 } } },
      ...pieces.map((text) => ({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text },
      })),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 33 } },
      { type: 'message_stop' },
    ]),
  openaiStream: (pieces: string[]) =>
    sse([
      ...pieces.map((content) => ({ choices: [{ delta: { content }, finish_reason: null }] })),
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: null },
      { choices: [], usage: { prompt_tokens: 70, completion_tokens: 21 } },
      '[DONE]',
    ]),
  status: (code: number) => new Response('upstream says no', { status: code }),
}

/**
 * A fake internet with two vendors. Each test sets what they answer and
 * reads back exactly what the gateway sent them.
 */
export function boot() {
  const calls: { host: string; body: Record<string, unknown> }[] = []
  const handlers: Record<string, Handler> = {
    'anthropic.test': () => reply.anthropic('hello from anthropic'),
    'mistral.test': () => reply.openai('hello from mistral'),
  }
  let clock = Date.parse('2026-11-24T10:00:00Z')

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const host = new URL(String(input)).host
    const body = JSON.parse(String(init?.body))
    calls.push({ host, body })
    const handler = handlers[host]
    if (!handler) throw new TypeError(`fetch failed: ${host}`)
    return handler(body)
  }) as typeof globalThis.fetch

  const ledger = new Ledger(':memory:')
  const app = createApp({ config, ledger, fetch, env: {}, now: () => clock })

  async function chat(
    key: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
    return res
  }

  const ask = (content: string, extra: Record<string, unknown> = {}) => ({
    messages: [{ role: 'user', content }],
    ...extra,
  })

  return {
    app,
    ledger,
    calls,
    handlers,
    chat,
    ask,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

// biome-ignore lint/suspicious/noExplicitAny: response bodies are asserted on, not modelled
export const json = (res: Response): Promise<any> => res.json()
