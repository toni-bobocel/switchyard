import { events, post } from './http.js'
import type { Adapter, ChatRequest, Delta, Fetch, Usage } from './types.js'

// Speaks the OpenAI chat completions dialect, which also covers Mistral,
// Ollama, vLLM and most self-hosted servers.

interface Chunk {
  choices?: { delta?: { content?: string }; finish_reason?: string | null }[]
  usage?: { prompt_tokens: number; completion_tokens: number } | null
}

export function openai(fetch: Fetch, baseUrl: string, apiKey: string | undefined): Adapter {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {}
  const body = (req: ChatRequest, stream: boolean) => ({
    model: req.model,
    messages: req.messages,
    max_tokens: req.maxTokens,
    temperature: req.temperature,
    stream,
    ...(stream && { stream_options: { include_usage: true } }),
  })

  return {
    async complete(req, signal) {
      const res = await post(fetch, url, headers, body(req, false), signal)
      const json = (await res.json()) as {
        choices: { message: { content: string | null }; finish_reason: string }[]
        usage: { prompt_tokens: number; completion_tokens: number }
      }
      const choice = json.choices[0]
      return {
        text: choice?.message.content ?? '',
        finish: choice?.finish_reason ?? 'stop',
        usage: { input: json.usage.prompt_tokens, output: json.usage.completion_tokens },
      }
    },

    async stream(req, signal) {
      const res = await post(fetch, url, headers, body(req, true), signal)
      if (!res.body) throw new Error('empty stream')
      const source = res.body
      return (async function* (): AsyncGenerator<Delta> {
        let finish = 'stop'
        let usage: Usage | undefined
        for await (const data of events(source)) {
          if (data === '[DONE]') break
          const chunk = JSON.parse(data) as Chunk
          const choice = chunk.choices?.[0]
          if (choice?.delta?.content) yield { type: 'text', text: choice.delta.content }
          if (choice?.finish_reason) finish = choice.finish_reason
          if (chunk.usage) {
            usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens }
          }
        }
        yield usage ? { type: 'end', finish, usage } : { type: 'end', finish }
      })()
    },
  }
}
