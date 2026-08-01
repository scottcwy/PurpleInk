import { randomBytes } from 'node:crypto'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function generateRedemptionCode(planKey: 'plus' | 'pro' | 'max'): string {
  let value = BigInt(`0x${randomBytes(16).toString('hex')}`)
  let encoded = ''
  for (let index = 0; index < 26; index += 1) {
    encoded = ALPHABET[Number(value & BigInt(31))]! + encoded
    value >>= BigInt(5)
  }
  return `PI-${planKey.toUpperCase()}-${encoded.match(/.{1,5}/g)!.join('-')}`
}
