// Distinguishes "the database/configuration failed" from "the user typed
// something wrong". Before this existed, a failed Supabase lookup (e.g.
// SUPABASE_SERVICE_ROLE_KEY missing) was swallowed and surfaced as
// "Invalid email or password." — indistinguishable from a real bad login,
// and invisible in the logs.

// User-facing messages. Deliberately vague: never reveal infrastructure
// details to someone who isn't logged in.
export const LOGIN_UNAVAILABLE_MESSAGE = "We couldn't complete the login right now. Please try again."
export const REQUEST_UNAVAILABLE_MESSAGE = "We couldn't complete this request right now. Please try again."

export class AuthInfrastructureError extends Error {
  constructor(public readonly operation: string) {
    super(`Auth infrastructure failure during ${operation}`)
    this.name = 'AuthInfrastructureError'
  }
}

// Logs a server-side diagnostic that is safe to keep in Vercel logs: the
// operation name plus the error's class/code/message. It never logs the
// inputs (email, password, tokens) and deliberately skips PostgREST's
// `details`/`hint` fields, which can echo row values back.
export function logAuthInfraFailure(operation: string, cause: unknown): void {
  const c = (cause ?? {}) as { name?: unknown; code?: unknown; message?: unknown }
  const name = typeof c.name === 'string' ? c.name : typeof cause
  const code = typeof c.code === 'string' ? c.code : '-'
  const message = typeof c.message === 'string' ? c.message.slice(0, 200) : '-'
  console.error(`[auth-infra] op=${operation} error=${name} code=${code} message=${message}`)
}

// Log and build the error in one step, for throw sites.
export function authInfraFailure(operation: string, cause: unknown): AuthInfrastructureError {
  logAuthInfraFailure(operation, cause)
  return new AuthInfrastructureError(operation)
}
