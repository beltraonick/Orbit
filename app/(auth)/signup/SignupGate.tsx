'use client'

import Link from 'next/link'
import { useIsNativeApp } from '@/lib/use-native-app'
import { SignupForm } from './SignupForm'

// Company sign-up is website only. Inside the iOS app (App Store guideline
// 3.1.1) this page shows how to sign in or join a company instead of the
// form. The website is unchanged.
export function SignupGate() {
  const native = useIsNativeApp()

  if (native === null) return null

  if (native) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <p className="text-sm text-secondary">
          New company accounts can&apos;t be created in the app. Sign in with your account, or join your company with the invite code from your employer.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center justify-center font-medium rounded-button bg-brand hover:bg-brand-hover text-white h-12 px-6 text-base w-full"
        >
          Sign in
        </Link>
        <Link href="/register" className="text-sm text-brand hover:text-brand-hover font-medium">
          Join with an invite code
        </Link>
      </div>
    )
  }

  return <SignupForm />
}
