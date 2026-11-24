import { detect, type EntityKind } from './detect.js'

const OPEN = '⟦'
const CLOSE = '⟧'
const TOKEN = /⟦([A-Z0-9]+_\d+)⟧/g
// Longest placeholder we ever emit, e.g. ⟦EMAIL_9999⟧. Anything longer
// after an opening bracket is not ours and can be released.
const MAX_TOKEN = 16

/**
 * Lives for one request. The same value always maps to the same token, so
 * the model can still tell that two mentions refer to one person.
 */
export class Vault {
  readonly #byValue = new Map<string, string>()
  readonly #byToken = new Map<string, string>()
  readonly #counters = new Map<EntityKind, number>()
  readonly counts: Partial<Record<EntityKind, number>> = {}

  redact(text: string) {
    let out = ''
    let cursor = 0
    for (const f of detect(text)) {
      out += text.slice(cursor, f.start) + this.#tokenFor(f.kind, f.value)
      cursor = f.end
    }
    return out + text.slice(cursor)
  }

  restore(text: string) {
    return text.replace(TOKEN, (whole, id: string) => this.#byToken.get(id) ?? whole)
  }

  get size() {
    return this.#byToken.size
  }

  #tokenFor(kind: EntityKind, value: string) {
    let id = this.#byValue.get(value)
    if (!id) {
      const n = (this.#counters.get(kind) ?? 0) + 1
      this.#counters.set(kind, n)
      this.counts[kind] = (this.counts[kind] ?? 0) + 1
      id = `${kind}_${n}`
      this.#byValue.set(value, id)
      this.#byToken.set(id, value)
    }
    return `${OPEN}${id}${CLOSE}`
  }
}

/**
 * Streams split tokens anywhere: `⟦EMA` in one chunk, `IL_1⟧` in the next.
 * Text after an unclosed bracket is held back until it either closes or
 * grows too long to be one of ours.
 */
export function streamRestorer(vault: Vault) {
  let pending = ''
  return {
    push(chunk: string) {
      pending += chunk
      const open = pending.lastIndexOf(OPEN)
      const held =
        open !== -1 && !pending.includes(CLOSE, open) && pending.length - open < MAX_TOKEN
          ? open
          : pending.length
      const ready = pending.slice(0, held)
      pending = pending.slice(held)
      return vault.restore(ready)
    },
    flush() {
      const rest = vault.restore(pending)
      pending = ''
      return rest
    },
  }
}
