import { gsap } from 'gsap'
import { Flip } from 'gsap/Flip'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
import type { Departure } from './yard'

gsap.registerPlugin(Flip, ScrambleTextPlugin)

const ROWS = 5
const pad = (n: number) => String(n).padStart(2, '0')
const clock = () => {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const HELD: Record<string, string> = {
  '402': '402 BUDGET',
  '422': '422 PII',
  '503': '503 NO ROUTE',
}

export function ticker(list: HTMLElement) {
  return (d: Departure) => {
    const state = Flip.getState(list.children)

    const li = document.createElement('li')
    li.className = 'mono'
    const route = d.model
      ? `${d.tier.toUpperCase()} → ${d.model.name}${d.fallback ? ' ↺' : ''}`
      : `HELD AT GATE`
    const cost = d.held ? (HELD[d.held] ?? 'HELD') : `$${(d.costMicros / 1e6).toFixed(4)}`
    li.innerHTML = `
      <span class="t-time">${clock()}</span>
      <span class="t-team">${d.team.name}/${d.feature}</span>
      <span class="t-route${d.held ? ' t-held' : ''}"></span>
      <span class="t-region">${d.model ? d.model.region.toUpperCase() : '—'}</span>
      <span class="t-pii">${d.pii ? `⟦${d.pii}⟧` : '—'}</span>
      <span class="t-cost${d.held ? ' t-held' : ''}"></span>`
    list.prepend(li)
    while (list.children.length > ROWS) list.lastElementChild?.remove()

    Flip.from(state, { duration: 0.35, ease: 'power2.out' })
    gsap.from(li, { autoAlpha: 0, duration: 0.25 })
    gsap.to(li.querySelector('.t-route'), {
      duration: 0.6,
      scrambleText: { text: route, chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ-', speed: 0.6 },
    })
    gsap.to(li.querySelector('.t-cost'), {
      duration: 0.5,
      delay: 0.1,
      scrambleText: { text: cost, chars: '0123456789', speed: 0.8 },
    })
  }
}
