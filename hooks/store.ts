import type { Save } from '../types'
import type { Step } from './engine'
import { parseSave } from './model'

export const SAVE_REF = { plugin: 'tea-egg', key: 'save' } as const
export const SHOW_DEX_REF = { plugin: 'tea-egg', key: 'showDex' } as const
export const COUNTED_REF = { plugin: 'tea-egg', key: 'sessionCounted' } as const

// 外掛載入器不跟隨 $ 跨 import，所以 $.xxx 呼叫都留在 register.tsx，這裡只拿到包好的 StoreIo
export type StoreIo = {
  now: () => Promise<number>
  read: () => Promise<unknown>
  write: (save: Save) => Promise<void>
  toast: (text: string) => void
}

let queue: Promise<unknown> = Promise.resolve()

export async function loadSave(io: StoreIo): Promise<Save> {
  return parseSave(await io.read(), await io.now())
}

// 讀 → 算 → 寫 一次只跑一個，避免同一 session 內的事件互相覆蓋
export function mutate(io: StoreIo, fn: (s: Save, now: number) => Step): Promise<Step> {
  const run = queue.then(async () => {
    const now = await io.now()
    const step = fn(parseSave(await io.read(), now), now)
    await io.write(step.save)
    for (const effect of step.effects) io.toast(effect.text)
    return step
  })
  queue = run.catch(() => undefined)
  return run
}
