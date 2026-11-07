'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { useAIConsent } from '@/components/AIConsent'

interface ActionInfo {
  tool: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any
  summary: string
  status: 'proposed' | 'confirmed' | 'cancelled' | 'failed'
  result?: string
}

interface Message {
  id?: string
  role: 'user' | 'assistant'
  content: string
  action?: ActionInfo | null
}

interface Conversation {
  id: string
  title: string | null
  created_at: string
  updated_at: string
}

function OrbitSphere({ active, size = 28 }: { active: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" className={active ? 'orbit-ai-spin' : ''}>
      <circle cx="14" cy="14" r="12.5" fill="none" stroke="rgba(193,18,31,0.5)" strokeWidth="1" />
      <circle cx="14" cy="14" r="8.5" fill="none" stroke="rgba(193,18,31,0.75)" strokeWidth="1.25" />
      <circle cx="14" cy="14" r="4.5" fill="none" stroke="rgba(193,18,31,1)" strokeWidth="1.5" />
      <circle cx="14" cy="14" r="1.5" fill="rgba(193,18,31,0.9)" />
    </svg>
  )
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1 items-center h-4">
      <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-bounce" style={{ animationDelay: '300ms' }} />
    </span>
  )
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
      <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
    </svg>
  )
}

const SUGGESTIONS_KEY = [
  'admin.aiChat.suggestion1',
  'admin.aiChat.suggestion2',
  'admin.aiChat.suggestion3',
  'admin.aiChat.suggestion4',
]

function ActionCard({ message, onDecide, t }: {
  message: Message
  onDecide: (messageId: string, decision: 'confirm' | 'cancel') => void
  t: (key: string) => string
}) {
  const action = message.action!
  return (
    <div className="max-w-[85%] md:max-w-[65%] rounded-card border border-brand/25 bg-brand/5 px-3.5 py-3 space-y-2">
      <p className="text-sm text-primary">{action.summary}</p>
      {action.status === 'proposed' && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onDecide(message.id!, 'confirm')}
            className="px-3 py-1.5 rounded-button bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors"
          >
            {t('admin.aiChat.confirm')}
          </button>
          <button
            onClick={() => onDecide(message.id!, 'cancel')}
            className="px-3 py-1.5 rounded-button bg-surface-elevated border border-[var(--border)] text-xs font-medium text-secondary hover:text-primary transition-colors"
          >
            {t('common.cancel')}
          </button>
        </div>
      )}
      {action.status === 'confirmed' && (
        <p className="text-xs text-green flex items-center gap-1.5">✓ {action.result ?? t('admin.aiChat.actionDone')}</p>
      )}
      {action.status === 'failed' && (
        <p className="text-xs text-danger">⚠ {action.result ?? t('admin.aiChat.actionFailed')}</p>
      )}
      {action.status === 'cancelled' && (
        <p className="text-xs text-tertiary">{t('admin.aiChat.actionCancelled')}</p>
      )}
    </div>
  )
}

export default function AdminAIPage() {
  const { t } = useTranslation()
  const { ensureConsent, dialog: consentDialog } = useAIConsent()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [loadingList, setLoadingList] = useState(true)
  const [quotaError, setQuotaError] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const activeIdRef = useRef<string | null>(null)

  useEffect(() => { activeIdRef.current = activeId }, [activeId])

  const loadConversations = useCallback(async () => {
    const res = await fetch('/api/orbit-ai/conversations')
    if (!res.ok) { setLoadingList(false); return }
    const data = await res.json()
    setConversations(data.conversations ?? [])
    setLoadingList(false)
    return data.conversations as Conversation[]
  }, [])

  const selectConversation = useCallback(async (id: string) => {
    setActiveId(id)
    setQuotaError('')
    setSidebarOpen(false)
    const res = await fetch(`/api/orbit-ai/conversations/${id}/messages`)
    if (!res.ok) { setMessages([]); return }
    const data = await res.json()
    setMessages((data.messages ?? []).map((m: Message) => ({ id: m.id, role: m.role, content: m.content, action: m.action })))
  }, [])

  useEffect(() => {
    loadConversations().then(list => {
      if (list && list.length > 0) selectConversation(list[0].id)
    })
    inputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function newConversation() {
    setQuotaError('')
    setCreating(true)
    setSidebarOpen(false)
    const res = await fetch('/api/orbit-ai/conversations', { method: 'POST' })
    const data = await res.json()
    if (!res.ok) {
      setQuotaError(data.error ?? t('admin.aiChat.limitReached'))
      setCreating(false)
      return null
    }
    setConversations(prev => [data.conversation, ...prev])
    await selectConversation(data.conversation.id)
    setCreating(false)
    return data.conversation.id as string
  }

  async function deleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    await fetch(`/api/orbit-ai/conversations/${id}`, { method: 'DELETE' })
    setConversations(prev => prev.filter(c => c.id !== id))
    if (activeId === id) {
      setActiveId(null)
      setMessages([])
    }
  }

  async function decideAction(messageId: string, decision: 'confirm' | 'cancel') {
    const convId = activeIdRef.current
    if (!convId) return
    const res = await fetch(`/api/orbit-ai/conversations/${convId}/messages/${messageId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    })
    const data = await res.json()
    if (data.message) {
      setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, action: data.message.action } : m)))
    }
  }

  async function send(question?: string) {
    const q = (question ?? input).trim()
    if (!q || loading) return
    if (!(await ensureConsent())) return
    setInput('')
    setQuotaError('')

    let convId = activeIdRef.current
    if (!convId) {
      convId = await newConversation()
      if (!convId) return
    }

    setMessages(prev => [...prev, { role: 'user', content: q }])
    setLoading(true)

    try {
      const res = await fetch(`/api/orbit-ai/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: q }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok || data?.error) {
        setMessages(m => [...m, { role: 'assistant', content: data?.error || t('admin.aiChat.somethingWrong') }])
      } else if (data?.messages?.length) {
        setMessages(m => [
          ...m,
          ...data.messages.map((msg: Message) => ({ id: msg.id, role: 'assistant', content: msg.content, action: msg.action })),
        ])
      }

      loadConversations()
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: t('admin.aiChat.connectionError') }])
    }

    setLoading(false)
  }

  const SUGGESTIONS = SUGGESTIONS_KEY.map(key => t(key))

  return (
    <div className="h-[calc(100dvh-56px)] md:h-screen flex overflow-hidden">
      {consentDialog}
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Conversation sidebar */}
      <aside
        className={[
          'flex flex-col w-72 flex-shrink-0 bg-surface-elevated border-r border-[var(--border)] overflow-hidden',
          'fixed md:static inset-y-0 left-0 z-50 md:z-auto transition-transform duration-200',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        ].join(' ')}
      >
        <div className="p-3 flex-shrink-0">
          <button
            onClick={newConversation}
            disabled={creating}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-button text-sm font-medium bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-60"
          >
            + {t('admin.aiChat.newChat')}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
          {!loadingList && conversations.map(c => (
            <button
              key={c.id}
              onClick={() => selectConversation(c.id)}
              className={[
                'w-full flex items-center gap-2 px-3 py-2.5 rounded-button text-sm text-left transition-colors group',
                c.id === activeId
                  ? 'bg-surface text-primary font-medium'
                  : 'text-secondary hover:bg-surface hover:text-primary',
              ].join(' ')}
            >
              <span className="flex-1 min-w-0 truncate">{c.title || t('admin.aiChat.untitled')}</span>
              <span
                onClick={e => deleteConversation(c.id, e)}
                className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-tertiary hover:text-danger transition-opacity"
                title={t('common.delete')}
              >
                ×
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* Chat column */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(o => !o)}
            className="md:hidden p-1.5 -ml-1.5 rounded-button text-secondary hover:text-primary hover:bg-surface-elevated transition-colors"
            aria-label="Toggle conversations"
          >
            <MenuIcon />
          </button>
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'radial-gradient(circle at 35% 35%, #1c1c1e, #0a0a0a)', boxShadow: '0 0 12px rgba(193,18,31,0.3)' }}
          >
            <OrbitSphere active={loading || creating} size={22} />
          </div>
          <div>
            <h1 className="text-base font-bold text-primary tracking-tight">OrbitOps AI</h1>
            <p className="text-[11px] text-green flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse inline-block" />
              {t('admin.aiChat.subtitle')}
            </p>
          </div>
        </div>

        {quotaError && (
          <div className="mx-4 mt-3 bg-amber/5 border border-amber/20 rounded-input px-4 py-3 text-sm text-amber flex-shrink-0">
            {quotaError}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
            {messages.length === 0 && !creating ? (
              <div className="flex flex-col items-center justify-center text-center px-4 py-16">
                <p className="text-sm text-secondary mb-4">{t('admin.aiChat.askAnything')}</p>
                <div className="flex flex-wrap gap-2 justify-center max-w-md">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="text-xs text-secondary bg-surface-elevated hover:text-primary hover:bg-black/[0.04] px-3 py-2 rounded-full transition-colors border border-[var(--border)]"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={m.id ?? i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {m.action ? (
                    <ActionCard message={m} onDecide={decideAction} t={t} />
                  ) : (
                    <div
                      className={[
                        'max-w-[85%] md:max-w-[70%] text-sm rounded-card px-3.5 py-2.5 leading-relaxed whitespace-pre-wrap',
                        m.role === 'user'
                          ? 'bg-brand text-white'
                          : 'bg-surface-elevated text-primary border border-[var(--border)]',
                      ].join(' ')}
                    >
                      {m.content}
                    </div>
                  )}
                </div>
              ))
            )}
            {(loading || creating) && (
              <div className="flex justify-start">
                <div className="max-w-[85%] md:max-w-[70%] text-sm rounded-card px-3.5 py-2.5 bg-surface-elevated text-primary border border-[var(--border)]">
                  <TypingDots />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-[var(--border)] flex-shrink-0">
          <div className="max-w-3xl mx-auto flex gap-2 p-3 md:p-4">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder={t('admin.aiChat.inputPlaceholder')}
              disabled={loading}
              className="flex-1 bg-surface-elevated text-sm text-primary placeholder:text-tertiary rounded-input px-4 py-2.5 border border-[var(--border)] focus:border-brand/50 outline-none transition-colors disabled:opacity-60"
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              className="px-4 py-2.5 rounded-button bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-40 flex-shrink-0"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
