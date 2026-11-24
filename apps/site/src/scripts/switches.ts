import { gsap } from 'gsap'
import { Draggable } from 'gsap/Draggable'
import { InertiaPlugin } from 'gsap/InertiaPlugin'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
import { type Policy, policy, setPolicy } from './policy'

gsap.registerPlugin(Draggable, InertiaPlugin, ScrambleTextPlugin)

const STATE: Record<keyof Policy, [string, string]> = {
  outage: ['all vendors answering', 'anthropic breaker open, failing over'],
  euOnly: ['any region the team allows', 'eu and on-prem only'],
  blockPii: ['redacted, restored on the way out', 'refused with 422'],
  budgetCap: ['growth at 61% of $800', 'growth cut off with 402'],
  rush: ['normal timetable', 'departures ×2.4'],
}

const ALERT = new Set<keyof Policy>(['outage', 'budgetCap'])

/** Each policy is a two-position switch: drag the knob, throw it, or press space. */
export function switches(root: HTMLElement) {
  for (const el of root.querySelectorAll<HTMLElement>('.switch')) {
    const key = el.dataset.key as keyof Policy
    const track = el.querySelector<HTMLElement>('.track') as HTMLElement
    const knob = el.querySelector<HTMLElement>('.knob') as HTMLElement
    const state = el.querySelector<HTMLElement>('.state') as HTMLElement
    const travel = () => track.clientWidth - knob.offsetWidth - 6

    const set = (on: boolean, animate = true) => {
      setPolicy(key, on)
      track.setAttribute('aria-checked', String(on))
      el.classList.toggle('is-on', on)
      el.classList.toggle('is-alert', ALERT.has(key))
      knob.textContent = on ? 'ON' : 'OFF'
      gsap.to(knob, {
        x: on ? travel() : 0,
        duration: animate ? 0.45 : 0,
        ease: 'expo.out',
        overwrite: true,
      })
      gsap.to(state, {
        duration: animate ? 0.6 : 0,
        scrambleText: { text: STATE[key][on ? 1 : 0], chars: 'lowerCase', speed: 0.8 },
      })
    }

    Draggable.create(knob, {
      type: 'x',
      bounds: track,
      inertia: true,
      edgeResistance: 0.9,
      snap: (x) => (x > travel() / 2 ? travel() : 0),
      onThrowComplete() {
        set(this.x > travel() / 2, false)
      },
      onClick: () => set(!policy[key]),
    })
    track.addEventListener('click', (e) => {
      if (e.target === track) set(!policy[key])
    })
    track.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        set(!policy[key])
      }
    })
    addEventListener('resize', () => set(policy[key], false))
    set(policy[key], false)
  }
}
