// UI language. Chosen once per session from TEA_EGG_LANG, else from the system locale.
export type Lang = 'zh-TW' | 'en'

function systemLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return ''
  }
}

// TEA_EGG_LANG ('en' or 'zh-TW') wins; otherwise a locale starting with "zh" means zh-TW and anything else means en
export function detectLang(envValue?: string, locale: string = systemLocale()): Lang {
  const forced = (envValue ?? '').trim().toLowerCase()
  if (forced.startsWith('zh')) return 'zh-TW'
  if (forced.startsWith('en')) return 'en'
  return locale.toLowerCase().startsWith('zh') ? 'zh-TW' : 'en'
}

// zh-TW until register.tsx decides at session start, so the original Chinese tests run unchanged
let current: Lang = 'zh-TW'

export function setLang(next: Lang): void {
  current = next
}

export function lang(): Lang {
  return current
}

type Patch = { [key: string]: unknown }
const isPlain = (v: unknown): v is Patch => typeof v === 'object' && v !== null && !Array.isArray(v)

// Deep-merge a translation over the base: objects merge key by key, arrays and strings replace whole
export function overlay<T>(base: T, patch: unknown): T {
  if (!isPlain(base) || !isPlain(patch)) return (patch === undefined ? base : patch) as T
  const out: Patch = { ...base }
  for (const [key, value] of Object.entries(patch)) out[key] = overlay(out[key], value)
  return out as T
}
