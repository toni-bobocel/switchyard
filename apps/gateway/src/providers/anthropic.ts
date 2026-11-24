import { events, post } from './http.js'
import type { Adapter, ChatRequest, Delta, Fetch, Usage } from './types.js'

// Messages API: system prompt is a top-level field, not a message, and
// max_tokens is mandatory. Stop reasons are mapped to OpenAI's vocabulary
// so clients see one dialect whatever answered.

const API_VERSION = '2023-06-01'

const finishReason: Record<string, string> = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  max_tokens: 'length',
  tool_use: 'tool_calls',
}

type Event =
  | { type: 'message_start'; message: { usage: { input_tokens: number } } }
  | { type: 'content_block_delta'; delta: { type: string; text?: string } }
  | {
      type: 'message_delta'
      delta: { stop_reason: string | null }
      usage: { output_tokens: number }
    }
  | { type: string }

export function anthropic(fetch: Fetch, baseUrl: string, apiKey: string | undefined): Adapter {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`
  const headers = { 'x-api-key': apiKey ?? '', 'anthropic-version': API_VERSION }
  const body = (req: ChatRequest, stream: boolean) => {
    const system = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    return {
      model: req.model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      ...(system && { system }),
      messages: req.messages.filter((m) => m.role !== 'system'),
      stream,
    }
  }

  return {
    async complete(req, signal) {
      const res = await post(fetch, url, headers, body(req, false), signal)
      const json = (await res.json()) as {
        content: { type: string; text?: string }[]
        stop_reason: string
        usage: { input_tokens: number; output_tokens: number }
      }
      return {
        text: json.content.map((b) => b.text ?? '').join(''),
        finish: finishReason[json.stop_reason] ?? 'stop',
        usage: { input: json.usage.input_tokens, output: json.usage.output_tokens },
      }
    },

    async stream(req, signal) {
      const res = await post(fetch, url, headers, body(req, true), signal)
      if (!res.body) throw new Error('empty stream')
      const source = res.body
      return (async function* (): AsyncGenerator<Delta> {
        const usage: Usage = { input: 0, output: 0 }
        let finish = 'stop'
        for await (const data of events(source)) {
          const event = JSON.parse(data) as Event
          if (event.type === 'message_start' && 'message' in event) {
            usage.input = event.message.usage.input_tokens
          } else if (event.type === 'content_block_delta' && 'delta' in event) {
            if ('text' in event.delta && event.delta.text)
              yield { type: 'text', text: event.delta.text }
          } else if (event.type === 'message_delta' && 'usage' in event) {
            usage.output = event.usage.output_tokens
            finish = finishReason[event.delta.stop_reason ?? ''] ?? finish
          }
        }
        yield { type: 'end', finish, usage }
      })()
    },
  }
}
