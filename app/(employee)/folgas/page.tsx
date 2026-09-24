import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { MyDaysOff } from './MyDaysOff'

export default function FolgasPage() {
  const user = getCurrentUser()
  if (!user) redirect('/login')
  if (user.status === 'pending') redirect('/pending')
  return <MyDaysOff />
}
