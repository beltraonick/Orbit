'use server'

import { getCurrentUser } from '@/lib/auth/session'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { notifyProfiles, companyAdminIds, pushConfigured, type NotificationCategory } from '@/lib/push'

// Everything here uses the service role, so every function checks the
// session itself and only ever touches the caller's own rows / company.

export type NotificationPrefs = Record<NotificationCategory, boolean>
const DEFAULT_PREFS: NotificationPrefs = { tasks: true, payroll: true, projects: true, time: true }

export async function getNotificationPrefs(): Promise<{ prefs: NotificationPrefs; configured: boolean }> {
  const user = getCurrentUser()
  if (!user) return { prefs: DEFAULT_PREFS, configured: false }
  try {
    const { data } = await createServiceRoleClient()
      .from('profiles').select('notification_prefs').eq('id', user.id).maybeSingle()
    return { prefs: { ...DEFAULT_PREFS, ...((data?.notification_prefs as Partial<NotificationPrefs>) ?? {}) }, configured: pushConfigured() }
  } catch {
    return { prefs: DEFAULT_PREFS, configured: pushConfigured() }
  }
}

export async function saveNotificationPrefs(prefs: NotificationPrefs): Promise<{ error?: string }> {
  const user = getCurrentUser()
  if (!user) return { error: 'Not authorized.' }
  const clean: NotificationPrefs = {
    tasks: prefs.tasks !== false, payroll: prefs.payroll !== false,
    projects: prefs.projects !== false, time: prefs.time !== false,
  }
  const { error } = await createServiceRoleClient()
    .from('profiles').update({ notification_prefs: clean }).eq('id', user.id)
  return error ? { error: 'Could not save your notification settings. Please try again.' } : {}
}

export async function savePushSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string): Promise<{ error?: string }> {
  const user = getCurrentUser()
  if (!user) return { error: 'Not authorized.' }
  if (!sub?.endpoint?.startsWith('https://') || !sub.keys?.p256dh || !sub.keys?.auth) return { error: 'Invalid subscription.' }
  const { error } = await createServiceRoleClient().from('push_subscriptions').upsert({
    profile_id: user.id,
    company_id: user.company_id ?? null,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    user_agent: userAgent?.slice(0, 300) ?? null,
  }, { onConflict: 'endpoint' })
  return error ? { error: 'Could not turn on notifications. Please try again.' } : {}
}

export async function removePushSubscription(endpoint: string): Promise<{ error?: string }> {
  const user = getCurrentUser()
  if (!user) return { error: 'Not authorized.' }
  const { error } = await createServiceRoleClient()
    .from('push_subscriptions').delete().eq('endpoint', endpoint).eq('profile_id', user.id)
  return error ? { error: 'Could not turn off notifications. Please try again.' } : {}
}

export async function sendTestNotification(): Promise<{ error?: string; sent?: number }> {
  const user = getCurrentUser()
  if (!user) return { error: 'Not authorized.' }
  const { data } = await createServiceRoleClient().from('push_subscriptions').select('id').eq('profile_id', user.id)
  if (!data?.length) return { error: 'Notifications are not turned on for this device yet.' }
  const { sent } = await notifyProfiles([user.id], null, {
    title: 'OrbitOps',
    body: 'Notifications are working on this device ✅',
    url: '/profile',
  })
  return sent > 0 ? { sent } : { error: 'Could not deliver a test notification. Turn notifications off and on again.' }
}

// ── Event triggers called by screens right after a successful save ────────

/** Admin/supervisor assigned people to a task. */
export async function notifyTaskAssigned(taskId: string, profileIds: string[]): Promise<void> {
  const user = getCurrentUser()
  if (!user?.company_id || profileIds.length === 0) return
  const sb = createServiceRoleClient()
  const { data: task } = await sb.from('tasks').select('title, company_id, project:project_id(name)')
    .eq('id', taskId).eq('company_id', user.company_id).maybeSingle()
  if (!task) return
  const { data: people } = await sb.from('profiles').select('id')
    .in('id', profileIds).eq('company_id', user.company_id)
  const targets = (people ?? []).map(p => p.id as string).filter(id => id !== user.id)
  const project = (task.project as unknown as { name: string } | null)?.name
  await notifyProfiles(targets, 'tasks', {
    title: 'New task assigned',
    body: `${task.title}${project ? ` — ${project}` : ''}`,
    url: '/tasks',
  })
}

/** Admin gave someone access to projects. */
export async function notifyAddedToProjects(profileId: string, projectIds: string[]): Promise<void> {
  const user = getCurrentUser()
  if (!user?.company_id || user.role !== 'admin' || projectIds.length === 0 || profileId === user.id) return
  const sb = createServiceRoleClient()
  const { data: projects } = await sb.from('projects').select('name')
    .in('id', projectIds).eq('company_id', user.company_id)
  const names = (projects ?? []).map(p => p.name as string)
  if (names.length === 0) return
  await notifyProfiles([profileId], 'projects', {
    title: names.length === 1 ? 'Added to a project' : `Added to ${names.length} projects`,
    body: names.join(', '),
    url: '/projects',
  })
}

/** Client approved or declined a change order → the company's admins. */
export async function notifyChangeOrderDecision(changeOrderId: string): Promise<void> {
  const user = getCurrentUser()
  if (!user?.company_id) return
  const sb = createServiceRoleClient()
  const { data: co } = await sb.from('change_orders').select('title, amount, status, company_id, project:project_id(name)')
    .eq('id', changeOrderId).eq('company_id', user.company_id).maybeSingle()
  if (!co || (co.status !== 'approved' && co.status !== 'rejected')) return
  const project = (co.project as unknown as { name: string } | null)?.name
  const amount = Number(co.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  await notifyProfiles(await companyAdminIds(user.company_id), 'projects', {
    title: `Change order ${co.status === 'approved' ? 'approved ✅' : 'declined'}`,
    body: `${co.title} (${amount})${project ? ` — ${project}` : ''}`,
    url: '/admin/change-orders',
  })
}

/** Several tasks assigned to one person at once (bulk assign) → one notification. */
export async function notifyTasksAssignedBulk(profileId: string, taskIds: string[]): Promise<void> {
  const user = getCurrentUser()
  if (!user?.company_id || taskIds.length === 0 || profileId === user.id) return
  const sb = createServiceRoleClient()
  const [{ data: person }, { count }] = await Promise.all([
    sb.from('profiles').select('id').eq('id', profileId).eq('company_id', user.company_id).maybeSingle(),
    sb.from('tasks').select('id', { count: 'exact', head: true }).in('id', taskIds).eq('company_id', user.company_id),
  ])
  if (!person || !count) return
  await notifyProfiles([profileId], 'tasks', {
    title: count === 1 ? 'New task assigned' : `${count} tasks assigned to you`,
    body: 'Open Tasks to see them.',
    url: '/tasks',
  })
}
