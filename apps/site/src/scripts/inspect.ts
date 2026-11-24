import { gsap } from 'gsap'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
import { onPolicy, policy } from './policy'

gsap.registerPlugin(ScrambleTextPlugin)

const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789⟦⟧'

/**
 * Left ticket: values turn into tokens one by one, each lighting the check
 * that caught it. Right ticket: the model's answer arrives with tokens and
 * they turn back into values on the way out, unless the team blocks PII.
 */
export function inspectDesk(root: HTMLElement) {
  const prompt = [...root.querySelectorAll<HTMLElement>('[data-prompt] .pii')]
  const answer = [...root.querySelectorAll<HTMLElement>('[data-answer] .pii')]
  const checks = [...root.querySelectorAll<HTMLElement>('.checks li')]
  const answerBody = root.querySelector<HTMLElement>('[data-answer] .ticket__body')
  const stamp = root.querySelector<HTMLElement>('.stamp')
  if (!answerBody || !stamp) return () => {}

  for (const el of [...prompt, ...answer]) el.dataset.original = el.textContent ?? ''

  let tl: gsap.core.Timeline | undefined

  const play = () => {
    tl?.kill()
    const block = policy.blockPii
    for (const el of prompt) {
      el.textContent = el.dataset.original ?? ''
      el.classList.remove('is-token')
    }
    for (const el of answer) {
      el.textContent = el.dataset.token ?? ''
      el.classList.add('is-token')
    }
    for (const li of checks) li.classList.remove('is-on')
    gsap.set(answerBody, { autoAlpha: 0, y: 10 })
    gsap.set(stamp, { autoAlpha: 0, scale: 1.6 })

    tl = gsap.timeline({ delay: 0.3 })
    prompt.forEach((el, i) => {
      const check = checks.find((li) => li.dataset.kind === el.dataset.kind)
      tl?.to(
        el,
        {
          duration: 0.7,
          scrambleText: {
            text: el.dataset.token ?? '',
            chars: TOKEN_CHARS,
            speed: 0.5,
            revealDelay: 0.2,
          },
          onStart: () => el.classList.add('is-token'),
        },
        i * 0.45,
      ).add(() => check?.classList.add('is-on'), i * 0.45 + 0.5)
    })

    if (block) {
      stamp.textContent = '422 · refused'
      tl.to(stamp, { autoAlpha: 1, scale: 1, duration: 0.35, ease: 'back.out(3)' }, '+=0.3')
      return
    }

    tl.to(answerBody, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power2.out' }, '+=0.35')
    answer.forEach((el, i) => {
      tl?.to(
        el,
        {
          duration: 0.8,
          scrambleText: { text: el.dataset.original ?? '', chars: 'lowerCase', speed: 0.45 },
          onComplete: () => el.classList.remove('is-token'),
        },
        `+=${i ? 0.1 : 0.5}`,
      )
    })
    stamp.textContent = '0 values left the building'
    tl.to(stamp, { autoAlpha: 1, scale: 1, duration: 0.35, ease: 'back.out(3)' }, '+=0.2')
  }

  onPolicy((_, changed) => {
    if (changed === 'blockPii') play()
  })
  return play
}
