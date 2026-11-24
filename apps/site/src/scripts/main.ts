import { gsap } from 'gsap'
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import { Observer } from 'gsap/Observer'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { cloudPainter, Dots, markPainter, type Painter, textPainter } from './dots'
import { inspectDesk } from './inspect'
import { ledger, MONTH_TOTAL } from './ledger'
import { onPolicy } from './policy'
import { routeDesk } from './route'
import { switches } from './switches'
import { ticker } from './ticker'
import { type Departure, Yard } from './yard'

gsap.registerPlugin(MotionPathPlugin, MorphSVGPlugin, Observer, ScrollTrigger)

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)]

const SIGNAL = '#c9f23a'
const SCALE = 1000

// ── always on, motion or not ──

const clock = $('[data-clock]')
const tick = () => {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date())
  clock.textContent = `Paris ${time} CET`
}
tick()
setInterval(tick, 1000)

const live = $('[data-live]')
onPolicy((p) => {
  live.textContent = p.outage ? 'Failover active' : 'All vendors up'
  live.classList.toggle('is-alert', p.outage)
})

ledger($('[data-ledger]'), $('[data-tabs]'))
switches($('[data-switches]'))

const totalEl = $('[data-total]')
const total = { micros: 0 }
const showTotal = () => {
  totalEl.textContent = `$${(total.micros / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
const monthMicros = { v: Math.round(MONTH_TOTAL * 1e6) }
const account = (d: Departure) => {
  if (!d.costMicros) return
  monthMicros.v += d.costMicros
  gsap.to(total, {
    micros: monthMicros.v,
    duration: 0.8,
    ease: 'power2.out',
    onUpdate: showTotal,
    overwrite: true,
  })
}

// ── menu ──

const menu = $('[data-menu]')
const menuTl = gsap
  .timeline({ paused: true })
  .set(menu, { autoAlpha: 1 })
  .from(menu, { clipPath: 'inset(0 0 100% 0)', duration: 0.6, ease: 'expo.inOut' })
  .from('.menu a span', { yPercent: 110, duration: 0.7, ease: 'expo.out', stagger: 0.05 }, '-=0.25')
$('[data-menu-open]').addEventListener('click', () => menuTl.play())
$('[data-menu-close]').addEventListener('click', () => menuTl.reverse())
for (const a of $$('.menu a')) a.addEventListener('click', () => menuTl.reverse())

const mm = gsap.matchMedia()

mm.add('(prefers-reduced-motion: no-preference)', () => {
  const field = new Dots($('canvas[data-field]'), { color: SIGNAL, step: 6, dot: 2 })

  // Where the cloud lives for each part of the page, in viewport fractions.
  const at = (paint: Painter, x: number, y: number, w: number, h: number) => () =>
    field.show({
      paint,
      x: field.width * x,
      y: field.height * y,
      w: field.width * w,
      h: field.height * h,
    })
  const empty: Painter = () => {}
  const stations: [string, () => void][] = [
    ['[data-hero]', at(markPainter, 0.5, 0.1, 0.46, 0.82)],
    ['[data-wipe]', at(empty, 0, 0, 1, 1)],
    ['#live', at(cloudPainter(7), 0.62, 0.04, 0.3, 0.3)],
    ['#inspect', at(cloudPainter(19), 0.66, 0.5, 0.26, 0.38)],
    ['[data-marquee]', at(cloudPainter(3), 0.05, 0.08, 0.3, 0.32)],
    ['#route', at(markPainter, 0.74, 0.06, 0.18, 0.34)],
    ['#account', at(cloudPainter(41), 0.6, 0.55, 0.32, 0.36)],
    ['#control', at(cloudPainter(11), 0.08, 0.06, 0.26, 0.28)],
    ['#decisions', at(cloudPainter(29), 0.7, 0.1, 0.24, 0.3)],
    ['#stack', at(cloudPainter(5), 0.12, 0.55, 0.28, 0.3)],
    ['#sdk', at(empty, 0, 0, 1, 1)],
  ]
  for (const [trigger, go] of stations) {
    ScrollTrigger.create({
      trigger,
      start: 'top 55%',
      end: 'bottom 55%',
      onEnter: go,
      onEnterBack: go,
    })
  }

  intro().then(() => stations[0]?.[1]())

  // The mark turns and grows until the page is signal-coloured, then the
  // wave hands back to ink.
  gsap
    .timeline({
      scrollTrigger: { trigger: '[data-wipe]', start: 'top top', end: 'bottom bottom', scrub: 0.6 },
    })
    .fromTo(
      '.wipe__mark',
      { scale: 0.25, rotation: -30 },
      { scale: 9, rotation: 110, ease: 'power2.in', duration: 1 },
    )
    .to('.wipe__stage', { backgroundColor: SIGNAL, duration: 0.25 }, 0.72)
  gsap.from('[data-wave]', {
    morphSVG: 'M0 0 H1440 V40 C1100 40 860 40 520 40 C300 40 140 40 0 40 Z',
    ease: 'none',
    scrollTrigger: { trigger: '.wave', start: 'top bottom', end: 'bottom top', scrub: true },
  })

  // Section heads rise in as they reach the reading line.
  for (const head of $$('.box .head')) {
    gsap.from(head.querySelectorAll('h2, p, .btn, .total, .tabs'), {
      y: 40,
      autoAlpha: 0,
      duration: 0.9,
      ease: 'expo.out',
      stagger: 0.06,
      scrollTrigger: { trigger: head, start: 'top 80%' },
    })
  }

  const ticks = $$('.ticks i')
  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: ({ progress }) => {
      const at = Math.round(progress * (ticks.length - 1))
      ticks.forEach((t, i) => {
        const d = Math.abs(i - at)
        gsap.to(t, {
          scaleX: d === 0 ? 2.2 : d < 3 ? 1.5 : 1,
          backgroundColor: d === 0 ? SIGNAL : d < 3 ? '#e6e2d6' : 'rgba(230,226,214,0.2)',
          duration: 0.3,
          overwrite: true,
        })
      })
    },
  })

  // Rows of words loop forever; scroll speed pushes them.
  const rows = $$('.marquee__row')
  const loops = rows.map((row, i) => {
    row.innerHTML += row.innerHTML
    const dir = i % 2 ? 1 : -1
    return gsap.fromTo(
      row,
      { xPercent: dir < 0 ? 0 : -50 },
      { xPercent: dir < 0 ? -50 : 0, duration: 38 + i * 6, ease: 'none', repeat: -1 },
    )
  })

  const log = ticker($('[data-ticker]'))
  const hero = new Yard($('svg[data-yard="hero"]'), {
    scale: SCALE,
    onDeparture: (d) => {
      log(d)
      account(d)
    },
  })
  const desk = new Yard($('svg[data-yard="desk"]'), { scale: SCALE, onDeparture: account })
  const yards = [hero, desk]
  for (const [yard, trigger] of [
    [hero, '#live'],
    [desk, '#control'],
  ] as const) {
    ScrollTrigger.create({
      trigger,
      start: 'top bottom',
      end: 'bottom top',
      onToggle: ({ isActive }) => (isActive ? yard.start() : yard.stop()),
    })
  }

  const tempo = { v: 1 }
  const apply = () => {
    for (const y of yards) y.boost(tempo.v)
    for (const l of loops) l.timeScale(tempo.v * 1.6)
  }
  Observer.create({
    target: window,
    type: 'wheel,touch,scroll',
    onChangeY: (self) => {
      const v = gsap.utils.clamp(1, 5, 1 + Math.abs(self.velocityY) / 1400)
      if (v > tempo.v) gsap.to(tempo, { v, duration: 0.2, onUpdate: apply, overwrite: true })
    },
    onStop: () =>
      gsap.to(tempo, { v: 1, duration: 1.2, ease: 'power2.out', onUpdate: apply, overwrite: true }),
    onStopDelay: 0.15,
  })

  ScrollTrigger.create({
    trigger: '#account',
    start: 'top 75%',
    once: true,
    onEnter: () =>
      gsap.to(total, {
        micros: monthMicros.v,
        duration: 2.2,
        ease: 'expo.out',
        onUpdate: showTotal,
      }),
  })

  const inspect = inspectDesk($('[data-inspect]'))
  ScrollTrigger.create({
    trigger: '[data-inspect] .split',
    start: 'top 70%',
    once: true,
    onEnter: inspect,
  })
  $('[data-replay]').addEventListener('click', inspect)

  const route = routeDesk($('[data-route-desk]'))
  if (route)
    ScrollTrigger.create({
      trigger: '[data-route-desk] .split',
      start: 'top 70%',
      once: true,
      onEnter: route,
    })

  signature()
})

mm.add('(prefers-reduced-motion: reduce)', () => {
  new Yard($('svg[data-yard="hero"]'), { scale: SCALE })
  new Yard($('svg[data-yard="desk"]'), { scale: SCALE })
  routeDesk($('[data-route-desk]'))?.()
  inspectDesk($('[data-inspect]'))()
  total.micros = monthMicros.v
  showTotal()
})

function intro() {
  return gsap
    .timeline({ delay: 0.15 })
    .from('.bar', { yPercent: -60, autoAlpha: 0, duration: 0.9, ease: 'expo.out' })
    .from('.sub > *', { autoAlpha: 0, y: -8, duration: 0.6, stagger: 0.08 }, 0.2)
    .from(
      '.hero__name .row > span',
      { yPercent: 105, duration: 1.2, ease: 'expo.out', stagger: 0.1 },
      0.3,
    )
    .from(
      '.hero__name .mark',
      { scale: 0, rotation: -120, duration: 1, ease: 'back.out(2.4)' },
      0.9,
    )
    .from('.hero__lede', { autoAlpha: 0, y: 14, duration: 0.8 }, 0.8)
    .then()
}

/** The footer name, in dots. It scatters on click and pulls itself back together. */
async function signature() {
  const canvas = $<HTMLCanvasElement>('canvas[data-signature]')
  await document.fonts.ready
  const dots = new Dots(canvas, { color: SIGNAL, step: 5, dot: 2.4, reach: 70 })
  const draw = () =>
    dots.show({
      paint: textPainter('Switchyard', '"Funnel Display Variable"', 560),
      x: 0,
      y: 0,
      w: dots.width,
      h: dots.height,
    })
  ScrollTrigger.create({ trigger: canvas, start: 'top 90%', once: true, onEnter: draw })
  canvas.addEventListener('click', () => dots.scatter(14))
  addEventListener('resize', draw)
}
