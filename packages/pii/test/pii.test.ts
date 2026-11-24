import { describe, expect, it } from 'vitest'
import { detect, ibanValid, luhn, nirValid, streamRestorer, Vault } from '../src/index.js'

const kinds = (text: string) => detect(text).map((f) => [f.kind, f.value])

describe('checksums', () => {
  it('luhn', () => {
    expect(luhn('4111111111111111')).toBe(true)
    expect(luhn('4111111111111112')).toBe(false)
  })

  it('iban mod 97', () => {
    expect(ibanValid('FR76 3000 6000 0112 3456 7890 189')).toBe(true)
    expect(ibanValid('FR76 3000 6000 0112 3456 7890 188')).toBe(false)
    expect(ibanValid('DE89370400440532013000')).toBe(true)
  })

  it('nir key, including Corsica', () => {
    expect(nirValid('2 69 05 49 588 157 80')).toBe(true)
    expect(nirValid('2 69 05 49 588 157 81')).toBe(false)
    expect(nirValid('1 85 05 2A 004 123 56')).toBe(true)
  })
})

describe('detect', () => {
  it('finds each kind', () => {
    expect(
      kinds(
        'Mail jeanne.martin@acme.fr or call 06 12 34 56 78, IBAN FR7630006000011234567890189, ' +
          'card 4111 1111 1111 1111, NIR 2 69 05 49 588 157 80, from 192.168.10.4',
      ),
    ).toEqual([
      ['EMAIL', 'jeanne.martin@acme.fr'],
      ['PHONE', '06 12 34 56 78'],
      ['IBAN', 'FR7630006000011234567890189'],
      ['CARD', '4111 1111 1111 1111'],
      ['NIR', '2 69 05 49 588 157 80'],
      ['IPV4', '192.168.10.4'],
    ])
  })

  it('ignores lookalikes that fail their checksum', () => {
    expect(kinds('order 4111 1111 1111 1112 shipped')).toEqual([])
    expect(kinds('ref FR7630006000011234567890188')).toEqual([])
  })

  it('does not split an IBAN into phone numbers', () => {
    expect(kinds('FR76 3000 6000 0112 3456 7890 189').map(([k]) => k)).toEqual(['IBAN'])
  })

  it('leaves version numbers and dates alone', () => {
    expect(kinds('upgrade to 1.2.3 before 2026-11-24, ticket #4821')).toEqual([])
  })
})

describe('vault', () => {
  it('round-trips and reuses tokens for repeated values', () => {
    const vault = new Vault()
    const text = 'Ask ana@corp.io. Again: ana@corp.io, cc bo@corp.io'
    const redacted = vault.redact(text)
    expect(redacted).toBe('Ask ⟦EMAIL_1⟧. Again: ⟦EMAIL_1⟧, cc ⟦EMAIL_2⟧')
    expect(vault.restore(redacted)).toBe(text)
    expect(vault.counts).toEqual({ EMAIL: 2 })
  })

  it('leaves tokens it did not issue untouched', () => {
    expect(new Vault().restore('⟦EMAIL_7⟧')).toBe('⟦EMAIL_7⟧')
  })
})

describe('streamRestorer', () => {
  const vault = new Vault()
  vault.redact('write to ana@corp.io')

  it('restores a token split across chunks', () => {
    const r = streamRestorer(vault)
    const out =
      ['Sent to ⟦EM', 'AIL', '_1⟧ just', ' now'].map((c) => r.push(c)).join('') + r.flush()
    expect(out).toBe('Sent to ana@corp.io just now')
  })

  it('does not hold text forever after a stray bracket', () => {
    const r = streamRestorer(vault)
    expect(r.push('⟦ this is not a token at all')).toBe('⟦ this is not a token at all')
  })

  it('flushes a dangling prefix as is', () => {
    const r = streamRestorer(vault)
    expect(r.push('end ⟦EMA')).toBe('end ')
    expect(r.flush()).toBe('⟦EMA')
  })
})
