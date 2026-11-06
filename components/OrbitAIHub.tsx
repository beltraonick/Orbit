'use client'

import { useState, useRef, useEffect } from 'react'
import { useAIConsent } from '@/components/AIConsent'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  "How are today's projects?",
  "Who's clocked in right now?",
  "Show urgent tasks",
  "This week's hours summary",
]

function TypingDots() {
  return (
    <span className="inline-flex gap-1 items-center h-4">
      <span className="w-1.5 h-1.5 rounded-full bg-[rgba(255,255,255,0.3)] animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-[rgba(255,255,255,0.3)] animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-[rgba(255,255,255,0.3)] animate-bounce" style={{ animationDelay: '300ms' }} />
    </span>
  )
}

function HubSphere({ pulsing }: { pulsing: boolean }) {
  return (
    <div className={`orbit-hub-sphere ${pulsing ? 'orbit-hub-pulsing' : ''}`}>
      <svg width="88" height="88" viewBox="0 0 88 88" style={{ display: 'block' }}>
        {/* Outer halo */}
        <circle cx="44" cy="44" r="42" fill="none" stroke="rgba(193,18,31,0.06)" strokeWidth="0.5" />
        {/* Spinning rings */}
        <circle
          cx="44" cy="44" r="36"
          fill="none" stroke="rgba(193,18,31,0.18)" strokeWidth="0.8"
          strokeDasharray="5 9"
          className="hub-ring-cw"
          style={{ transformOrigin: '44px 44px' }}
        />
        <circle
          cx="44" cy="44" r="28.5"
          fill="none" stroke="rgba(193,18,31,0.32)" strokeWidth="1"
          strokeDasharray="4 7"
          className="hub-ring-ccw"
          style={{ transformOrigin: '44px 44px' }}
        />
        <circle
          cx="44" cy="44" r="21"
          fill="none" stroke="rgba(193,18,31,0.52)" strokeWidth="1.2"
          className="hub-ring-med"
          style={{ transformOrigin: '44px 44px' }}
        />
        {/* Core ring */}
        <circle cx="44" cy="44" r="13.5" fill="none" stroke="rgba(193,18,31,0.85)" strokeWidth="1.5" />
        {/* Core fill */}
        <circle cx="44" cy="44" r="5.5" fill="rgba(193,18,31,0.95)" />
        {/* Specular */}
        <ellipse cx="40" cy="39" rx="2.5" ry="1.5" fill="rgba(255,255,255,0.12)" transform="rotate(-15, 40, 39)" />
      </svg>
    </div>
  )
}

export function OrbitAIHub() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const { ensureConsent, dialog: consentDialog } = useAIConsent()
  const inputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120)
  }, [open])

  async function send(question?: string) {
    const q = (question ?? input).trim()
    if (!q || loading) return
    if (!(await ensureConsent())) return
    setInput('')
    setOpen(true)

    const next: Message[] = [...messages, { role: 'user', content: q }]
    setMessages(next)
    setLoading(true)

    try {
      const res = await fetch('/api/orbit-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })

      if (!res.ok) {
        const err = await res.text()
        setMessages(m => [...m, { role: 'assistant', content: err || 'Something went wrong.' }])
        setLoading(false)
        return
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let text = ''
      setMessages(m => [...m, { role: 'assistant', content: '' }])

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
        setMessages(m => [...m.slice(0, -1), { role: 'assistant', content: text }])
      }
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: 'Connection error. Please try again.' }])
    }

    setLoading(false)
  }

  return (
    <div className="mb-6 md:mb-8 orbit-hub-card">
      {consentDialog}
      {/* Top glow strip */}
      <div style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(193,18,31,0.09) 0%, transparent 65%)' }} className="rounded-t-card pt-7 pb-5 flex flex-col items-center">
        <button
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Close Orbit AI' : 'Open Orbit AI'}
          className="mb-4 transition-transform hover:scale-105 active:scale-95 duration-200"
        >
          <HubSphere pulsing={loading} />
        </button>

        <p className="text-sm font-semibold text-primary tracking-tight">Orbit AI</p>
        <p className="text-xs text-secondary mt-1 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse inline-block" />
          Business copilot · Admin only
        </p>

        {/* Suggestion chips — hidden when chat is open */}
        {!open && (
          <div className="flex gap-2 mt-4 flex-wrap justify-center px-4">
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-xs text-secondary bg-black/[0.03] hover:bg-black/[0.05] hover:text-primary px-3 py-1.5 rounded-full transition-colors border border-[var(--border)]"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chat area */}
      {open && (
        <>
          <div className="border-t border-[var(--border)]" />

          <div
            className="overflow-y-auto px-4 py-4 space-y-3"
            style={{ maxHeight: 340 }}
          >
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'assistant' && (
                  <div className="w-6 h-6 rounded-full flex-shrink-0 mt-0.5 mr-2 flex items-center justify-center" style={{ background: 'radial-gradient(circle at 35% 30%, #1c1c1e, #0a0a0a)', boxShadow: '0 0 8px rgba(193,18,31,0.3)' }}>
                    <svg width="12" height="12" viewBox="0 0 28 28">
                      <circle cx="14" cy="14" r="11" fill="none" stroke="rgba(193,18,31,0.6)" strokeWidth="1" />
                      <circle cx="14" cy="14" r="6" fill="none" stroke="rgba(193,18,31,0.9)" strokeWidth="1.2" />
                      <circle cx="14" cy="14" r="2" fill="rgba(193,18,31,1)" />
                    </svg>
                  </div>
                )}
                <div
                  className={[
                    'max-w-[82%] text-sm rounded-card px-3 py-2.5 leading-relaxed whitespace-pre-wrap',
                    m.role === 'user'
                      ? 'bg-brand text-white'
                      : 'bg-surface-elevated text-primary border border-[var(--border)]',
                  ].join(' ')}
                >
                  {m.content === '' && loading && i === messages.length - 1
                    ? <TypingDots />
                    : m.content}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="flex gap-2 px-4 pb-4 border-t border-[var(--border)] pt-3">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Ask Orbit AI…"
              disabled={loading}
              className="flex-1 bg-surface-elevated text-sm text-primary placeholder:text-tertiary rounded-input px-3 py-2.5 border border-[var(--border)] focus:border-brand/50 outline-none transition-colors disabled:opacity-60"
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              className="px-3 py-2.5 rounded-button bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-40 flex-shrink-0"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
