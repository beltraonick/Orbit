// Client-side guard for database writes: if Supabase returns an error, tell
// the user instead of silently carrying on as if it worked (which is how
// settings and edits appeared to "revert" after leaving a page).
export function writeFailed(error: unknown, action = 'save your changes'): boolean {
  if (!error) return false
  const detail = (error as { message?: string })?.message
  console.error(`[write-failed] ${action}${detail ? `: ${detail}` : ''}`)
  if (typeof window !== 'undefined') window.alert(`Could not ${action}. Please try again.`)
  return true
}

// Same idea for server actions that return { error } instead of throwing.
export function actionFailed(result: unknown): boolean {
  const err = (result as { error?: string } | null | undefined)?.error
  if (!err) return false
  console.error(`[action-failed] ${err}`)
  if (typeof window !== 'undefined') window.alert(err)
  return true
}
