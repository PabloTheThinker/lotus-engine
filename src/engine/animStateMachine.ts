import * as THREE from 'three'
import type { Actor } from './Actor'

/** FSM transition condition — mirrors UE AnimGraph transition rules (lite). */
export type AnimTransitionCondition = 'auto' | 'param_gt' | 'param_lt'

export interface AnimTransition {
  from: string
  to: string
  condition: AnimTransitionCondition
  param?: string
  threshold?: number
  crossfade: number
}

export interface AnimState {
  name: string
  clipName: string
  loop: boolean
  /** editor canvas position */
  x: number
  y: number
}

export interface AnimStateMachine {
  initialState: string
  states: AnimState[]
  transitions: AnimTransition[]
}

export interface BlendSpaceSample {
  value: number
  clipName: string
}

export interface BlendSpace1D {
  param: string
  samples: BlendSpaceSample[]
}

const smRuntime = new WeakMap<Actor, { current: string; enteredAt: number }>()
const blendActions = new WeakMap<Actor, Map<string, THREE.AnimationAction>>()

export function emptyAnimStateMachine(clipName = ''): AnimStateMachine {
  return {
    initialState: 'Idle',
    states: [{ name: 'Idle', clipName, loop: true, x: 80, y: 80 }],
    transitions: [],
  }
}

export function emptyBlendSpace1D(param = 'speed'): BlendSpace1D {
  return { param, samples: [] }
}

/** Collect param names referenced by the FSM and blend space. */
export function collectAnimParams(actor: {
  animStateMachine?: AnimStateMachine
  blendSpace1D?: BlendSpace1D
}): string[] {
  const names = new Set<string>()
  for (const t of actor.animStateMachine?.transitions ?? []) {
    if (t.param) names.add(t.param)
  }
  if (actor.blendSpace1D?.param) names.add(actor.blendSpace1D.param)
  return [...names]
}

export function resetAnimRuntime(actor: Actor) {
  smRuntime.delete(actor)
  const actions = blendActions.get(actor)
  if (actions) {
    for (const a of actions.values()) a.stop()
    blendActions.delete(actor)
  }
}

function ensureMixer(actor: Actor): THREE.AnimationMixer | null {
  if (!actor.animations?.length) return null
  if (!actor.mixer) actor.mixer = new THREE.AnimationMixer(actor.root)
  return actor.mixer
}

function clipAction(actor: Actor, clipName: string): THREE.AnimationAction | null {
  const clip = actor.animations?.find((c) => c.name === clipName)
  if (!clip) return null
  const mixer = ensureMixer(actor)
  if (!mixer) return null
  return mixer.clipAction(clip)
}

function transitionMatches(t: AnimTransition, params: Record<string, number>, finished: boolean): boolean {
  switch (t.condition) {
    case 'auto':
      return finished
    case 'param_gt': {
      const v = params[t.param ?? '']
      return v !== undefined && v > (t.threshold ?? 0)
    }
    case 'param_lt': {
      const v = params[t.param ?? '']
      return v !== undefined && v < (t.threshold ?? 0)
    }
    default:
      return false
  }
}

function enterState(actor: Actor, state: AnimState, crossfade: number) {
  const action = clipAction(actor, state.clipName)
  if (!action) return
  action.reset()
  action.loop = state.loop ? THREE.LoopRepeat : THREE.LoopOnce
  action.clampWhenFinished = true
  action.enabled = true
  const fade = Math.max(0, crossfade)
  if (actor.currentAction && actor.currentAction !== action) {
    action.crossFadeFrom(actor.currentAction, fade, true)
  } else if (fade > 0) {
    action.fadeIn(fade)
  }
  action.play()
  actor.currentAction = action
}

function stateByName(sm: AnimStateMachine, name: string): AnimState | undefined {
  return sm.states.find((s) => s.name === name)
}

/**
 * Evaluate the animation FSM and drive mixer crossfades.
 * Blend space takes priority when both are authored — use one or the other per actor.
 */
export function tickAnimSM(actor: Actor, dt: number, params: Record<string, number>) {
  const sm = actor.animStateMachine
  if (!sm?.states.length || actor.blendSpace1D?.samples.length) return
  void dt

  let rt = smRuntime.get(actor)
  if (!rt) {
    const initial = stateByName(sm, sm.initialState) ?? sm.states[0]
    if (!initial?.clipName) return
    rt = { current: initial.name, enteredAt: performance.now() }
    smRuntime.set(actor, rt)
    enterState(actor, initial, 0)
    return
  }

  const current = stateByName(sm, rt.current)
  if (!current) return

  const finished =
    !!actor.currentAction &&
    !current.loop &&
    actor.currentAction.getClip().name === current.clipName &&
    !actor.currentAction.isRunning()

  for (const t of sm.transitions) {
    if (t.from !== rt.current) continue
    if (!transitionMatches(t, params, finished)) continue
    const next = stateByName(sm, t.to)
    if (!next?.clipName) break
    rt.current = next.name
    rt.enteredAt = performance.now()
    enterState(actor, next, t.crossfade)
    break
  }
}

/** Blend adjacent clips along a 1D parameter (UE BlendSpace1D lite). */
export function tickBlendSpace1D(actor: Actor, value: number) {
  const bs = actor.blendSpace1D
  if (!bs?.samples.length) return

  const samples = [...bs.samples].sort((a, b) => a.value - b.value)
  const min = samples[0].value
  const max = samples[samples.length - 1].value
  const v = Math.max(min, Math.min(max, value))

  let lo = 0
  while (lo < samples.length - 1 && samples[lo + 1].value <= v) lo++
  const a = samples[lo]
  const b = samples[Math.min(lo + 1, samples.length - 1)]
  const span = b.value - a.value
  const t = span <= 0 ? 0 : (v - a.value) / span

  let cache = blendActions.get(actor)
  if (!cache) {
    cache = new Map()
    blendActions.set(actor, cache)
  }

  const mixer = ensureMixer(actor)
  if (!mixer) return

  const active = new Set<string>()
  const apply = (sample: BlendSpaceSample, weight: number) => {
    if (!sample.clipName || weight <= 0.001) return
    active.add(sample.clipName)
    let action = cache!.get(sample.clipName)
    if (!action) {
      const clip = actor.animations?.find((c) => c.name === sample.clipName)
      if (!clip) return
      action = mixer.clipAction(clip)
      action.enabled = true
      action.loop = THREE.LoopRepeat
      action.play()
      cache!.set(sample.clipName, action)
    }
    action.setEffectiveWeight(weight)
    action.setEffectiveTimeScale(1)
    if (!action.isRunning()) action.play()
  }

  if (a.clipName === b.clipName || span <= 0) {
    apply(a, 1)
  } else {
    apply(a, 1 - t)
    apply(b, t)
  }

  for (const [name, action] of cache) {
    if (!active.has(name)) {
      action.setEffectiveWeight(0)
    }
  }

  actor.currentAction = cache.get(b.clipName) ?? cache.get(a.clipName)
}