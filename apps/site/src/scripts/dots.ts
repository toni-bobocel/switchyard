import { gsap } from 'gsap'
import { MARK_PATH } from '../mark'

// A halftone field: every shape is rasterised to a grid, thresholded with a
// Bayer matrix so density follows intensity, and each lit cell becomes a
// particle. Particles spring toward their cell, flee the pointer, and are
// reassigned when the shape changes, which is what reads as a morph.

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)

export type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void

export interface Placement {
  paint: Painter
  /** Box in CSS pixels, relative to the canvas. */
  x: number
  y: number
  w: number
  h: number
}

interface Options {
  step?: number
  dot?: number
  color: string
  reach?: number
}

export class Dots {
  readonly #ctx: CanvasRenderingContext2D
  readonly #step: number
  readonly #dot: number
  readonly #reach: number
  #w = 0
  #h = 0
  #dpr = 1
  #xs = new Float32Array(0)
  #ys = new Float32Array(0)
  #vx = new Float32Array(0)
  #vy = new Float32Array(0)
  #tx = new Float32Array(0)
  #ty = new Float32Array(0)
  #alpha = new Float32Array(0)
  #ta = new Float32Array(0)
  #count = 0
  #pointer = { x: -9999, y: -9999 }
  readonly spring = { k: 0.07 }
  #placement: Placement | null = null

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly opts: Options,
  ) {
    this.#ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    this.#step = opts.step ?? 6
    this.#dot = opts.dot ?? 2.2
    this.#reach = opts.reach ?? 90
    this.resize()
    addEventListener('resize', () => {
      this.resize()
      if (this.#placement) this.show(this.#placement, false)
    })
    addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect()
      this.#pointer.x = e.clientX - r.left
      this.#pointer.y = e.clientY - r.top
    })
    gsap.ticker.add(this.#frame)
  }

  resize() {
    const r = this.canvas.getBoundingClientRect()
    this.#dpr = Math.min(devicePixelRatio, 2)
    this.#w = r.width
    this.#h = r.height
    this.canvas.width = r.width * this.#dpr
    this.canvas.height = r.height * this.#dpr
  }

  get width() {
    return this.#w
  }

  get height() {
    return this.#h
  }

  /** Rasterise a shape into the given box and send the particles there. */
  show(p: Placement, burst = true) {
    this.#placement = p
    const cells = this.#sample(p)
    this.#ensure(cells.length)
    for (let i = 0; i < this.#count; i++) {
      const cell = cells[i]
      if (cell) {
        this.#tx[i] = cell[0]
        this.#ty[i] = cell[1]
        this.#ta[i] = 0.55 + cell[2] * 0.45
      } else {
        this.#ta[i] = 0
      }
    }
    if (burst) this.scatter(3)
  }

  scatter(force = 9) {
    for (let i = 0; i < this.#count; i++) {
      this.#vx[i] = (Math.random() - 0.5) * force * 6
      this.#vy[i] = (Math.random() - 0.5) * force * 6
    }
    gsap.fromTo(
      this.spring,
      { k: 0.008 },
      { k: 0.07, duration: 1.6, ease: 'power2.in', overwrite: true },
    )
  }

  #ensure(n: number) {
    if (n <= this.#count) return
    const grow = (a: Float32Array) => {
      const b = new Float32Array(n)
      b.set(a)
      return b
    }
    const from = this.#count
    this.#xs = grow(this.#xs)
    this.#ys = grow(this.#ys)
    this.#vx = grow(this.#vx)
    this.#vy = grow(this.#vy)
    this.#tx = grow(this.#tx)
    this.#ty = grow(this.#ty)
    this.#alpha = grow(this.#alpha)
    this.#ta = grow(this.#ta)
    for (let i = from; i < n; i++) {
      this.#xs[i] = Math.random() * this.#w
      this.#ys[i] = Math.random() * this.#h
    }
    this.#count = n
  }

  #sample({ paint, x, y, w, h }: Placement) {
    const s = this.#step
    const cols = Math.max(1, Math.floor(w / s))
    const rows = Math.max(1, Math.floor(h / s))
    const off = document.createElement('canvas')
    off.width = cols
    off.height = rows
    const c = off.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
    paint(c, cols, rows)
    const data = c.getImageData(0, 0, cols, rows).data
    const cells: [number, number, number][] = []
    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        const a = (data[(r * cols + q) * 4 + 3] ?? 0) / 255
        if (a > (BAYER[(r % 4) * 4 + (q % 4)] ?? 1)) cells.push([x + q * s, y + r * s, a])
      }
    }
    // Shuffle so a morph does not sweep row by row.
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[cells[i], cells[j]] = [
        cells[j] as [number, number, number],
        cells[i] as [number, number, number],
      ]
    }
    return cells
  }

  #frame = () => {
    const ctx = this.#ctx
    const { k } = this.spring
    const reach2 = this.#reach * this.#reach
    const px = this.#pointer.x
    const py = this.#pointer.y
    ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0)
    ctx.clearRect(0, 0, this.#w, this.#h)
    ctx.fillStyle = this.opts.color
    for (let i = 0; i < this.#count; i++) {
      let vx = (this.#vx[i] ?? 0) + ((this.#tx[i] ?? 0) - (this.#xs[i] ?? 0)) * k
      let vy = (this.#vy[i] ?? 0) + ((this.#ty[i] ?? 0) - (this.#ys[i] ?? 0)) * k
      const dx = (this.#xs[i] ?? 0) - px
      const dy = (this.#ys[i] ?? 0) - py
      const d2 = dx * dx + dy * dy
      if (d2 < reach2) {
        const f = (1 - d2 / reach2) * 2.4
        const d = Math.sqrt(d2) || 1
        vx += (dx / d) * f
        vy += (dy / d) * f
      }
      vx *= 0.82
      vy *= 0.82
      this.#vx[i] = vx
      this.#vy[i] = vy
      this.#xs[i] = (this.#xs[i] ?? 0) + vx
      this.#ys[i] = (this.#ys[i] ?? 0) + vy
      const a = (this.#alpha[i] ?? 0) + ((this.#ta[i] ?? 0) - (this.#alpha[i] ?? 0)) * 0.08
      this.#alpha[i] = a
      if (a < 0.02) continue
      ctx.globalAlpha = a
      ctx.fillRect(this.#xs[i] ?? 0, this.#ys[i] ?? 0, this.#dot, this.#dot)
    }
    ctx.globalAlpha = 1
  }
}

// ───────── painters ─────────

export const markPainter: Painter = (c, w, h) => {
  const scale = Math.min(w / 100, h / 100)
  c.save()
  c.translate((w - 100 * scale) / 2, (h - 100 * scale) / 2)
  c.scale(scale, scale)
  const g = c.createLinearGradient(0, 0, 0, 100)
  g.addColorStop(0, 'rgba(0,0,0,0.35)')
  g.addColorStop(1, 'rgba(0,0,0,1)')
  c.strokeStyle = g
  c.lineWidth = 14
  c.lineJoin = 'miter'
  c.stroke(new Path2D(MARK_PATH))
  c.restore()
}

/** A soft cloud, like ink spreading on paper. */
export const cloudPainter =
  (seed: number): Painter =>
  (c, w, h) => {
    let s = seed
    const rand = () => {
      s = (s * 9301 + 49297) % 233280
      return s / 233280
    }
    for (let i = 0; i < 7; i++) {
      const x = w * (0.25 + rand() * 0.5)
      const y = h * (0.25 + rand() * 0.5)
      const r = Math.min(w, h) * (0.2 + rand() * 0.28)
      const g = c.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, 'rgba(0,0,0,0.75)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      c.fillStyle = g
      c.fillRect(0, 0, w, h)
    }
  }

export const textPainter =
  (text: string, family: string, weight = 400): Painter =>
  (c, w, h) => {
    let size = h
    c.font = `${weight} ${size}px ${family}`
    const width = c.measureText(text).width
    if (width > w) size *= w / width
    c.font = `${weight} ${size}px ${family}`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillStyle = '#000'
    c.fillText(text, w / 2, h / 2 + size * 0.05)
  }
