import * as THREE from 'three'
import { Input } from './Input'
import { isActionDown, actionJustPressed } from './inputActions'
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
  getActor: (name: string) => Actor | undefined
  getActorsByTag: (tag: string) => Actor[]
  /** Godot-style signals: decoupled events between scripts */
  emit: (signal: string, ...args: unknown[]) => void
  on: (signal: string, handler: (...args: unknown[]) => void) => void
  time: () => number
  /** world position of the player pawn while playing, else null */
  pawnPosition: () => THREE.Vector3 | null
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
): ScriptApi {
  return {
    log: (...args) =>
      logSink(
        'log',
        args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
      ),
    isKeyDown: (code) => Input.isDown(code),
    keyJustPressed: (code) => Input.justPressed(code),
    isAction: (name) => isActionDown(name),
    actionJustPressed: (name) => actionJustPressed(name),
    getActor: (name) => [...actors.values()].find((a) => a.name === name),
    getActorsByTag: (tag) =>
      [...actors.values()].filter((a) => a.tags.some((t) => t.toLowerCase() === tag.toLowerCase())),
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
    time: clock,
    pawnPosition,
  }
}

export function compileScript(actor: Actor, source: string, api: ScriptApi): CompiledScript | null {
  try {
    const factory = new Function(
      'actor',
      'api',
      'THREE',
      `"use strict";\n${source}\nreturn {
        onBeginPlay: typeof onBeginPlay === 'function' ? onBeginPlay : null,
        onTick: typeof onTick === 'function' ? onTick : null,
      };`,
    )
    return factory(actor, api, THREE) as CompiledScript
  } catch (err) {
    logSink('error', `[${actor.name}] script compile error: ${(err as Error).message}`)
    return null
  }
}

export const DEFAULT_SCRIPT = `// Vektra script — runs during Play.
// In scope: actor, api, THREE

function onBeginPlay() {
  api.log(actor.name + ' ready')
}

function onTick(dt) {
  // actor.root.rotation.y += dt
}
`
