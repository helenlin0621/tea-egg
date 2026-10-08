import type { Save } from '../types'
import type { LocalTime } from './clock'
import { isSpecialDay, specialEvent, specialMakeup, specialSeen, specialTurn } from './datemode'
import type { Observation } from './detect'
import { addActiveDay, flip, pauseClocks, refill, testObserved, tick, toolFailed, turnDone, type Step } from './engine'
import { crack, dexText, settle } from './rules'
import { decodeSpoilers } from './spoilers'
import { T, fill } from './text'

const NAME_MAX = 12

// Run the second step on the first step's result: keep the second step's save and accumulate the effects
function then(first: Step, second: (s: Save) => Step): Step {
  const next = second(first.save)
  return { save: next.save, effects: [...first.effects, ...next.effects], reply: next.reply ?? first.reply }
}

export function dexTitle(t: LocalTime): string {
  return isSpecialDay(t) ? decodeSpoilers().dateMode.dexTitle : T().dexTitle
}

export function onSessionOpen(prev: Save, now: number, t: LocalTime, isNewSession: boolean): Step {
  const save = structuredClone(prev)
  const step: Step = { save, effects: [] }
  if (!save.welcomed) {
    save.welcomed = true
    step.effects.push({ kind: 'toast', text: T().welcome })
  }
  save.clocks.lastTickAt = now // no catching up on time while closed
  save.clocks.bucketStart = now
  save.clocks.bucketActive = false
  const made = then(step, s => specialMakeup(s, t))
  if (isSpecialDay(t)) return then(made, s => specialSeen(s, t))
  if (isNewSession) {
    made.save.egg.record.sessionCount += 1
    addActiveDay(made.save, t)
  }
  return made
}

export function onTick(prev: Save, now: number, t: LocalTime, rng: () => number): Step {
  if (isSpecialDay(t)) return then(pauseClocks(prev, now), s => specialSeen(s, t))
  return settle(tick(prev, now, t), now, rng)
}

export function onTurn(prev: Save, now: number, t: LocalTime, rng: () => number): Step {
  if (isSpecialDay(t)) return then(pauseClocks(prev, now), s => specialTurn(s, now, t, rng))
  const made = specialMakeup(prev, t)
  return settle(then(made, s => turnDone(s, now, t, rng)), now, rng)
}

export function onObserved(prev: Save, now: number, t: LocalTime, obs: Observation, rng: () => number): Step {
  if (isSpecialDay(t)) {
    const kind = obs.danger !== null ? 'danger' : obs.test === 'fail' ? 'testFail' : obs.test === 'pass' ? 'testPass' : null
    return kind === null ? { save: prev, effects: [] } : specialEvent(prev, now, t, kind, rng)
  }
  if (obs.danger !== null) return crack(prev, obs.danger, now, rng)
  let step: Step = { save: prev, effects: [] }
  if (obs.test !== null) step = then(step, s => testObserved(s, obs.test === 'pass'))
  if (obs.failed) step = then(step, s => toolFailed(s))
  return step
}

export function onCommand(prev: Save, now: number, t: LocalTime, args: string, rng: () => number): Step {
  const [sub = '', ...rest] = args.split(/\s+/)
  const special = isSpecialDay(t)
  const replies = decodeSpoilers().dateMode.replies
  switch (sub) {
    case 'refill':
      return special ? { save: prev, effects: [], reply: replies.refill } : refill(prev)
    case 'flip':
      return special ? { save: prev, effects: [], reply: replies.flip } : settle(flip(prev, now, t), now, rng)
    case 'dex':
      return { save: prev, effects: [], reply: dexText(prev, dexTitle(t)) }
    case 'help':
      return { save: prev, effects: [], reply: T().help }
    case 'name': {
      const name = rest.join(' ').trim()
      if (name === '' || [...name].length > NAME_MAX) return { save: prev, effects: [], reply: T().nameUsage }
      const save = structuredClone(prev)
      save.egg.name = name
      return { save, effects: [], reply: fill(T().nameReply, { name }) }
    }
    default:
      return { save: prev, effects: [], reply: T().unknown }
  }
}
