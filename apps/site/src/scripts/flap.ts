import { gsap } from 'gsap'
import { CustomEase } from 'gsap/CustomEase'

gsap.registerPlugin(CustomEase)

// The lower leaf lands, bounces once on its stop, settles.
const land = CustomEase.create(
  'flap-land',
  'M0,0 C0.2,0 0.35,1.12 0.5,1.08 0.62,1.04 0.75,0.98 1,1',
)

const DIGITS = '0123456789'
const STEP = 0.07

interface Cell {
  root: HTMLElement
  char: string
  busy: gsap.core.Timeline | null
}

const leaf = (cls: string, char: string) => `<span class="${cls}"><b>${char}</b></span>`

/** A split-flap display. Digits roll through the intermediate values like the real drums. */
export class Flaps {
  readonly #cells: Cell[] = []

  constructor(
    readonly root: HTMLElement,
    readonly width: number,
  ) {
    for (let i = 0; i < width; i++) {
      const el = document.createElement('div')
      el.className = 'flap'
      el.innerHTML = leaf('top', ' ') + leaf('bottom', ' ')
      root.append(el)
      this.#cells.push({ root: el, char: ' ', busy: null })
    }
  }

  set(text: string) {
    const padded = text.padStart(this.width, ' ').slice(-this.width)
    this.#cells.forEach((cell, i) => {
      const next = padded[i] ?? ' '
      cell.root.classList.toggle('is-sep', !/[0-9 ]/.test(next))
      if (next !== cell.char) this.#roll(cell, next)
    })
  }

  #roll(cell: Cell, target: string) {
    cell.busy?.progress(1)
    const steps: string[] = []
    const from = DIGITS.indexOf(cell.char)
    const to = DIGITS.indexOf(target)
    if (from !== -1 && to !== -1) {
      for (let d = (from + 1) % 10; d !== to; d = (d + 1) % 10) steps.push(DIGITS[d] as string)
    }
    steps.push(target)

    const tl = gsap.timeline({ onComplete: () => (cell.busy = null) })
    let current = cell.char
    for (const [n, next] of steps.entries()) {
      const prev = current
      const last = n === steps.length - 1
      tl.add(() => this.#leaf(cell.root, prev, next, last ? 0.28 : STEP * 1.6))
      tl.to({}, { duration: last ? 0.28 : STEP })
      current = next
    }
    cell.char = target
    cell.busy = tl
  }

  #leaf(root: HTMLElement, prev: string, next: string, duration: number) {
    const top = root.querySelector('.top b') as HTMLElement
    const bottom = root.querySelector('.bottom b') as HTMLElement
    root.insertAdjacentHTML('beforeend', leaf('flip-top', prev) + leaf('flip-bottom', next))
    const flipTop = root.querySelector('.flip-top') as HTMLElement
    const flipBottom = root.querySelector('.flip-bottom') as HTMLElement
    top.textContent = next

    gsap
      .timeline({
        onComplete: () => {
          bottom.textContent = next
          flipTop.remove()
          flipBottom.remove()
        },
      })
      .fromTo(
        flipTop,
        { rotateX: 0 },
        { rotateX: -90, duration: duration * 0.45, ease: 'power2.in' },
      )
      .fromTo(flipBottom, { rotateX: 90 }, { rotateX: 0, duration: duration * 0.55, ease: land })
  }
}
