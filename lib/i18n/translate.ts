import type { Language } from '@/lib/auth/types'
import { common } from './dict/common'
import { admin } from './dict/admin'
import { employee } from './dict/employee'
import { client } from './dict/client'
import { owner } from './dict/owner'
import { profile } from './dict/profile'
import { supervisor } from './dict/supervisor'
import { schedule } from './dict/schedule'

export type Locale = Language

type Dict = Record<string, unknown>

const dictionaries: Record<Locale, Dict> = {
  en: { common: common.en, admin: admin.en, employee: employee.en, client: client.en, owner: owner.en, profile: profile.en, supervisor: supervisor.en, schedule: schedule.en },
  pt: { common: common.pt, admin: admin.pt, employee: employee.pt, client: client.pt, owner: owner.pt, profile: profile.pt, supervisor: supervisor.pt, schedule: schedule.pt },
  es: { common: common.es, admin: admin.es, employee: employee.es, client: client.es, owner: owner.es, profile: profile.es, supervisor: supervisor.es, schedule: schedule.es },
}

function lookup(dict: Dict, key: string): string | undefined {
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Dict)[part]
  }
  return typeof node === 'string' ? node : undefined
}

/** Looks up a dot-path key (e.g. "admin.dashboard.title") in the given locale, falling back to English, then the raw key. */
export function t(locale: Locale, key: string): string {
  return lookup(dictionaries[locale], key) ?? lookup(dictionaries.en, key) ?? key
}

export function createTranslator(locale: Locale) {
  return (key: string) => t(locale, key)
}
