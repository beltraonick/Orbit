import 'server-only'
import webpush from 'web-push'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

// Sends phone/desktop push notifications (Web Push, works on an iPhone for
// the app added to the Home Screen, iOS 16.4+). Uses the service role because
// push_subscriptions has no RLS policies on purpose — callers must decide
// WHO gets notified from data they already authorized.
//
// Never throws: a notification is a side effect, so a failure here is logged
// and must not break the action that triggered it (saving a task, paying…).

export type NotificationCategory = 'tasks' | 'payroll' | 'projects' | 'time'

export interface PushMessage {
  title: string
  body: string
  url: string // in-app path opened when the notification is tapped
}

let configured: boolean | null = null
function configure(): boolean {
  if (configured !== null) return configured
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) {
    configured = false
    return false
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@orbitops.app', publicKey, privateKey)
  configured = true
  return true
}

export function pushConfigured(): boolean {
  return configure()
}

/** Notify these people, skipping anyone who turned this category off
 *  (category null = a device test, sent regardless of the switches). */
export async function notifyProfiles(
  profileIds: string[],
  category: NotificationCategory | null,
  message: PushMessage,
): Promise<{ sent: number }> {
  const ids = Array.from(new Set(profileIds.filter(Boolean)))
  if (ids.length === 0 || !configure()) return { sent: 0 }
  try {
    const supabase = createServiceRoleClient()
    const { data: people, error: peopleErr } = await supabase
      .from('profiles')
      .select('id, notification_prefs')
      .in('id', ids)
    if (peopleErr) throw peopleErr
    const wanted = (people ?? [])
      .filter(p => category === null || (p.notification_prefs as Record<string, boolean> | null)?.[category] !== false)
      .map(p => p.id as string)
    if (wanted.length === 0) return { sent: 0 }

    const { data: subs, error: subsErr } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('profile_id', wanted)
    if (subsErr) throw subsErr

    const payload = JSON.stringify(message)
    let sent = 0
    const expired: string[] = []
    await Promise.all((subs ?? []).map(async s => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24 })
        sent++
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        // 404/410 = the device unsubscribed or the app was removed: forget it.
        if (status === 404 || status === 410) expired.push(s.id)
        else console.error('[push] send failed', status ?? '', (err as Error).message)
      }
    }))
    if (expired.length > 0) await supabase.from('push_subscriptions').delete().in('id', expired)
    return { sent }
  } catch (err) {
    console.error('[push] notify failed:', (err as Error).message)
    return { sent: 0 }
  }
}

/** Every active admin of a company. */
export async function companyAdminIds(companyId: string): Promise<string[]> {
  try {
    const { data } = await createServiceRoleClient()
      .from('profiles')
      .select('id')
      .eq('company_id', companyId)
      .eq('role', 'admin')
      .eq('auth_status', 'approved')
    return (data ?? []).map(p => p.id as string)
  } catch {
    return []
  }
}
