import { createHash, randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'

const LEGACY_SALT = 'upper_construction_2024'
const BCRYPT_ROUNDS = 12

// Bcrypt hashes always start with $2a$ or $2b$; legacy hashes are 64-char hex.
export function isLegacyHash(hash: string): boolean {
  return !hash.startsWith('$2')
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS)
}

// Used only during migration — verifying a legacy hash on first login.
function hashPasswordLegacy(password: string): string {
  return createHash('sha256').update(LEGACY_SALT + password).digest('hex')
}

export function verifyPassword(password: string, hash: string): boolean {
  if (isLegacyHash(hash)) {
    return hashPasswordLegacy(password) === hash
  }
  return bcrypt.compareSync(password, hash)
}

export function generateId(): string {
  return randomBytes(16).toString('hex')
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

/** Generates a cryptographically random token (64 hex chars) for one-time URLs. */
export function generateSecureToken(): string {
  return randomBytes(32).toString('hex')
}

/** SHA-256 hash of a token for safe DB storage (never store raw tokens). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Generates a human-readable invite code, e.g. "A3BX-9KF2". */
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  const bytes = randomBytes(8)
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length]
    if (i === 3) code += '-'
  }
  return code
}
