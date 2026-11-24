import { gsap } from 'gsap'
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import { Observer } from 'gsap/Observer'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Flaps } from './flap'
import { inspectDesk } from './inspect'
import { ledger, MONTH_TOTAL } from './ledger'
import { leverFrame } from './levers'
import { routeDesk } from './route'
import { ticker } from './ticker'
import { type Departure, Yard } from './yard'

gsap.registerPlugin(MotionPathPlugin, MorphSVGPlugin, Observer, ScrollTrigger)

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T

const SCALE = 1000
const money = (micros: number) =>
  `$${(micros / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ── the month-to-date board, fed by both panels ──
const board = new Flaps($('[data-flaps]'), 10)
let monthMicros = Math.round(MONTH_TOTAL * 1e6)
board.set(money(monthMicros))

const log = ticker($('[data-ticker]'))
const account = (d: Departure) => {
  if (!d.costMicros) return
  monthMicros += d.costMicros
  board.set(money(monthMicros))
}

ledger($('[data-ledger]'), $('[data-tabs]'))
leverFrame($('[data-levers]'), $('[data-status]'))

const mm = gsap.matchMedia()

mm.add('(prefers-reduced-motion: no-preference)', () => {
  const hero = new Yard($('svg[data-yard="hero"]'), {
    scale: SCALE,
    onDeparture: (d) => {
      log(d)
      account(d)
    },
  })
  const desk = new Yard($('svg[data-yard="desk"]'), { scale: SCALE, onDeparture: account })
  const yards = [hero, desk]

  lampTest().then(() => hero.start())

  // Each panel only runs while it is on screen.
  ScrollTrigger.create({
    trigger: '[data-yard="desk"]',
    start: 'top bottom',
    end: 'bottom top',
    onToggle: ({ isActive }) => (isActive ? desk.start() : desk.stop()),
  })
  ScrollTrigger.create({
    trigger: '.hero',
    start: 'top bottom',
    end: 'bottom top',
    onToggle: ({ isActive }) => (isActive ? hero.start() : hero.stop()),
  })

  // Scroll velocity is traffic: fling the page and the yard gets busier,
  // stop and it eases back to its timetable.
  const tempo = { v: 1 }
  const apply = () => {
    for (const y of yards) y.boost(tempo.v)
  }
  Observer.create({
    target: window,
    type: 'wheel,touch,scroll',
    onChangeY: (self) => {
      const v = gsap.utils.clamp(1, 4, 1 + Math.abs(self.velocityY) / 1600)
      if (v > tempo.v) gsap.to(tempo, { v, duration: 0.2, onUpdate: apply, overwrite: true })
    },
    onStop: () =>
      gsap.to(tempo, { v: 1, duration: 1.4, ease: 'power2.out', onUpdate: apply, overwrite: true }),
    onStopDelay: 0.15,
  })

  const inspect = inspectDesk($('[data-inspect]'))
  ScrollTrigger.create({
    trigger: '[data-inspect]',
    start: 'top 70%',
    once: true,
    onEnter: inspect,
  })
  $('[data-replay]').addEventListener('click', inspect)

  const route = routeDesk($('[data-route-desk]'))
  if (route)
    ScrollTrigger.create({
      trigger: '[data-route-desk]',
      start: 'top 70%',
      once: true,
      onEnter: route,
    })

  ScrollTrigger.batch('.chapter__head', {
    start: 'top 85%',
    once: true,
    onEnter: (heads) =>
      gsap.from(heads, { autoAlpha: 0, y: 40, duration: 0.9, ease: 'power3.out', stagger: 0.1 }),
  })

  // Enamel plates hang from their rivets: they swing in and settle.
  gsap.from('.chapter__head .plate', {
    rotation: -7,
    transformOrigin: '12% 50%',
    duration: 1.6,
    ease: 'elastic.out(1, 0.35)',
    stagger: 0.1,
    scrollTrigger: { trigger: '.chapter', start: 'top 85%' },
  })
})

mm.add('(prefers-reduced-motion: reduce)', () => {
  // Static panels: routes drawn, no traffic.
  new Yard($('svg[data-yard="hero"]'), { scale: SCALE })
  new Yard($('svg[data-yard="desk"]'), { scale: SCALE })
  routeDesk($('[data-route-desk]'))?.()
  inspectDesk($('[data-inspect]'))()
})

/**
 * Signalmen start a shift with a lamp test: every lamp on, then off, so a
 * dead bulb is spotted before it matters. The panel does the same.
 */
function lampTest() {
  const lamps = document.querySelectorAll('[data-yard="hero"] .lamp')
  const rails = document.querySelectorAll('[data-yard="hero"] .rail')
  const tl = gsap.timeline()
  tl.from('.hero__title .line', { yPercent: 105, duration: 0.9, ease: 'power4.out', stagger: 0.08 })
    .from('.hero__lede', { autoAlpha: 0, y: 16, duration: 0.6 }, 0.35)
    .from(rails, { opacity: 0, duration: 0.05, stagger: { each: 0.03, from: 'random' } }, 0.2)
    .add(() => {
      for (const l of lamps) l.classList.add('is-on')
    }, 0.7)
    .to({}, { duration: 0.5 })
    .add(() => {
      for (const l of lamps) l.classList.remove('is-on')
    })
    .from('.lit', { opacity: 0.15, duration: 0.6, ease: 'steps(6)' }, 0.9)
  return tl.then()
}
