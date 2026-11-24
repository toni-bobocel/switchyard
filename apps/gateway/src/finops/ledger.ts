import { DatabaseSync } from 'node:sqlite'
import type { ModelConfig } from '../config.js'
import type { Usage } from '../providers/types.js'

// Money is integer micro-dollars end to end. Summing floats over a month of
// requests drifts by cents, and cents are what finance reconciles against.
export const costMicros = (model: ModelConfig, usage: Usage) =>
  Math.round(usage.input * model.price.input + usage.output * model.price.output)

export interface Entry {
  at: Date
  team: string
  feature: string
  tier: string
  model: string
  provider: string
  inputTokens: number
  outputTokens: number
  costMicros: number
  latencyMs: number
  status: number
  redactions: number
  fallbacks: number
  estimated: boolean
}

export const GROUPS = ['team', 'feature', 'model', 'tier'] as const
export type Group = (typeof GROUPS)[number]

export class Ledger {
  readonly #db: DatabaseSync
  readonly #insert
  readonly #spent

  constructor(path: string) {
    this.#db = new DatabaseSync(path)
    this.#db.exec(`
      pragma journal_mode = wal;
      pragma synchronous = normal;
      create table if not exists usage (
        id integer primary key,
        at text not null,
        month text not null,
        team text not null,
        feature text not null,
        tier text not null,
        model text not null,
        provider text not null,
        input_tokens integer not null,
        output_tokens integer not null,
        cost_micros integer not null,
        latency_ms integer not null,
        status integer not null,
        redactions integer not null,
        fallbacks integer not null,
        estimated integer not null
      ) strict;
      create index if not exists usage_team_month on usage (team, month);
    `)
    this.#insert = this.#db.prepare(`
      insert into usage (at, month, team, feature, tier, model, provider, input_tokens, output_tokens,
                         cost_micros, latency_ms, status, redactions, fallbacks, estimated)
      values (:at, :month, :team, :feature, :tier, :model, :provider, :inputTokens, :outputTokens,
              :costMicros, :latencyMs, :status, :redactions, :fallbacks, :estimated)
    `)
    this.#spent = this.#db.prepare(
      `select coalesce(sum(cost_micros), 0) as micros from usage where team = ? and month = ?`,
    )
  }

  record(e: Entry) {
    this.#insert.run({
      ...e,
      at: e.at.toISOString(),
      month: monthOf(e.at),
      estimated: e.estimated ? 1 : 0,
    })
  }

  spentMicros(team: string, month: string) {
    return Number((this.#spent.get(team, month) as { micros: number }).micros)
  }

  // `group` is checked against GROUPS by the caller; it is the one piece of
  // SQL that cannot be a bound parameter.
  breakdown(month: string, group: Group, team?: string) {
    const where = team ? 'month = ? and team = ?' : 'month = ?'
    const args = team ? [month, team] : [month]
    return this.#db
      .prepare(`
        select ${group} as key,
               count(*) as requests,
               sum(input_tokens) as input_tokens,
               sum(output_tokens) as output_tokens,
               sum(cost_micros) as cost_micros,
               sum(redactions) as redactions,
               sum(fallbacks > 0) as fallbacks
        from usage where ${where}
        group by ${group}
        order by cost_micros desc
      `)
      .all(...args)
  }

  close() {
    this.#db.close()
  }
}

export const monthOf = (d: Date) => d.toISOString().slice(0, 7)
