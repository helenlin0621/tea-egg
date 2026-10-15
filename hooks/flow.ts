import type { Save } from '../types'
import type { LocalTime } from './clock'
import {
  crossLine,
  crossReply,
  datesCatchUp,
  datesPrompt,
  endCross,
  isCross,
  paneRefillLabel,
  replyCommand,
  replyPress,
  timedDanger,
  timedFlipReply,
  timedNow,
  timedPress,
  timedSeen,
  timedTick,
} from './dates'
import { isPausedDay, isSpecialDay, specialEvent, specialMakeup, specialSeen, specialTurn } from './datemode'
import type { Observation } from './detect'
import { addActiveDay, flip, pauseClocks, refill, testObserved, tick, toolFailed, turnDone, type Step } from './engine'
import { caution, crack, dexText, settle } from './rules'
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

// A timed special date pauses the egg like the first one does (dates.ts)
const isTimedDay = (s: Save, t: LocalTime) => isPausedDay(t) && !isSpecialDay(t) && timedNow(s, t) !== null

export function onSessionOpen(prev: Save, now: number, t: LocalTime, isNewSession: boolean): Step {
  const save = structuredClone(prev)
  const step: Step = { save, effects: [] }
  if (!save.welcomed) {
    save.welcomed = true
    step.effects.push({ kind: 'toast', text: T().welcome })
  }
  // A save made before this version counts as made today: days missed before it are not made up
  save.installedOn ??= t.date
  save.clocks.lastTickAt = now // no catching up on time while closed
  save.clocks.bucketStart = now
  save.clocks.bucketActive = false
  let made = then(step, s => specialMakeup(s, t))
  made = then(made, s => datesCatchUp(s, now, t))
  if (isSpecialDay(t)) return then(made, s => specialSeen(s, t))
  if (isPausedDay(t)) return then(made, s => timedSeen(s, t))
  // The session itself is counted on its first prompt (usage.ts): opening one without using it doesn't count
  if (isNewSession) addActiveDay(made.save, t)
  return made
}

// The person sent a prompt: the day's countdown, grant or reply may start. terminal: a terminal is attached
export function onPrompt(prev: Save, now: number, t: LocalTime, terminal: boolean): Step {
  const caught = datesCatchUp(prev, now, t)
  return then(caught, s => datesPrompt(s, now, t, terminal))
}

export function onTick(prev: Save, now: number, t: LocalTime, rng: () => number): Step {
  if (isSpecialDay(t)) return then(pauseClocks(prev, now), s => specialSeen(s, t))
  if (isPausedDay(t)) return then(pauseClocks(prev, now), s => timedTick(s, now))
  return then(settle(tick(prev, now, t), now, rng), s => timedTick(s, now))
}

export function onTurn(prev: Save, now: number, t: LocalTime, rng: () => number): Step {
  if (isSpecialDay(t)) return then(pauseClocks(prev, now), s => specialTurn(s, now, t, rng))
  const caught = then(specialMakeup(prev, t), s => datesCatchUp(s, now, t))
  if (isPausedDay(t)) return then(caught, s => pauseClocks(s, now))
  const done = settle(then(caught, s => turnDone(s, now, t, rng)), now, rng)
  return then(done, s => crossLine(s, now, t, rng))
}

export function onObserved(prev: Save, now: number, t: LocalTime, obs: Observation, rng: () => number): Step {
  if (isSpecialDay(t)) {
    const kind = obs.danger !== null ? 'danger' : obs.test === 'fail' ? 'testFail' : obs.test === 'pass' ? 'testPass' : null
    return kind === null ? { save: prev, effects: [] } : specialEvent(prev, now, t, kind, rng)
  }
  if (isTimedDay(prev, t)) return obs.danger !== null ? timedDanger(prev, now, t) : { save: prev, effects: [] }
  if (obs.danger !== null) {
    // A new egg holds no grudge: cracking ends a cross day
    const cross = isCross(prev, t)
    const cracked = crack(prev, obs.danger, now, rng)
    return cross ? then(cracked, s => endCross(s, t)) : cracked
  }
  let step: Step = { save: prev, effects: [] }
  if (obs.test !== null) step = then(step, s => testObserved(s, obs.test === 'pass'))
  if (obs.failed) step = then(step, s => toolFailed(s))
  const risky = obs.caution
  if (risky) {
    const cross = isCross(step.save, t)
    const no = step.save.egg.no
    step = then(step, s => caution(s, risky, now, rng))
    if (cross && step.save.egg.no !== no) step = then(step, s => endCross(s, t))
  }
  return step
}

export function onCommand(prev: Save, now: number, t: LocalTime, args: string, rng: () => number): Step {
  const [sub = '', ...rest] = args.split(/\s+/)
  const special = isSpecialDay(t)
  const replies = decodeSpoilers().dateMode.replies
  // The reply date's hidden command (the same as its button); like any unknown command on other days
  if (replyCommand().includes(sub)) return replyPress(prev, t) ?? { save: prev, effects: [], reply: T().unknown }
  switch (sub) {
    case 'refill': {
      if (special) return { save: prev, effects: [], reply: replies.refill }
      // A timed date: refill presses the day's button instead (the band's button does the same)
      if (paneRefillLabel(prev, t) !== null) {
        const pressed = timedPress(prev, now, t)
        if (pressed) return pressed
      }
      const step = refill(prev)
      const cross = crossReply(prev, t, 'refill')
      return cross ? { ...step, reply: cross } : step
    }
    case 'flip': {
      if (special) return { save: prev, effects: [], reply: replies.flip }
      const costume = timedFlipReply(prev, t)
      if (costume !== null) return { save: prev, effects: [], reply: costume }
      const step = settle(flip(prev, now, t), now, rng)
      const cross = crossReply(prev, t, 'flip')
      return cross ? { ...step, reply: cross } : step
    }
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
