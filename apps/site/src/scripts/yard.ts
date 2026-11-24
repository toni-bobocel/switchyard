import { gsap } from 'gsap'
import { MODELS, type Model, type Region, SHAPE, TEAMS, type Team, TIERS, type Tier } from './data'
import { onPolicy, type Policy, policy } from './policy'

const NS = 'http://www.w3.org/2000/svg'
const W = 1200
const H = 460
const TRUNK_Y = 230
const FAN_X = 700
const GATE = { x: 418, y: 186, w: 234, h: 88 }
const PLATFORM_END = 1090
const SPEED = 300 // px per second at timeScale 1

type Point = [number, number]

export interface Departure {
  team: Team
  feature: string
  tier: Tier
  model?: Model
  pii: number
  held?: '402' | '422' | '503'
  costMicros: number
  fallback: boolean
}

interface Options {
  /** Each lamp stands for this many real requests. */
  scale: number
  onDeparture?: (d: Departure) => void
}

const el = <K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
) => {
  const node = document.createElementNS(NS, name)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  return node
}

const teamY = (i: number) => 92 + i * 92
const platformY = (i: number) => 52 + i * 72

// Schematic geometry: horizontals and 45° diagonals only, like a real panel.
function teamLeg(i: number): Point[] {
  const y = teamY(i)
  const dx = Math.abs(y - TRUNK_Y)
  return [
    [24, y],
    [200, y],
    [200 + dx, TRUNK_Y],
  ]
}

function platformLeg(i: number): Point[] {
  const y = platformY(i)
  const dx = Math.abs(y - TRUNK_Y)
  return [
    [FAN_X, TRUNK_Y],
    [FAN_X + dx, y],
    [PLATFORM_END, y],
  ]
}

const toD = (pts: Point[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ')

function lengthTo(pts: Point[], stopX: number) {
  let total = 0
  let upto = 0
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1] as Point
    const [bx, by] = pts[i] as Point
    const seg = Math.hypot(bx - ax, by - ay)
    if (bx <= stopX) upto = total + seg
    else if (ax < stopX) upto = total + (stopX - ax) * (seg / (bx - ax))
    total += seg
  }
  return { total, upto }
}

function blade(i: number | null) {
  // A short wedge at the fan point, aimed down the chosen platform.
  const [x0, y0] = [FAN_X, TRUNK_Y]
  if (i === null)
    return `M${x0} ${y0 - 3} L${x0 + 34} ${y0 - 1} L${x0 + 34} ${y0 + 1} L${x0} ${y0 + 3}Z`
  const y = platformY(i)
  const dir = Math.sign(y - TRUNK_Y)
  const len = 30
  const tx = x0 + len / Math.SQRT2
  const ty = y0 + (dir * len) / Math.SQRT2
  return `M${x0} ${y0 - 3} L${tx + 2 * dir} ${ty - 2} L${tx - 2 * dir} ${ty + 2} L${x0} ${y0 + 3}Z`
}

const pick = <T extends { weight: number }>(items: T[]) => {
  let r = Math.random() * items.reduce((n, i) => n + i.weight, 0)
  for (const item of items) {
    r -= item.weight
    if (r <= 0) return item
  }
  return items[0] as T
}

function decide(p: Readonly<Policy>, team: Team, tier: Tier, pii: number) {
  if (p.blockPii && pii > 0) return { held: '422' as const }
  if (p.budgetCap && team.name === 'growth') return { held: '402' as const }
  const allowed: Region[] | undefined = p.euOnly
    ? (team.residency ?? ['eu', 'on-prem']).filter((r) => r !== 'us')
    : team.residency
  const inTier = TIERS[tier].map((n) => MODELS.find((m) => m.name === n) as Model)
  const permitted = inTier.filter((m) => !allowed || allowed.includes(m.region))
  const up = permitted.filter((m) => !(p.outage && m.provider === 'anthropic'))
  const model = up[0]
  if (!model) return { held: '503' as const }
  return { model, fallback: up[0] !== permitted[0] }
}

export class Yard {
  readonly traffic = gsap.timeline({ autoRemoveChildren: true, smoothChildTiming: true })
  #boost = 1
  #spawnTimer?: gsap.core.Tween
  readonly #rails = new Map<string, SVGPathElement[]>()
  readonly #lamps = new Map<string, SVGCircleElement>()
  readonly #trains: SVGGElement
  readonly #blade: SVGPathElement
  readonly #gate: SVGRectElement
  readonly #gateSub: SVGTextElement

  constructor(
    readonly svg: SVGSVGElement,
    readonly opts: Options,
  ) {
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    svg.classList.add('yard')

    const defs = el('defs')
    defs.innerHTML = `<filter id="glow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
    svg.append(defs)

    const rails = el('g')
    const labels = el('g')
    this.#trains = el('g')
    const top = el('g')
    svg.append(rails, labels, this.#trains, top)

    TEAMS.forEach((team, i) => {
      const path = el('path', { d: toD(teamLeg(i)), class: 'rail' })
      rails.append(path)
      this.#rails.set(`team:${team.name}`, [path])
      const y = teamY(i)
      labels.append(
        Object.assign(el('text', { x: 24, y: y - 12, class: 'label' }), {
          textContent: team.name.toUpperCase(),
        }),
        Object.assign(el('text', { x: 24, y: y + 20, class: 'sub' }), {
          textContent: team.residency ? `residency ${team.residency.join(' + ')}` : 'any region',
        }),
        el('rect', { x: 14, y: y - 7, width: 10, height: 14, rx: 2, fill: '#e6dec6' }),
      )
    })

    const joins = TEAMS.map((_, i) => (teamLeg(i).at(-1) as Point)[0])
    rails.append(el('path', { d: `M${Math.min(...joins)} ${TRUNK_Y} H${FAN_X}`, class: 'rail' }))

    MODELS.forEach((model, i) => {
      const path = el('path', { d: toD(platformLeg(i)), class: 'rail' })
      rails.append(path)
      this.#rails.set(`model:${model.name}`, [path])
      const y = platformY(i)
      const lamp = el('circle', { cx: PLATFORM_END + 18, cy: y, r: 7, class: 'lamp' })
      this.#lamps.set(model.name, lamp)
      const regionText = Object.assign(
        el('text', { x: 1046, y: y - 10, class: 'region', 'text-anchor': 'end' }),
        {
          textContent: model.region.toUpperCase(),
        },
      )
      regionText.setAttribute(
        'fill',
        model.region === 'us' ? '#f0a58f' : model.region === 'eu' ? '#9cc4ff' : '#7fd18b',
      )
      labels.append(
        Object.assign(el('text', { x: 900, y: y - 10, class: 'label' }), {
          textContent: model.name,
        }),
        regionText,
        lamp,
      )
    })

    const tierMarks: [Tier, number, number][] = [
      ['fast', 0, 2],
      ['balanced', 3, 4],
      ['reasoning', 5, 5],
    ]
    for (const [tier, a, b] of tierMarks) {
      const y1 = platformY(a) - 22
      const y2 = platformY(b) + 8
      labels.append(
        el('path', { d: `M1150 ${y1} h8 V${y2} h-8`, class: 'rail is-dark', 'stroke-width': 1.5 }),
        Object.assign(el('text', { x: 1170, y: (y1 + y2) / 2 + 4, class: 'tier-label' }), {
          textContent: tier.toUpperCase(),
        }),
      )
    }

    this.#gate = el('rect', {
      x: GATE.x,
      y: GATE.y,
      width: GATE.w,
      height: GATE.h,
      rx: 6,
      class: 'gate',
    })
    const gateLabel = Object.assign(
      el('text', {
        x: GATE.x + GATE.w / 2,
        y: GATE.y + 38,
        class: 'gate-label',
        'text-anchor': 'middle',
      }),
      { textContent: 'SWITCHYARD' },
    )
    this.#gateSub = Object.assign(
      el('text', {
        x: GATE.x + GATE.w / 2,
        y: GATE.y + 62,
        class: 'gate-steps',
        'text-anchor': 'middle',
      }),
      { textContent: 'INSPECT · ROUTE · ACCOUNT' },
    )
    this.#blade = el('path', { d: blade(null), class: 'blade' })
    top.append(this.#gate, gateLabel, this.#gateSub, this.#blade)

    onPolicy((p, changed) => this.#apply(p, changed))
    this.#apply(policy, 'rush')
  }

  start() {
    this.traffic.resume()
    if (!this.#spawnTimer) this.#schedule()
    return this
  }

  stop() {
    this.#spawnTimer?.kill()
    this.#spawnTimer = undefined
    this.traffic.pause()
  }

  /** Scroll velocity, wheel or drag: trains run faster while the page moves. */
  boost(factor: number) {
    this.#boost = factor
    this.#tempo()
  }

  #tempo() {
    this.traffic.timeScale((policy.rush ? 2.4 : 1) * this.#boost)
  }

  #schedule() {
    const gap = gsap.utils.random(0.45, 1.15) / (policy.rush ? 2.4 : 1)
    this.#spawnTimer = gsap.delayedCall(gap, () => {
      this.#depart()
      this.#schedule()
    })
  }

  #apply(p: Readonly<Policy>, changed: keyof Policy) {
    for (const m of MODELS) {
      const [rail] = this.#rails.get(`model:${m.name}`) ?? []
      const lamp = this.#lamps.get(m.name)
      const down = p.outage && m.provider === 'anthropic'
      const barred = p.euOnly && m.region === 'us'
      rail?.classList.toggle('is-down', down)
      rail?.classList.toggle('is-dark', barred && !down)
      lamp?.classList.toggle('is-red', down)
    }
    const [growth] = this.#rails.get('team:growth') ?? []
    growth?.classList.toggle('is-dark', p.budgetCap)

    const notes = [
      p.blockPii ? 'PII BLOCK' : 'PII REDACT',
      p.euOnly ? 'EU' : null,
      p.outage ? 'FAILOVER' : null,
    ]
    this.#gateSub.textContent = notes.filter(Boolean).join(' · ')
    if (changed === 'rush') this.#tempo()
  }

  #depart() {
    const team = pick(TEAMS)
    const tiers: { tier: Tier; weight: number }[] = [
      { tier: 'fast', weight: team.name === 'support' ? 70 : 52 },
      { tier: 'balanced', weight: 32 },
      { tier: 'reasoning', weight: team.name === 'platform' || team.name === 'legal' ? 26 : 12 },
    ]
    const { tier } = pick(tiers)
    const feature = gsap.utils.random(team.features)
    const pii =
      Math.random() < (team.name === 'support' || team.name === 'legal' ? 0.6 : 0.25)
        ? gsap.utils.random(1, 3, 1)
        : 0
    const verdict = decide(policy, team, tier, pii)

    const shape = SHAPE[tier]
    const k = gsap.utils.random(0.5, 1.6) * this.opts.scale
    const model = 'model' in verdict ? verdict.model : undefined
    const costMicros = model
      ? Math.round(k * (shape.input * model.price.input + shape.output * model.price.output))
      : 0

    const departure: Departure = {
      team,
      feature,
      tier,
      pii,
      costMicros,
      fallback: 'fallback' in verdict ? verdict.fallback : false,
      ...(model && { model }),
      ...('held' in verdict && { held: verdict.held }),
    }
    this.#run(departure)
  }

  #run(d: Departure) {
    const teamIndex = TEAMS.indexOf(d.team)
    const modelIndex = d.model ? MODELS.indexOf(d.model) : -1
    const pts: Point[] = [
      ...teamLeg(teamIndex),
      ...(modelIndex >= 0 ? platformLeg(modelIndex) : [[FAN_X, TRUNK_Y] as Point]),
    ]
    const { total, upto } = lengthTo(pts, GATE.x + GATE.w / 2)

    const route = el('path', { d: toD(pts), class: 'route' })
    const train = el('g', { class: `train${d.pii ? ' is-pii' : ''}` })
    train.append(el('rect', { x: -15, y: -5, width: 30, height: 10, rx: 5 }))
    this.#trains.append(route, train)

    const done = () => {
      route.remove()
      train.remove()
    }
    const motion = (start: number, end: number) => ({
      path: route,
      align: route,
      alignOrigin: [0.5, 0.5] as [number, number],
      autoRotate: true,
      start,
      end,
    })

    const tl = gsap.timeline({ onComplete: done })
    const toGate = upto / total
    tl.to(train, { motionPath: motion(0, toGate), duration: upto / SPEED, ease: 'none' })

    if (d.held) {
      tl.add(() => train.classList.add('is-held'))
        // Inline style, not the attribute: the stylesheet would win over it.
        .to(this.#gate, { stroke: '#ff5a3c', duration: 0.08, yoyo: true, repeat: 3 })
        .to(train, { opacity: 0, duration: 0.4 })
        .add(() => {
          gsap.set(this.#gate, { clearProps: 'stroke' })
          this.opts.onDeparture?.(d)
        })
    } else {
      tl.to(
        this.#blade,
        { morphSVG: blade(modelIndex), duration: 0.22, ease: 'power2.inOut' },
        '-=0.3',
      )
        .to(train, {
          motionPath: motion(toGate, 1),
          duration: (total - upto) / SPEED,
          ease: 'power1.in',
        })
        .add(() => {
          const lamp = this.#lamps.get(d.model?.name ?? '')
          if (lamp && !lamp.classList.contains('is-red')) {
            lamp.classList.add('is-on')
            gsap.delayedCall(0.35, () => lamp.classList.remove('is-on'))
          }
          this.opts.onDeparture?.(d)
        })
        .to(train, { opacity: 0, duration: 0.2 })
    }

    this.traffic.add(tl, this.traffic.time())
  }
}
