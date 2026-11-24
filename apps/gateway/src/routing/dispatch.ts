import type { Config, ModelConfig, TeamConfig, Tier } from '../config.js'
import { anthropic } from '../providers/anthropic.js'
import { openai } from '../providers/openai.js'
import { type Adapter, type Fetch, ProviderError } from '../providers/types.js'
import type { Breakers } from './breaker.js'

export interface Candidate {
  name: string
  model: ModelConfig
  region: string
}

export function candidates(config: Config, tier: Tier, team: TeamConfig): Candidate[] {
  return (config.tiers[tier] ?? [])
    .map((name) => {
      const model = config.models[name] as ModelConfig
      const region = (config.providers[model.provider] as { region: string }).region
      return { name, model, region }
    })
    .filter((c) => !team.residency || team.residency.includes(c.region))
}

export function adapters(config: Config, fetch: Fetch, env: NodeJS.ProcessEnv) {
  const built = new Map<string, Adapter>()
  for (const [name, p] of Object.entries(config.providers)) {
    const key = p.apiKeyEnv ? env[p.apiKeyEnv] : undefined
    built.set(
      name,
      p.kind === 'anthropic' ? anthropic(fetch, p.baseUrl, key) : openai(fetch, p.baseUrl, key),
    )
  }
  return built
}

export interface Attempt {
  candidate: Candidate
  error: string
}

/**
 * Walks the candidates in order and returns the first that answers. Only
 * retryable failures move on; a 400 from one vendor would be a 400 from the
 * next, so it is surfaced immediately. Open breakers are skipped without a
 * network call.
 */
export async function firstAvailable<T>(
  list: Candidate[],
  breakers: Breakers,
  call: (c: Candidate) => Promise<T>,
): Promise<{ value: T; candidate: Candidate; skipped: Attempt[] }> {
  const skipped: Attempt[] = []
  for (const candidate of list) {
    const provider = candidate.model.provider
    if (!breakers.available(provider)) {
      skipped.push({ candidate, error: 'circuit open' })
      continue
    }
    try {
      const value = await call(candidate)
      breakers.success(provider)
      return { value, candidate, skipped }
    } catch (err) {
      if (!(err instanceof ProviderError) || !err.retryable) throw err
      breakers.failure(provider)
      skipped.push({ candidate, error: `${err.status}` })
    }
  }
  throw new NoRoute(skipped)
}

export class NoRoute extends Error {
  constructor(readonly attempts: Attempt[]) {
    super(
      attempts.length
        ? `all candidates failed: ${attempts.map((a) => `${a.candidate.name} (${a.error})`).join(', ')}`
        : 'no model in this tier satisfies the team residency policy',
    )
  }
}
