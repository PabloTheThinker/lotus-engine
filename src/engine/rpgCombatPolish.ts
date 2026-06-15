/**
 * Wave 101 (v5.44–v5.48) — Combat polish: i-frames, hit reactions, floating damage numbers.
 */

import * as THREE from 'three'
import type { Actor } from './Actor'

export const DEFAULT_IFRAME_SEC = 0.35
export const DEFAULT_HIT_FLASH_SEC = 0.12
export const DAMAGE_NUMBER_TTL_MS = 1400

export interface DamageNumberEvent {
  id: number
  amount: number
  worldX: number
  worldY: number
  worldZ: number
  crit: boolean
  at: number
}

const iframeEnds = new WeakMap<Actor, number>()
const hitFlashEnds = new WeakMap<Actor, number>()
const savedEmissive = new WeakMap<Actor, { color: string; intensity: number }>()

const damageEvents: DamageNumberEvent[] = []
let damageEventId = 0

export function isInvincible(actor: Actor, now = performance.now()): boolean {
  const ends = iframeEnds.get(actor)
  return ends != null && now < ends
}

export function grantIFrames(actor: Actor, durationSec = DEFAULT_IFRAME_SEC, now = performance.now()): void {
  const dur = Math.max(0, Number(durationSec) || 0)
  if (dur <= 0) return
  iframeEnds.set(actor, now + dur * 1000)
}

export function getIFramesRemaining(actor: Actor, now = performance.now()): number {
  const ends = iframeEnds.get(actor)
  if (ends == null) return 0
  return Math.max(0, (ends - now) / 1000)
}

export function queueDamageNumber(
  actor: Actor,
  amount: number,
  opts?: { crit?: boolean; now?: number },
): DamageNumberEvent {
  actor.root.updateMatrixWorld(true)
  const pos = new THREE.Vector3()
  actor.root.getWorldPosition(pos)
  pos.y += 1.4
  const evt: DamageNumberEvent = {
    id: ++damageEventId,
    amount: Math.max(0, Math.floor(Number(amount) || 0)),
    worldX: pos.x,
    worldY: pos.y,
    worldZ: pos.z,
    crit: opts?.crit === true,
    at: opts?.now ?? performance.now(),
  }
  damageEvents.push(evt)
  if (damageEvents.length > 64) damageEvents.splice(0, damageEvents.length - 64)
  return evt
}

export function listDamageNumbers(now = performance.now()): DamageNumberEvent[] {
  return damageEvents.filter((e) => now - e.at < DAMAGE_NUMBER_TTL_MS)
}

export function popDamageNumbers(now = performance.now()): DamageNumberEvent[] {
  const fresh = listDamageNumbers(now)
  damageEvents.length = 0
  return fresh
}

function meshForActor(actor: Actor): THREE.Mesh | null {
  if (actor.mesh instanceof THREE.Mesh) return actor.mesh
  let found: THREE.Mesh | null = null
  actor.root.traverse((o) => {
    if (!found && o instanceof THREE.Mesh && !o.userData.isHelper && !o.userData.isEditorOnly) found = o
  })
  return found
}

export function triggerHitReaction(actor: Actor, now = performance.now()): void {
  const mesh = meshForActor(actor)
  if (!mesh?.material) return
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const mat = mats[0]
  if (!(mat instanceof THREE.MeshStandardMaterial)) return
  if (!savedEmissive.has(actor)) {
    savedEmissive.set(actor, {
      color: mat.emissive.getStyle(),
      intensity: mat.emissiveIntensity,
    })
  }
  mat.emissive.set('#ff4466')
  mat.emissiveIntensity = 0.85
  hitFlashEnds.set(actor, now + DEFAULT_HIT_FLASH_SEC * 1000)
}

export function tickHitReactions(actors: Iterable<Actor>, now = performance.now()): void {
  for (const actor of actors) {
    const ends = hitFlashEnds.get(actor)
    if (ends == null || now < ends) continue
    hitFlashEnds.delete(actor)
    const mesh = meshForActor(actor)
    const saved = savedEmissive.get(actor)
    if (!mesh?.material || !saved) continue
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const mat = mats[0]
    if (!(mat instanceof THREE.MeshStandardMaterial)) continue
    mat.emissive.set(saved.color)
    mat.emissiveIntensity = saved.intensity
    savedEmissive.delete(actor)
  }
}

export interface CombatPolishDamageResult {
  applied: number
  blocked: boolean
}

/** Apply i-frames, hit flash, and damage number queue before Health is reduced. */
export function applyCombatPolishOnDamage(
  victim: Actor,
  amount: number,
  opts?: { grantIFrames?: boolean; iframeSec?: number; crit?: boolean; useIFrames?: boolean },
): CombatPolishDamageResult {
  const dmg = Math.max(0, Number(amount) || 0)
  if (dmg <= 0) return { applied: 0, blocked: false }
  const iFramesOn = opts?.useIFrames === true
  if (iFramesOn && isInvincible(victim)) return { applied: 0, blocked: true }
  triggerHitReaction(victim)
  queueDamageNumber(victim, dmg, { crit: opts?.crit })
  if (iFramesOn && opts?.grantIFrames !== false) grantIFrames(victim, opts?.iframeSec ?? DEFAULT_IFRAME_SEC)
  return { applied: dmg, blocked: false }
}

export function resetRpgCombatPolish(): void {
  damageEvents.length = 0
}