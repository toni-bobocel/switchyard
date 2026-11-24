import { ibanValid, luhn, nirValid } from './checksums.js'

export type EntityKind = 'IBAN' | 'CARD' | 'NIR' | 'EMAIL' | 'PHONE' | 'IPV4'

export interface Finding {
  kind: EntityKind
  start: number
  end: number
  value: string
}

interface Detector {
  kind: EntityKind
  pattern: RegExp
  valid?: (match: string) => boolean
}

// Order is priority: when two findings overlap, the earlier detector wins.
// An IBAN contains digit runs that look like phone numbers; a card number
// can look like a NIR. Checksums settle most of it, priority the rest.
const detectors: Detector[] = [
  {
    kind: 'IBAN',
    pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g,
    valid: ibanValid,
  },
  {
    kind: 'CARD',
    pattern: /\b\d(?:[ -]?\d){12,18}\b/g,
    valid: (m) => luhn(m.replace(/\D/g, '')),
  },
  {
    kind: 'NIR',
    pattern: /\b[12] ?\d{2} ?(?:0[1-9]|1[0-2]|[2-9]\d) ?(?:\d{2}|2[AB]) ?\d{3} ?\d{3} ?\d{2}\b/g,
    valid: nirValid,
  },
  {
    kind: 'EMAIL',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g,
  },
  {
    kind: 'PHONE',
    pattern: /(?:\+33 ?|\b0)[1-9](?:[ .-]?\d{2}){4}\b|\+\d{1,3}(?:[ .-]?\d){7,12}\b/g,
  },
  {
    kind: 'IPV4',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
  },
]

export function detect(text: string): Finding[] {
  const taken: Finding[] = []
  for (const { kind, pattern, valid } of detectors) {
    for (const m of text.matchAll(pattern)) {
      const start = m.index
      const end = start + m[0].length
      if (valid && !valid(m[0])) continue
      if (taken.some((f) => start < f.end && end > f.start)) continue
      taken.push({ kind, start, end, value: m[0] })
    }
  }
  return taken.sort((a, b) => a.start - b.start)
}
