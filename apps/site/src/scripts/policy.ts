// The lever frame writes here; both panels and the inspect desk read it.

export interface Policy {
  outage: boolean
  euOnly: boolean
  blockPii: boolean
  budgetCap: boolean
  rush: boolean
}

type Listener = (p: Readonly<Policy>, changed: keyof Policy) => void

const state: Policy = {
  outage: false,
  euOnly: false,
  blockPii: false,
  budgetCap: false,
  rush: false,
}
const listeners = new Set<Listener>()

export const policy: Readonly<Policy> = state

export function setPolicy(key: keyof Policy, value: boolean) {
  if (state[key] === value) return
  state[key] = value
  for (const l of listeners) l(state, key)
}

export function onPolicy(l: Listener) {
  listeners.add(l)
  return () => listeners.delete(l)
}
