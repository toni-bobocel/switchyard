import { readFileSync } from 'node:fs'
import { z } from 'zod'

export const TIERS = ['fast', 'balanced', 'reasoning'] as const
export type Tier = (typeof TIERS)[number]

const provider = z.object({
  kind: z.enum(['openai', 'anthropic']),
  baseUrl: z.url(),
  apiKeyEnv: z.string().optional(),
  region: z.string(),
  timeoutMs: z.number().int().positive().default(60_000),
})

const model = z.object({
  provider: z.string(),
  id: z.string(),
  // USD per million tokens, which is also micro-dollars per token.
  price: z.object({ input: z.number().nonnegative(), output: z.number().nonnegative() }),
})

const team = z.object({
  keys: z.array(z.string().regex(/^[a-f0-9]{64}$/, 'sha256 hex of the API key')),
  budgetUsd: z.number().positive(),
  pii: z.enum(['redact', 'block', 'off']).default('redact'),
  residency: z.array(z.string()).optional(),
  admin: z.boolean().default(false),
})

const schema = z
  .object({
    providers: z.record(z.string(), provider),
    models: z.record(z.string(), model),
    tiers: z.record(z.enum(TIERS), z.array(z.string()).min(1)),
    teams: z.record(z.string(), team),
  })
  .superRefine((cfg, ctx) => {
    for (const [name, m] of Object.entries(cfg.models)) {
      if (!cfg.providers[m.provider]) {
        ctx.addIssue({
          code: 'custom',
          path: ['models', name],
          message: `unknown provider ${m.provider}`,
        })
      }
    }
    for (const [tier, names] of Object.entries(cfg.tiers)) {
      for (const n of names) {
        if (!cfg.models[n]) {
          ctx.addIssue({ code: 'custom', path: ['tiers', tier], message: `unknown model ${n}` })
        }
      }
    }
  })

export type Config = z.infer<typeof schema>
export type ProviderConfig = z.infer<typeof provider>
export type ModelConfig = z.infer<typeof model>
export type TeamConfig = z.infer<typeof team>

export function parseConfig(raw: unknown): Config {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new Error(`invalid config\n${z.prettifyError(parsed.error)}`)
  return parsed.data
}

export const loadConfig = (path: string) => parseConfig(JSON.parse(readFileSync(path, 'utf8')))
