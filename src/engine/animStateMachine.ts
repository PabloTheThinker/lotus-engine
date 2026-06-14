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

export interface BlendSpace2DSample {
  x: number
  y: number
  clipName: string
}

export interface BlendSpace2D {
  paramX: string
  paramY: string
  samples: BlendSpace2DSample[]
}

type Vec2 = { x: number; y: number }
type Triangle = [number, number, number]

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

export function emptyBlendSpace2D(paramX = 'speed', paramY = 'direction'): BlendSpace2D {
  return { paramX, paramY, samples: [] }
}

/** Coerce an @export script var value into a 1D blend param. */
export function scriptVarAsAnimParam(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'boolean') return v ? 1 : 0
  return undefined
}

/**
 * Wave 40 (v2.41) — merge animParams with optional blendScriptVarLink override.
 * When set, blendSpace1D.param reads from actor.scriptVars[blendScriptVarLink].
 */
export function resolveAnimParams(actor: {
  animParams?: Record<string, number>
  blendScriptVarLink?: string
  blendSpace1D?: BlendSpace1D
  scriptVars?: Record<string, unknown>
}): Record<string, number> {
  const params = { ...(actor.animParams ?? {}) }
  const link = actor.blendScriptVarLink?.trim()
  const param = actor.blendSpace1D?.param
  if (link && param) {
    const n = scriptVarAsAnimParam(actor.scriptVars?.[link])
    if (n !== undefined) params[param] = n
  }
  return params
}

/** Collect param names referenced by the FSM and blend spaces. */
export function collectAnimParams(actor: {
  animStateMachine?: AnimStateMachine
  blendSpace1D?: BlendSpace1D
  blendSpace2D?: BlendSpace2D
}): string[] {
  const names = new Set<string>()
  for (const t of actor.animStateMachine?.transitions ?? []) {
    if (t.param) names.add(t.param)
  }
  if (actor.blendSpace1D?.param) names.add(actor.blendSpace1D.param)
  if (actor.blendSpace2D?.paramX) names.add(actor.blendSpace2D.paramX)
  if (actor.blendSpace2D?.paramY) names.add(actor.blendSpace2D.paramY)
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
  if (!sm?.states.length || actor.blendSpace2D?.samples.length || actor.blendSpace1D?.samples.length) return
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

function barycentric(p: Vec2, a: Vec2, b: Vec2, c: Vec2): [number, number, number] {
  const v0x = c.x - a.x
  const v0y = c.y - a.y
  const v1x = b.x - a.x
  const v1y = b.y - a.y
  const v2x = p.x - a.x
  const v2y = p.y - a.y
  const dot00 = v0x * v0x + v0y * v0y
  const dot01 = v0x * v1x + v0y * v1y
  const dot02 = v0x * v2x + v0y * v2y
  const dot11 = v1x * v1x + v1y * v1y
  const dot12 = v1x * v2x + v1y * v2y
  const inv = 1 / (dot00 * dot11 - dot01 * dot01)
  const u = (dot11 * dot02 - dot01 * dot12) * inv
  const v = (dot00 * dot12 - dot01 * dot02) * inv
  return [1 - u - v, v, u]
}

function circumcircleContains(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const ax = a.x - p.x
  const ay = a.y - p.y
  const bx = b.x - p.x
  const by = b.y - p.y
  const cx = c.x - p.x
  const cy = c.y - p.y
  const det =
    (ax * ax + ay * ay) * (bx * cy - cx * by) -
    (bx * bx + by * by) * (ax * cy - cx * ay) +
    (cx * cx + cy * cy) * (ax * by - bx * ay)
  return det > 1e-12
}

/** Bowyer–Watson Delaunay triangulation for blend-space sample positions. */
export function delaunayTriangulate(points: Vec2[]): Triangle[] {
  if (points.length < 3) return []
  let minX = points[0].x
  let minY = points[0].y
  let maxX = points[0].x
  let maxY = points[0].y
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const dx = maxX - minX
  const dy = maxY - minY
  const dmax = Math.max(dx, dy, 1)
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  const st0 = { x: midX - 20 * dmax, y: midY - dmax }
  const st1 = { x: midX, y: midY + 20 * dmax }
  const st2 = { x: midX + 20 * dmax, y: midY - dmax }
  const all = [...points, st0, st1, st2]
  const st = [points.length, points.length + 1, points.length + 2] as Triangle
  let triangles: Triangle[] = [st]

  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const bad: Triangle[] = []
    for (const tri of triangles) {
      if (circumcircleContains(p, all[tri[0]], all[tri[1]], all[tri[2]])) bad.push(tri)
    }
    const edges: [number, number][] = []
    for (const tri of bad) {
      for (let e = 0; e < 3; e++) {
        const a = tri[e]
        const b = tri[(e + 1) % 3]
        let shared = false
        for (const other of bad) {
          if (other === tri) continue
          const hasA = other.includes(a)
          const hasB = other.includes(b)
          if (hasA && hasB) {
            shared = true
            break
          }
        }
        if (!shared) edges.push(a < b ? [a, b] : [b, a])
      }
    }
    triangles = triangles.filter((t) => !bad.includes(t))
    for (const [a, b] of edges) triangles.push([a, b, i])
  }

  return triangles.filter((t) => t[0] < points.length && t[1] < points.length && t[2] < points.length)
}

/** Solve barycentric weights for a query point against blend-space samples. */
export function solveBlendSpace2DWeights(
  samples: BlendSpace2DSample[],
  qx: number,
  qy: number,
): Array<{ index: number; weight: number }> {
  if (!samples.length) return []
  const q: Vec2 = { x: qx, y: qy }
  if (samples.length === 1) return [{ index: 0, weight: 1 }]

  if (samples.length === 2) {
    const a = samples[0]
    const b = samples[1]
    const abx = b.x - a.x
    const aby = b.y - a.y
    const len2 = abx * abx + aby * aby
    const t = len2 <= 1e-8 ? 0 : Math.max(0, Math.min(1, ((qx - a.x) * abx + (qy - a.y) * aby) / len2))
    return [
      { index: 0, weight: 1 - t },
      { index: 1, weight: t },
    ]
  }

  const points = samples.map((s) => ({ x: s.x, y: s.y }))
  const tris = delaunayTriangulate(points)
  for (const tri of tris) {
    const [i0, i1, i2] = tri
    const w = barycentric(q, points[i0], points[i1], points[i2])
    if (w[0] >= -0.001 && w[1] >= -0.001 && w[2] >= -0.001) {
      return [
        { index: i0, weight: w[0] },
        { index: i1, weight: w[1] },
        { index: i2, weight: w[2] },
      ].filter((e) => e.weight > 0.001)
    }
  }

  const ranked = samples
    .map((s, i) => {
      const dx = s.x - qx
      const dy = s.y - qy
      return { i, d2: dx * dx + dy * dy }
    })
    .sort((a, b) => a.d2 - b.d2)
    .slice(0, 3)
  const inv = ranked.map((r) => (r.d2 < 1e-10 ? 1e8 : 1 / r.d2))
  const sum = inv.reduce((a, b) => a + b, 0)
  return ranked.map((r, j) => ({ index: r.i, weight: inv[j] / sum }))
}

/** Blend up to 3 clips in a 2D parameter space (UE BlendSpace2D lite). */
export function tickBlendSpace2D(actor: Actor, x: number, y: number) {
  const bs = actor.blendSpace2D
  if (!bs?.samples.length) return

  const weights = solveBlendSpace2DWeights(bs.samples, x, y)
  let cache = blendActions.get(actor)
  if (!cache) {
    cache = new Map()
    blendActions.set(actor, cache)
  }

  const mixer = ensureMixer(actor)
  if (!mixer) return

  const active = new Set<string>()
  for (const { index, weight } of weights) {
    const sample = bs.samples[index]
    if (!sample?.clipName || weight <= 0.001) continue
    active.add(sample.clipName)
    let action = cache.get(sample.clipName)
    if (!action) {
      const clip = actor.animations?.find((c) => c.name === sample.clipName)
      if (!clip) continue
      action = mixer.clipAction(clip)
      action.enabled = true
      action.loop = THREE.LoopRepeat
      action.play()
      cache.set(sample.clipName, action)
    }
    action.setEffectiveWeight(weight)
    action.setEffectiveTimeScale(1)
    if (!action.isRunning()) action.play()
  }

  for (const [name, action] of cache) {
    if (!active.has(name)) action.setEffectiveWeight(0)
  }

  const top = weights.reduce((best, w) => (w.weight > best.weight ? w : best), weights[0])
  const topSample = bs.samples[top.index]
  actor.currentAction = topSample ? cache.get(topSample.clipName) : undefined
}