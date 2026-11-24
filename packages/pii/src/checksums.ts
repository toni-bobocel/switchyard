export function luhn(digits: string) {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

// ISO 13616: move the country code and check digits to the end, map letters
// to 10..35, and the whole thing must be ≡ 1 (mod 97). Computed in chunks so
// a 34-character IBAN never needs a bigint.
export function ibanValid(raw: string) {
  const iban = raw.replace(/\s+/g, '').toUpperCase()
  if (iban.length < 15 || iban.length > 34) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const value = ch >= 'A' ? ch.charCodeAt(0) - 55 : Number(ch)
    remainder = Number(`${remainder}${value}`) % 97
  }
  return remainder === 1
}

// French NIR: 13 digits + a 2-digit key = 97 - (number mod 97). Corsican
// departments 2A and 2B are replaced by 19 and 18 before the computation.
export function nirValid(raw: string) {
  const nir = raw.replace(/\s+/g, '').toUpperCase()
  if (nir.length !== 15) return false
  const body = nir.slice(0, 13).replace('2A', '19').replace('2B', '18')
  if (!/^\d{13}$/.test(body)) return false
  const key = Number(nir.slice(13))
  return 97 - Number(BigInt(body) % 97n) === key
}
