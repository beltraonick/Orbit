// Free trial for paid plans: 30 days counted from the company's sign-up,
// never restarted by switching plans later (lib callers: company sign-up and
// the plan switch in Settings).
export const TRIAL_DAYS = 30

/** Trial end for a company created at `signedUpAt` (default: now, i.e. a new sign-up). */
export function trialEndDate(signedUpAt?: string | null): string {
  const start = signedUpAt ? new Date(signedUpAt).getTime() : Date.now()
  const base = Number.isNaN(start) ? Date.now() : start
  return new Date(base + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
}
