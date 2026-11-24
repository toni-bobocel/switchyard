import { createHash, randomBytes } from 'node:crypto'

const key = `sy_${randomBytes(24).toString('base64url')}`
const hash = createHash('sha256').update(key).digest('hex')

process.stdout.write(
  `key   ${key}\nhash  ${hash}\n\nGive the key to the team, put the hash in switchyard.json.\n`,
)
