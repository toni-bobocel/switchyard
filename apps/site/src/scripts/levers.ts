import { gsap } from 'gsap'
import { CustomEase } from 'gsap/CustomEase'
import { CustomWiggle } from 'gsap/CustomWiggle'
import { Draggable } from 'gsap/Draggable'
import { InertiaPlugin } from 'gsap/InertiaPlugin'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
import { onPolicy, type Policy, policy, setPolicy } from './policy'

gsap.registerPlugin(Draggable, InertiaPlugin, CustomEase, CustomWiggle, ScrambleTextPlugin)

const NORMAL = -9
const REVERSED = 9
const PIVOT = '30 212'

// A lever is thrown hard and stops on the quadrant with a thud.
const thrown = CustomEase.create(
  'lever-throw',
  'M0,0 C0.3,0 0.42,1.14 0.58,1.06 0.72,0.99 0.84,1.01 1,1',
)
const thud = CustomWiggle.create('lever-thud', { wiggles: 5, type: 'easeOut' })

const status: Record<keyof Policy, [string, string]> = {
  outage: ['breaker closed', 'breaker OPEN · failing over to Mistral'],
  euOnly: ['any region the team allows', 'EU and on-prem only'],
  blockPii: ['redacted, restored on the way out', 'blocked with 422'],
  budgetCap: ['61% of $800 used', 'exhausted · 402 until the 1st'],
  rush: ['normal', '×2.4 departures'],
}

export function leverFrame(frame: HTMLElement, list: HTMLElement) {
  const levers = [...frame.querySelectorAll<HTMLButtonElement>('.lever')]

  for (const lever of levers) {
    const key = lever.dataset.key as keyof Policy
    const arm = lever.querySelector<SVGGElement>('.arm') as SVGGElement
    gsap.set(arm, { svgOrigin: PIVOT, rotation: NORMAL })

    const throwTo = (on: boolean) => {
      gsap.to(arm, {
        rotation: on ? REVERSED : NORMAL,
        duration: 0.55,
        ease: thrown,
        overwrite: true,
      })
      gsap.fromTo(frame, { x: 0 }, { x: on ? 3 : -3, duration: 0.5, ease: thud, delay: 0.32 })
      lever.setAttribute('aria-pressed', String(on))
      setPolicy(key, on)
    }

    let dragged = false
    Draggable.create(arm, {
      type: 'rotation',
      trigger: lever,
      bounds: { minRotation: NORMAL, maxRotation: REVERSED },
      inertia: true,
      minimumMovement: 4,
      snap: (r) => (r > 0 ? REVERSED : NORMAL),
      onDragStart: () => {
        dragged = true
      },
      onThrowComplete() {
        setPolicy(key, this.rotation > 0)
        lever.setAttribute('aria-pressed', String(this.rotation > 0))
        gsap.fromTo(frame, { x: 0 }, { x: 2, duration: 0.45, ease: thud })
      },
    })

    // A plain click or a key press throws the lever; a drag already did.
    lever.addEventListener('click', () => {
      if (dragged) {
        dragged = false
        return
      }
      throwTo(!policy[key])
    })
  }

  const paint = (p: Readonly<Policy>) => {
    for (const li of list.querySelectorAll<HTMLElement>('li')) {
      const key = li.dataset.key as keyof Policy
      const on = p[key]
      const text = status[key][on ? 1 : 0]
      const out = li.querySelector('span') as HTMLElement
      if (out.textContent !== text)
        gsap.to(out, { duration: 0.5, scrambleText: { text, chars: 'lowerCase', speed: 0.8 } })
      li.classList.toggle('is-alert', on && (key === 'outage' || key === 'budgetCap'))
      li.classList.toggle('is-set', on && key !== 'outage' && key !== 'budgetCap')
    }
  }
  onPolicy((p) => paint(p))
  paint(policy)
}
