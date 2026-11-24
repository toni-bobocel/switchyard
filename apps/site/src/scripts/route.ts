import { gsap } from 'gsap'
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
// The page runs the gateway's own classifier, not a copy of it.
import { classify } from '../../../gateway/src/routing/classify'

gsap.registerPlugin(MorphSVGPlugin, MotionPathPlugin, ScrambleTextPlugin)

const FAN: [number, number] = [230, 130]
const ENDS = { fast: 46, balanced: 130, reasoning: 214 } as const
type Tier = keyof typeof ENDS

const leg = (tier: Tier) => {
  const y = ENDS[tier]
  const dx = Math.abs(y - FAN[1])
  return `M20 ${FAN[1]} H${FAN[0]} L${FAN[0] + dx} ${y} H560`
}

const blade = (tier: Tier) => {
  const y = ENDS[tier]
  const dir = Math.sign(y - FAN[1])
  const [x0, y0] = FAN
  const len = 30
  const tx = x0 + (dir ? len / Math.SQRT2 : len)
  const ty = y0 + (dir * len) / Math.SQRT2
  return `M${x0} ${y0 - 3} L${tx + 2 * dir} ${ty - 2} L${tx - 2 * dir} ${ty + 2} L${x0} ${y0 + 3}Z`
}

export function routeDesk(root: HTMLElement) {
  const svg = root.querySelector<SVGSVGElement>('svg.junction')
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('.prompt')]
  const reasons = root.querySelector<HTMLElement>('.reasons')
  const tierOut = root.querySelector<HTMLElement>('[data-tier]')
  const scoreOut = root.querySelector<HTMLElement>('[data-score]')
  if (!svg || !reasons || !tierOut || !scoreOut) return

  const bladeEl = svg.querySelector<SVGPathElement>('.blade') as SVGPathElement
  const train = svg.querySelector<SVGGElement>('.train') as SVGGElement
  const routes = Object.fromEntries(
    (Object.keys(ENDS) as Tier[]).map((t) => [
      t,
      svg.querySelector<SVGPathElement>(`[data-route="${t}"]`),
    ]),
  ) as Record<Tier, SVGPathElement>
  const lamps = Object.fromEntries(
    (Object.keys(ENDS) as Tier[]).map((t) => [
      t,
      svg.querySelector<SVGCircleElement>(`[data-lamp="${t}"]`),
    ]),
  ) as Record<Tier, SVGCircleElement>
  for (const t of Object.keys(ENDS) as Tier[]) routes[t].setAttribute('d', leg(t))

  const score = { v: 0 }
  let run: gsap.core.Timeline | undefined

  const choose = (button: HTMLButtonElement) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b === button))
    const text = button.dataset.text ?? ''
    const verdict = classify([{ role: 'user', content: text }], 1024)
    const tier = verdict.tier as Tier

    reasons.innerHTML = verdict.reasons.length
      ? verdict.reasons
          .map((r) => {
            const [pts, ...why] = r.split(' ')
            return `<li class="mono"><span class="pts${pts?.startsWith('-') ? ' neg' : ''}">${pts}</span><span>${why.join(' ')}</span></li>`
          })
          .join('')
      : '<li class="mono"><span class="pts">0</span><span>no signal, cheapest tier</span></li>'

    run?.kill()
    for (const l of Object.values(lamps)) l.classList.remove('is-on')
    run = gsap
      .timeline()
      .from(reasons.children, { autoAlpha: 0, x: -12, stagger: 0.08, duration: 0.3 })
      .to(
        score,
        {
          v: verdict.score,
          duration: 0.6,
          onUpdate: () => {
            scoreOut.textContent = score.v.toFixed(1)
          },
        },
        0,
      )
      .to(
        tierOut,
        { duration: 0.6, scrambleText: { text: tier, chars: 'upperCase', speed: 0.7 } },
        0.2,
      )
      .to(bladeEl, { morphSVG: blade(tier), duration: 0.35, ease: 'back.out(2)' }, 0.3)
      .fromTo(
        train,
        { autoAlpha: 1 },
        {
          motionPath: {
            path: routes[tier],
            align: routes[tier],
            alignOrigin: [0.5, 0.5],
            autoRotate: true,
          },
          duration: 1.6,
          ease: 'power2.inOut',
        },
        0.45,
      )
      .add(() => lamps[tier].classList.add('is-on'))
      .to(train, { autoAlpha: 0, duration: 0.25 })
  }

  for (const b of buttons) b.addEventListener('click', () => choose(b))
  return () => {
    const first = buttons[0]
    if (first) choose(first)
  }
}
