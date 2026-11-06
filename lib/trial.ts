// Free trial length for paid plans, used at company sign-up and when an
// admin switches to a paid plan in Settings.
export const TRIAL_DAYS = 30

export function trialEndDate(): string {
  return new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
}
