import type { Save } from '../types'
import type { Step } from './engine'
import { parseSave } from './model'


// The plugin loader doesn't follow $ across imports, so every $.xxx call stays in register.tsx; this file only gets the wrapped StoreIo
export type StoreIo = {
  now: () => Promise<number>
  read: () => Promise<unknown>
  write: (save: Save) => Promise<void>
  mirror?: (save: Save) => Promise<void> // only refresh the in-memory copy, for a result that matches what is stored
  toast: (text: string, order: number) => void // order: its place among the event's toasts (register.tsx spaces them out)
}

let queue: Promise<unknown> = Promise.resolve()

export async function loadSave(io: StoreIo): Promise<Save> {
  return parseSave(await io.read(), await io.now())
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
// Passes at the stored save before giving up on it holding still
const RECHECKS = 3

// Read → compute → write, one at a time, so events within a session never overwrite each other.
// The save is one file that every session rewrites whole, and no lock spans processes, so the window is narrowed instead:
// the compute is redone on what is stored when another session wrote since our read, and nothing is written when the
// result is what is already stored. fn can run more than once, so it must not carry state between runs
export function mutate(io: StoreIo, fn: (s: Save, now: number) => Step): Promise<Step> {
  const run = queue.then(async () => {
    const now = await io.now()
    let raw = await io.read()
    let step = fn(parseSave(raw, now), now)
    for (let i = 0; i < RECHECKS; i++) {
      const latest = await io.read()
      if (same(latest, raw)) break
      raw = latest
      step = fn(parseSave(raw, now), now)
    }
    if (same(step.save, raw) && io.mirror) await io.mirror(step.save)
    else await io.write(step.save)
    step.effects.forEach((effect, i) => io.toast(effect.text, i))
    return step
  })
  queue = run.catch(() => undefined)
  return run
}
