import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { ScheduleManager } from './ScheduleManager'

export default function AdminSchedulePage() {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') redirect('/login')
  return <ScheduleManager />
}
