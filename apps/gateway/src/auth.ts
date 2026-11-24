import { createHash, timingSafeEqual } from 'node:crypto'
import type { Config } from './config.js'

const digest = (key: string) => createHash('sha256').update(key).digest()

/** Config holds hashes only, so the file can sit in a repo or a ConfigMap. */
export function keyring(config: Config) {
  const entries = Object.entries(config.teams).flatMap(([team, t]) =>
    t.keys.map((hex) => ({ team, hash: Buffer.from(hex, 'hex') })),
  )
  return (presented: string | undefined) => {
    if (!presented) return undefined
    const hash = digest(presented)
    return entries.find((e) => timingSafeEqual(e.hash, hash))?.team
  }
}
