import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/**
 * `promisify(scrypt)` 只会挑到无 options 的那个重载，带参数调用过不了 strict 类型
 * 检查，因此显式包一层。
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error)
      else resolve(derivedKey)
    })
  })
}

/**
 * 口令哈希（PLAN-002 §1.4）。
 *
 * 依赖里没有 bcrypt / argon2，也不需要引入：`node:crypto` 的 scrypt 是内存硬的
 * KDF，参数与 salt 一起编码进串，将来提参数不会打断旧记录。
 *
 * 绝不复用 `CVC_CREDENTIAL_MASTER_KEY`：那把 key 的职责是 provider 凭据「可解密」
 * 存储，口令必须是「不可逆」哈希，两者不能混（AGENTS.md §7）。
 */
const ALGORITHM = 'scrypt'
const COST = 16_384
const BLOCK_SIZE = 8
const PARALLELIZATION = 1
const SALT_BYTES = 16
const DIGEST_BYTES = 64
const FIELD_COUNT = 6

/** 编码格式：`scrypt$N$r$p$saltBase64Url$digestBase64Url`。 */
export async function hashPassword(plain: string): Promise<string> {
  if (!plain) throw new Error('password is required')
  const salt = randomBytes(SALT_BYTES)
  const digest = await derive(plain, salt)
  return [
    ALGORITHM,
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString('base64url'),
    digest.toString('base64url'),
  ].join('$')
}

/**
 * 校验口令。任何结构异常都返回 false 而不抛错：调用方只需要「通过 / 不通过」，
 * 抛错会把「哈希串坏了」和「口令错了」变成两种可区分的外部行为（§3.4）。
 */
export async function verifyPassword(plain: string, encoded: string): Promise<boolean> {
  const parsed = parseEncoded(encoded)
  if (!parsed || !plain) return false
  try {
    const digest = await derive(plain, parsed.salt, parsed)
    if (digest.length !== parsed.digest.length) return false
    return timingSafeEqual(digest, parsed.digest)
  } catch {
    return false
  }
}

interface ScryptParameters {
  cost: number
  blockSize: number
  parallelization: number
  salt: Buffer
  digest: Buffer
}

function derive(
  plain: string,
  salt: Buffer,
  parameters?: Pick<ScryptParameters, 'cost' | 'blockSize' | 'parallelization' | 'digest'>,
): Promise<Buffer> {
  const cost = parameters?.cost ?? COST
  const blockSize = parameters?.blockSize ?? BLOCK_SIZE
  const parallelization = parameters?.parallelization ?? PARALLELIZATION
  const keyLength = parameters?.digest.length ?? DIGEST_BYTES
  return scryptAsync(plain.normalize('NFKC'), salt, keyLength, {
    N: cost,
    r: blockSize,
    p: parallelization,
    // scrypt 的默认 maxmem 是 32 MiB；128 * N * r 必须留在其下，留 2 倍余量。
    maxmem: 128 * cost * blockSize * 2,
  })
}

function parseEncoded(encoded: string): ScryptParameters | null {
  if (typeof encoded !== 'string') return null
  const parts = encoded.split('$')
  if (parts.length !== FIELD_COUNT) return null
  const [algorithm, cost, blockSize, parallelization, salt, digest] = parts
  if (algorithm !== ALGORITHM) return null
  const numbers = [cost, blockSize, parallelization].map((value) => Number(value))
  if (numbers.some((value) => !Number.isSafeInteger(value) || value <= 0)) return null
  const saltBytes = decodeBase64Url(salt)
  const digestBytes = decodeBase64Url(digest)
  if (!saltBytes || !digestBytes || digestBytes.length < 16) return null
  return {
    cost: numbers[0]!,
    blockSize: numbers[1]!,
    parallelization: numbers[2]!,
    salt: saltBytes,
    digest: digestBytes,
  }
}

function decodeBase64Url(value: string | undefined): Buffer | null {
  if (!value) return null
  const decoded = Buffer.from(value, 'base64url')
  if (decoded.length === 0) return null
  return decoded
}
