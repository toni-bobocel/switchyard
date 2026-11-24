export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  model: string
  messages: Message[]
  maxTokens: number
  temperature?: number
}

export interface Usage {
  input: number
  output: number
}

export interface Completion {
  text: string
  usage: Usage
  finish: string
}

export type Delta = { type: 'text'; text: string } | { type: 'end'; usage?: Usage; finish: string }

export interface Adapter {
  complete(req: ChatRequest, signal: AbortSignal): Promise<Completion>
  stream(req: ChatRequest, signal: AbortSignal): Promise<AsyncIterable<Delta>>
}

/** 429 and 5xx are the provider's problem and worth another candidate; 4xx are ours. */
export class ProviderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }

  get retryable() {
    return this.status === 408 || this.status === 429 || this.status >= 500
  }
}

export type Fetch = typeof fetch
