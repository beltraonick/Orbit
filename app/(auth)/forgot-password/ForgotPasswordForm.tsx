'use client'

import { useState } from 'react'
import { requestPasswordReset } from '@/app/actions/password-reset'
import { Input } from '@/components/ui/Input'

export function ForgotPasswordForm() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [delivery, setDelivery] = useState<'email' | 'admin'>('email')
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const fd = new FormData(e.currentTarget)
    try {
      const result = await requestPasswordReset(fd.get('email') as string)
      if (result.error) {
        setError(result.error)
        setLoading(false)
        return
      }
      setDelivery(result.delivery ?? 'email')
      setSubmitted(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (submitted && delivery === 'admin') {
    return (
      <div className="bg-amber/5 border border-amber/20 rounded-card p-4 text-center">
        <p className="text-sm font-medium text-primary">Ask your company admin</p>
        <p className="text-xs text-secondary mt-1">
          Password reset by email isn&apos;t available yet. Your company admin can set a new password
          for you in Employees; then sign in and change it under Profile.
        </p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="bg-green/10 border border-green/20 rounded-card p-4 text-center">
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-8 h-8 text-green mx-auto mb-2">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        <p className="text-sm font-medium text-primary">Check your email</p>
        <p className="text-xs text-secondary mt-1">If an account exists for that address, we sent a reset link. It expires in 1 hour.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Email address"
        name="email"
        type="email"
        placeholder="you@example.com"
        required
        autoComplete="email"
      />

      {error && (
        <div className="bg-danger/10 border border-danger/20 rounded-input px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="inline-flex items-center justify-center gap-2 font-medium rounded-button transition-all duration-150 bg-brand hover:bg-brand-hover text-white h-12 px-6 text-base w-full disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
            </svg>
            Sending…
          </>
        ) : (
          'Send Reset Link'
        )}
      </button>
    </form>
  )
}
