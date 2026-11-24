// Per provider, not per model: when a vendor is down, all of its models are.

const THRESHOLD = 3
const COOLDOWN_MS = 30_000

interface State {
  failures: number
  openedAt: number | null
}

export class Breakers {
  readonly #states = new Map<string, State>()

  constructor(private readonly now: () => number = Date.now) {}

  /** Closed, or open long enough that one probe request may go through. */
  available(provider: string) {
    const s = this.#states.get(provider)
    if (!s?.openedAt) return true
    return this.now() - s.openedAt >= COOLDOWN_MS
  }

  success(provider: string) {
    this.#states.delete(provider)
  }

  failure(provider: string) {
    const s = this.#states.get(provider) ?? { failures: 0, openedAt: null }
    s.failures += 1
    // A failed half-open probe re-opens for a full cooldown.
    if (s.failures >= THRESHOLD) s.openedAt = this.now()
    this.#states.set(provider, s)
  }

  snapshot() {
    return Object.fromEntries(
      [...this.#states.keys()].map((p) => [p, this.available(p) ? 'closed' : 'open']),
    )
  }
}
