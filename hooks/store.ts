import type { Save } from '../types'
import type { Step } from './engine'
import { parseSave } from './model'


// The plugin loader doesn't follow $ across imports, so every $.xxx call stays in register.tsx; this file only gets the wrapped StoreIo
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

// Read → compute → write, one at a time, so events within a session never overwrite each other
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
