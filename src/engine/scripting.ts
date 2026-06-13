import * as THREE from 'three'
import { Input } from './Input'
import { isActionDown, actionJustPressed, actionHeldTime } from './inputActions'
import { activateAbility, applyEffect, getAttribute, removeEffect, setAttribute } from './gameplayAbilities'
import { cameraShake, canSeePoint, hud, queryBestPoint, raycastActors, setTimer, setViewCamera } from './gameplay'
import { runBT, type BTNode } from './behaviorTree'
import { findPath } from './nav'
import { playMetaSound, playSound } from './audio'
import type { Actor } from './Actor'

/**
 * Scripting — per-actor JavaScript, the Blueprint/GDScript analog.
 * A script defines optional hooks:
 *
 *   function onBeginPlay() { ... }
 *   function onTick(dt) { ... }
 *
 * In scope: actor (this Actor), api (engine services), THREE.
 * Scripts compile at Play start and run only while playing.
 */

export interface CompiledScript {
  onBeginPlay: (() => void) | null
  onTick: ((dt: number) => void) | null
}

export interface ScriptApi {
  log: (...args: unknown[]) => void
  isKeyDown: (code: string) => boolean
  keyJustPressed: (code: string) => boolean
  /** named input actions (Input Map): api.isAction('Jump') */
  isAction: (name: string) => boolean
  actionJustPressed: (name: string) => boolean
  /** UE Hold trigger: seconds the action has been held */
  actionHeldTime: (name: string) => number
  getActor: (name: string) => Actor | undefined
  getActorsByTag: (tag: string) => Actor[]
  /** Godot-style signals: decoupled events between scripts */
  emit: (signal: string, ...args: unknown[]) => void
  on: (signal: string, handler: (...args: unknown[]) => void) => void
  /** Godot Timer: api.setTimer(2, fn) / api.setTimer(0.5, fn, true) to loop */
  setTimer: (seconds: number, fn: () => void, loop?: boolean) => void
  /** RayCast3D: hit actors along a ray */
  raycast: (origin: [number, number, number], dir: [number, number, number], maxDist?: number) => { point: [number, number, number]; actor: Actor; distance: number } | null
  /** UMG-lite DOM HUD overlay (visible during Play) */
  hud: typeof hud
  /** UE camera shake */
  cameraShake: (intensity: number, duration: number) => void
  /** render through a named Camera actor (null = pawn camera) */
  setViewCamera: (actorName: string | null) => void
  /** UE Behavior Tree: attach a JSON tree to this actor, ticked every frame */
  runBT: (actor: Actor, tree: import('./behaviorTree').BTNode) => void
  /** per-actor blackboard (shared with its behavior tree) */
  blackboard: (actor: Actor) => Record<string, unknown>
  /** EQS-lite: best ring point around a location by score */
  queryBestPoint: (opts: import('./gameplay').EQSOpts) => [number, number, number] | null
  /** AI sight: can this actor see the player? (FOV cone + occlusion raycast) */
  canSeePlayer: (actor: Actor, fovDeg?: number, maxDist?: number) => boolean
  /** Recast navmesh waypoints when baked; grid A* fallback otherwise */
  findPath: (from: [number, number, number], to: [number, number, number]) => [number, number, number][] | null
  /** data assets (UE DataTable analog) */
  getData: (name: string) => unknown
  /** crossfade an actor to a named animation clip */
  playAnimation: (actor: Actor, clip: string, opts?: { loop?: boolean; fadeIn?: number; speed?: number }) => boolean
  /** clip names available on an actor */
  listClips: (actor: Actor) => string[]
  /** play an imported sound: api.playSound('boom', { at: [x,y,z], volume: 0.8 }) */
  playSound: (
    name: string,
    opts?: {
      volume?: number
      bus?: 'sfx' | 'music'
      loop?: boolean
      at?: [number, number, number]
      falloff?: import('./types').AttenuationCurve
      minDistance?: number
      maxDistance?: number
      customCurve?: [number, number][]
    },
  ) => void
  /** play a procedural MetaSound graph: api.playMetaSound('Laser', { at: [x,y,z] }) */
  playMetaSound: (
    name: string,
    opts?: {
      volume?: number
      bus?: 'sfx' | 'music'
      loop?: boolean
      at?: [number, number, number]
      falloff?: import('./types').AttenuationCurve
      minDistance?: number
      maxDistance?: number
      customCurve?: [number, number][]
    },
  ) => void
  /** GAS-lite: activate an assigned ability by name or id */
  activateAbility: (abilityId: string) => boolean
  /** GAS-lite: read a gameplay attribute on this actor */
  getAttribute: (name: string) => number | null
  /** GAS-lite: set a gameplay attribute on this actor */
  setAttribute: (name: string, value: number) => boolean
  /** GAS-lite: apply a gameplay effect by name or id (stacks duration) */
  applyEffect: (effectId: string) => boolean
  /** GAS-lite: remove an active gameplay effect by name or id */
  removeEffect: (effectId: string) => boolean
  time: () => number
  /** world position of the player pawn while playing, else null */
  pawnPosition: () => THREE.Vector3 | null
  /** switch to a linked level (PIE + exported playable) — returns false if unknown */
  loadLevel: (name: string) => boolean | Promise<boolean>
  /** lazy-load a grid cell's actors (exported playable + PIE) */
  loadCell: (cx: number, cz: number) => boolean | Promise<boolean>
}

// per-actor blackboards + level data store (set by World)
const blackboards = new WeakMap<object, Record<string, unknown>>()
function blackboardFor(actor: Actor): Record<string, unknown> {
  let bb = blackboards.get(actor)
  if (!bb) {
    bb = {}
    blackboards.set(actor, bb)
  }
  return bb
}
export let dataStore: Record<string, unknown> = {}
export function setDataStore(d: Record<string, unknown>) {
  dataStore = d
}

// signal bus — reset at every beginPlay so stale handlers never leak between sessions
let signalHandlers = new Map<string, Array<(...args: unknown[]) => void>>()
export function resetSignals() {
  signalHandlers = new Map()
}

type LogSink = (level: 'log' | 'error', message: string) => void
let logSink: LogSink = (level, msg) => console[level](msg)
export function setScriptLogSink(sink: LogSink) {
  logSink = sink
}
export function scriptLog(level: 'log' | 'error', msg: string) {
  logSink(level, msg)
}

export function makeScriptApi(
  actors: Map<string, Actor>,
  clock: () => number,
  pawnPosition: () => THREE.Vector3 | null = () => null,
  loadLevel: (name: string) => boolean | Promise<boolean> = () => false,
  boundActor?: Actor,
  loadCell: (cx: number, cz: number) => boolean | Promise<boolean> = () => false,
): ScriptApi {
  const api: ScriptApi = {
    log: (...args) =>
      logSink(
        'log',
        args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
      ),
    isKeyDown: (code) => Input.isDown(code),
    keyJustPressed: (code) => Input.justPressed(code),
    isAction: (name) => isActionDown(name),
    actionJustPressed: (name) => actionJustPressed(name),
    actionHeldTime: (name) => actionHeldTime(name),
    getActor: (name) => [...actors.values()].find((a) => a.name === name),
    getActorsByTag: (tag) => {
      // UE Gameplay Tags: 'Enemy.Boss' matches tag 'Enemy.Boss.Fire' (prefix hierarchy)
      const q = tag.toLowerCase()
      return [...actors.values()].filter((a) =>
        a.tags.some((t) => {
          const tl = t.toLowerCase()
          return tl === q || tl.startsWith(q + '.')
        }),
      )
    },
    emit: (signal, ...args) => {
      for (const h of signalHandlers.get(signal) ?? []) {
        try {
          h(...args)
        } catch (err) {
          logSink('error', `signal "${signal}" handler: ${(err as Error).message}`)
        }
      }
    },
    on: (signal, handler) => {
      if (!signalHandlers.has(signal)) signalHandlers.set(signal, [])
      signalHandlers.get(signal)!.push(handler)
    },
    setTimer: (seconds, fn, loop) => setTimer(seconds, fn, !!loop),
    runBT: (actor, tree) => runBT(actor, tree as BTNode, blackboardFor(actor)),
    blackboard: (actor) => blackboardFor(actor),
    findPath: (from, to) => findPath(actors, from, to),
    queryBestPoint: (opts) => queryBestPoint(pawnPosition, opts),
    canSeePlayer: (actor, fovDeg, maxDist) => {
      const p = pawnPosition()
      return p ? canSeePoint(actors, actor, p, fovDeg, maxDist) : false
    },
    getData: (name) => dataStore[name],
    playAnimation: (actor, clip, opts) => actor.playAnimation(clip, opts),
    listClips: (actor) => (actor.animations ?? []).map((c) => c.name),
    playSound: (name, opts = {}) =>
      playSound(name, {
        ...opts,
        listener: () => {
          const p = pawnPosition()
          return p ? [p.x, p.y, p.z] : null
        },
      }),
    playMetaSound: (name, opts = {}) => playMetaSound(name, opts),
    raycast: (origin, dir, maxDist) => raycastActors(actors, origin, dir, maxDist),
    hud,
    cameraShake,
    setViewCamera,
    time: clock,
    pawnPosition,
    loadLevel,
    loadCell,
    activateAbility: (abilityId) => (boundActor ? activateAbility(boundActor, abilityId, api) : false),
    getAttribute: (name) => (boundActor ? getAttribute(boundActor, name) : null),
    setAttribute: (name, value) => (boundActor ? setAttribute(boundActor, name, value) : false),
    applyEffect: (effectId) => (boundActor ? applyEffect(boundActor, effectId) : false),
    removeEffect: (effectId) => (boundActor ? removeEffect(boundActor, effectId) : false),
  }
  return api
}

// ---- @export script variables (Godot's killer bridge) ----
export interface ExportVar {
  name: string
  value: unknown
}

/** parse `// @export name = <json>` annotations from a script */
export function parseExports(source: string): ExportVar[] {
  const out: ExportVar[] = []
  const re = /^\s*\/\/\s*@export\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)\s*$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    try {
      out.push({ name: m[1], value: JSON.parse(m[2]) })
    } catch {
      out.push({ name: m[1], value: m[2].trim() })
    }
  }
  return out
}

/**
 * UE Construction Script: if the actor's script defines onConstruct(),
 * run it once in-editor (after placement or transform edits).
 */
export function runConstructScript(
  actor: Actor,
  actors: Map<string, Actor>,
  log: (level: 'log' | 'error', msg: string) => void,
) {
  if (!actor.script || !actor.script.includes('onConstruct')) return
  try {
    const api = makeScriptApi(actors, () => 0, () => null)
    const fn = new Function(
      'actor',
      'api',
      'THREE',
      'vars',
      `"use strict";
${actor.script}
if (typeof onConstruct === 'function') onConstruct();`,
    )
    const vars: Record<string, unknown> = {}
    for (const ev of parseExports(actor.script)) vars[ev.name] = ev.value
    Object.assign(vars, actor.scriptVars ?? {})
    fn(actor, api, THREE, vars)
  } catch (err) {
    log('error', `onConstruct(${actor.name}): ${(err as Error).message}`)
  }
}

export function compileScript(actor: Actor, source: string, api: ScriptApi): CompiledScript | null {
  try {
    // @export defaults overridden by per-actor saved values
    const vars: Record<string, unknown> = {}
    for (const ev of parseExports(source)) vars[ev.name] = ev.value
    Object.assign(vars, actor.scriptVars ?? {})
    const factory = new Function(
      'actor',
      'api',
      'THREE',
      'vars',
      `"use strict";\n${source}\nreturn {
        onBeginPlay: typeof onBeginPlay === 'function' ? onBeginPlay : null,
        onTick: typeof onTick === 'function' ? onTick : null,
      };`,
    )
    return factory(actor, api, THREE, vars) as CompiledScript
  } catch (err) {
    logSink('error', `[${actor.name}] script compile error: ${(err as Error).message}`)
    return null
  }
}

export const DEFAULT_SCRIPT = `// Vektra script — runs during Play.
// In scope: actor, api, THREE

function onBeginPlay() {
  api.log(actor.name + ' ready')
  // api.loadLevel('dungeon') — switch to a linked level (World Settings)
  // api.loadCell(0, 0) — lazy-load a grid cell (exported playable)
}

function onTick(dt) {
  // actor.root.rotation.y += dt
}
`
