import { gsap } from 'gsap'
import { Flip } from 'gsap/Flip'

gsap.registerPlugin(Flip)

interface Row {
  feature: string
  team: string
  model: string
  requests: string
  cost: number
}

// Illustrative month for a mid-size company on the example config.
export const ROWS: Row[] = [
  { feature: 'code-review', team: 'platform', model: 'claude-opus', requests: '6.1k', cost: 302.8 },
  { feature: 'ad-copy', team: 'growth', model: 'claude-sonnet', requests: '58k', cost: 264.1 },
  {
    feature: 'reply-draft',
    team: 'support',
    model: 'mistral-large',
    requests: '96k',
    cost: 211.75,
  },
  {
    feature: 'ticket-triage',
    team: 'support',
    model: 'mistral-small',
    requests: '412k',
    cost: 148.2,
  },
  { feature: 'seo-briefs', team: 'growth', model: 'claude-sonnet', requests: '21k', cost: 118.65 },
  { feature: 'lead-scoring', team: 'growth', model: 'mistral-small', requests: '301k', cost: 92.4 },
  {
    feature: 'incident-summary',
    team: 'platform',
    model: 'claude-sonnet',
    requests: '12k',
    cost: 71.3,
  },
  { feature: 'runbook-qa', team: 'platform', model: 'mistral-small', requests: '44k', cost: 18.55 },
  { feature: 'refund-desk', team: 'support', model: 'qwen-local', requests: '38k', cost: 0 },
  { feature: 'contract-review', team: 'legal', model: 'qwen-local', requests: '9.2k', cost: 0 },
  { feature: 'nda-diff', team: 'legal', model: 'qwen-local', requests: '4.4k', cost: 0 },
]

export const MONTH_TOTAL = ROWS.reduce((n, r) => n + r.cost, 0)

type Group = 'feature' | 'team' | 'model'

const usd = (n: number) => (n ? `$${n.toFixed(2)}` : 'on-prem')

export function ledger(root: HTMLElement, tabs: HTMLElement) {
  const max = Math.max(...ROWS.map((r) => r.cost))
  const rows = new Map<string, HTMLElement>()

  for (const r of ROWS) {
    const el = document.createElement('div')
    el.className = 'ledger__row'
    el.dataset.flipId = r.feature
    el.innerHTML = `
      <span class="feature">${r.feature}</span>
      <span class="mono team">${r.team}</span>
      <span class="mono model">${r.model}</span>
      <span class="bar"><i style="width:${(r.cost / max) * 100}%"></i></span>
      <span class="mono cost">${usd(r.cost)}</span>`
    rows.set(r.feature, el)
  }

  const render = (group: Group) => {
    root.replaceChildren()
    if (group === 'feature') {
      for (const r of ROWS) root.append(rows.get(r.feature) as HTMLElement)
      return
    }
    const keys = [...new Set(ROWS.map((r) => r[group]))]
    const total = (k: string) => ROWS.filter((r) => r[group] === k).reduce((n, r) => n + r.cost, 0)
    keys.sort((a, b) => total(b) - total(a))
    for (const k of keys) {
      const head = document.createElement('div')
      head.className = 'ledger__group mono caps'
      head.dataset.flipId = `${group}:${k}`
      head.innerHTML = `<span>${k}</span><span>${usd(total(k))}</span>`
      root.append(head)
      for (const r of ROWS.filter((r) => r[group] === k))
        root.append(rows.get(r.feature) as HTMLElement)
    }
  }

  const select = (group: Group) => {
    for (const t of tabs.querySelectorAll('.tab')) {
      t.setAttribute('aria-selected', String((t as HTMLElement).dataset.group === group))
    }
    const state = Flip.getState(root.querySelectorAll('.ledger__row, .ledger__group'))
    render(group)
    Flip.from(state, {
      duration: 0.75,
      ease: 'power3.inOut',
      stagger: 0.012,
      onEnter: (els) =>
        gsap.fromTo(
          els,
          { autoAlpha: 0, x: -14 },
          { autoAlpha: 1, x: 0, duration: 0.45, delay: 0.3 },
        ),
    })
  }

  tabs.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('.tab')
    if (tab?.dataset.group) select(tab.dataset.group as Group)
  })
  render('team')
}
