'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { stopImpersonation } from '@/app/actions/owner'

export function ImpersonationBannerClient({ name }: { name: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleStop() {
    setLoading(true)
    const res = await stopImpersonation()
    if (res.error) console.error('[impersonation]', res.error)
    router.push('/owner/dashboard')
    router.refresh()
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[100] bg-amber text-black text-sm font-medium px-4 py-2.5 flex items-center justify-center gap-3 safe-bottom shadow-[0_-2px_8px_rgba(0,0,0,0.15)]">
      <span className="truncate">Navegando como {name}</span>
      <button
        onClick={handleStop}
        disabled={loading}
        className="underline font-semibold flex-shrink-0 disabled:opacity-60"
      >
        Voltar para o painel do dono
      </button>
    </div>
  )
}
