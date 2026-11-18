import Link from 'next/link'
import { SignupGate } from './SignupGate'

export default function SignupPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="OrbitOps" className="w-14 h-14 rounded-2xl mb-4 shadow-lg object-cover" />
          <h1 className="text-2xl font-bold text-primary tracking-tight">Set up your company</h1>
          <p className="text-sm text-secondary mt-1 text-center">Create a new OrbitOps workspace for your business</p>
        </div>

        <div className="bg-surface rounded-card border border-[var(--border)] p-6">
          <SignupGate />
        </div>

        <p className="text-center text-sm text-secondary mt-6">
          Already have an account?{' '}
          <Link href="/login" className="text-brand hover:text-brand-hover font-medium transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
