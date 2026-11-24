// Mirrors switchyard.example.json so the panel tells the truth about the
// default configuration.

export type Tier = 'fast' | 'balanced' | 'reasoning'
export type Region = 'eu' | 'us' | 'on-prem'

export interface Model {
  name: string
  provider: 'mistral' | 'anthropic' | 'local'
  region: Region
  price: { input: number; output: number }
}

export const MODELS: Model[] = [
  { name: 'mistral-small', provider: 'mistral', region: 'eu', price: { input: 0.1, output: 0.3 } },
  { name: 'qwen-local', provider: 'local', region: 'on-prem', price: { input: 0, output: 0 } },
  { name: 'claude-haiku', provider: 'anthropic', region: 'us', price: { input: 1, output: 5 } },
  { name: 'claude-sonnet', provider: 'anthropic', region: 'us', price: { input: 3, output: 15 } },
  { name: 'mistral-large', provider: 'mistral', region: 'eu', price: { input: 2, output: 6 } },
  { name: 'claude-opus', provider: 'anthropic', region: 'us', price: { input: 15, output: 75 } },
]

export const TIERS: Record<Tier, string[]> = {
  fast: ['mistral-small', 'qwen-local', 'claude-haiku'],
  balanced: ['claude-sonnet', 'mistral-large', 'qwen-local'],
  reasoning: ['claude-opus', 'mistral-large', 'qwen-local'],
}

export interface Team {
  name: string
  weight: number
  residency?: Region[]
  features: string[]
}

export const TEAMS: Team[] = [
  {
    name: 'support',
    weight: 34,
    residency: ['eu', 'on-prem'],
    features: ['ticket-triage', 'reply-draft', 'refund-desk'],
  },
  { name: 'growth', weight: 32, features: ['ad-copy', 'lead-scoring', 'seo-briefs'] },
  { name: 'legal', weight: 12, residency: ['on-prem'], features: ['contract-review', 'nda-diff'] },
  { name: 'platform', weight: 22, features: ['incident-summary', 'code-review', 'runbook-qa'] },
]

/** Rough token shapes per tier, scaled by a random factor per request. */
export const SHAPE: Record<Tier, { input: number; output: number }> = {
  fast: { input: 900, output: 160 },
  balanced: { input: 2600, output: 620 },
  reasoning: { input: 7000, output: 1900 },
}
