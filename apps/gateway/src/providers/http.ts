import { type Fetch, ProviderError } from './types.js'

export async function post(
  fetch: Fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
) {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    // Network failure or timeout: indistinguishable from a 503 for routing.
    throw new ProviderError(503, err instanceof Error ? err.message : 'network error')
  }
  if (!res.ok) {
    throw new ProviderError(res.status, (await res.text()).slice(0, 500))
  }
  return res
}

/** Server-sent events, one parsed `data:` payload at a time. */
export async function* events(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (data) yield data
      boundary = buffer.indexOf('\n\n')
    }
  }
}
