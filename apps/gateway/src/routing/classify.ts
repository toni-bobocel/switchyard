import type { Tier } from '../config.js'
import type { Message } from '../providers/types.js'

// Deliberately not a model. Classifying with an LLM adds a round trip and a
// bill to every request in order to save on some of them; these signals are
// free, deterministic and explainable in a log line. See docs/adr/0003.

const REASONING =
  /\b(why|prove|derive|step[- ]by[- ]step|trade-?offs?|architecture|design|plan|compare|analy[sz]e|root cause|pourquoi|démontre|analyse|compare[rz]?)\b/gi
const TRIAGE =
  /\b(classify|categori[sz]e|extract|tag|label|translate|yes or no|sentiment|summari[sz]e in|traduis|classe|extrais|résume en)\b/gi
const CODE = /```|^\s{4}\S|\bat \S+ \(\S+:\d+:\d+\)|Traceback \(most recent call last\)/m

export interface Verdict {
  tier: Tier
  score: number
  reasons: string[]
}

export function classify(messages: Message[], maxTokens: number): Verdict {
  const reasons: string[] = []
  let score = 0
  const add = (points: number, why: string) => {
    score += points
    reasons.push(`${points > 0 ? '+' : ''}${points} ${why}`)
  }

  const user = messages.filter((m) => m.role === 'user')
  const last = user.at(-1)?.content ?? ''
  const chars = messages.reduce((n, m) => n + m.content.length, 0)

  if (chars > 12_000) add(3, 'long context')
  else if (chars > 3_000) add(1, 'medium context')

  const reasoning = last.match(REASONING)?.length ?? 0
  if (reasoning) add(Math.min(reasoning, 3) * 1.5, `${reasoning} reasoning cue(s)`)

  const triage = last.match(TRIAGE)?.length ?? 0
  if (triage) add(-2, 'triage task')

  if (CODE.test(last)) add(2, 'code or stack trace')
  if (user.length > 6) add(1, 'long conversation')
  if (maxTokens > 2_000) add(1.5, 'long answer requested')

  const tier: Tier = score >= 4 ? 'reasoning' : score >= 1.5 ? 'balanced' : 'fast'
  return { tier, score, reasons }
}
