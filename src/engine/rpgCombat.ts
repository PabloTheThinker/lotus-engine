/**
 * Wave 96 (v5.19–v5.23) — Combat system lite.
 * Melee/ranged damage via GAS-lite Health; combat tags Enemy / Player.
 */

import * as THREE from 'three'
import type { Actor } from './Actor'
import { findCombatAttackState, triggerCombatOneshot } from './animStateMachine'
import { getAttribute, initActorGAS, setAttribute } from './gameplayAbilities'

import { handleEnemyDefeat, type LootDropResult } from './rpgLoot'

export const COMBAT_TAG_ENEMY = 'Enemy'
export const COMBAT_TAG_PLAYER = 'Player'

export const DEFAULT_MELEE_RADIUS = 1.25

const _origin = new THREE.Vector3()
const _forward = new THREE.Vector3()
const _center = new THREE.Vector3()
const _target = new THREE.Vector3()
const _rangedRay = new THREE.Raycaster()

function actorHasTag(actor: Actor, tag: string): boolean {
  const q = tag.toLowerCase()
  return actor.tags.some((t) => {
    const tl = t.toLowerCase()
    return tl === q || tl.startsWith(q + '.')
  })
}

export function ensureCombatActor(actor: Actor | undefined): Actor | null {
  if (!actor) return null
  if (!actor.attributeSetId) actor.attributeSetId = 'default'
  initActorGAS(actor)
  return actor
}

export function ensurePlayerCombatTag(actor: Actor | undefined): Actor | null {
  const player = ensureCombatActor(actor)
  if (!player) return null
  if (!actorHasTag(player, COMBAT_TAG_PLAYER)) player.tags.push(COMBAT_TAG_PLAYER)
  return player
}

export function isAlive(actor: Actor): boolean {
  const health = getAttribute(actor, 'Health')
  return health != null && health > 0
}

export function getActorHealth(actor: Actor): number | null {
  ensureCombatActor(actor)
  return getAttribute(actor, 'Health')
}

export type EnemyDefeatListener = (victim: Actor, killer: Actor | undefined, drops: LootDropResult[]) => void

const defeatListeners: EnemyDefeatListener[] = []

export function onEnemyDefeated(listener: EnemyDefeatListener): void {
  defeatListeners.push(listener)
}

function notifyEnemyDefeated(victim: Actor, killer: Actor | undefined, drops: LootDropResult[]): void {
  for (const listener of defeatListeners) {
    try {
      listener(victim, killer, drops)
    } catch {
      /* ignore listener errors */
    }
  }
}

export function dealDamage(target: Actor, amount: number, source?: Actor): boolean {
  const victim = ensureCombatActor(target)
  if (!victim) return false
  const health = getAttribute(victim, 'Health')
  if (health == null) return false
  const damage = Math.max(0, Number(amount) || 0)
  if (damage <= 0) return true
  const wasAlive = health > 0
  const ok = setAttribute(victim, 'Health', Math.max(0, health - damage))
  if (wasAlive && !isAlive(victim) && actorHasTag(victim, COMBAT_TAG_ENEMY)) {
    const drops = handleEnemyDefeat(victim, source)
    notifyEnemyDefeated(victim, source, drops)
  }
  return ok
}

function actorWorldForward(actor: Actor): THREE.Vector3 {
  return _forward.set(0, 0, -1).applyQuaternion(actor.root.quaternion).normalize()
}

function meleeHitCenter(actor: Actor, range: number): THREE.Vector3 {
  actor.root.getWorldPosition(_origin)
  return _center.copy(_origin).add(actorWorldForward(actor).multiplyScalar(Math.max(0.25, range * 0.5)))
}

/** Spherical hitbox placed in front of the attacker (pawn-facing -Z). */
export function findMeleeTargets(
  actors: Map<string, Actor>,
  attacker: Actor,
  range: number,
  radius = DEFAULT_MELEE_RADIUS,
): Actor[] {
  if (!isAlive(attacker)) return []
  const center = meleeHitCenter(attacker, range)
  const r = Math.max(0.25, radius)
  const hits: Actor[] = []
  for (const actor of actors.values()) {
    if (actor.id === attacker.id) continue
    if (!isAlive(actor)) continue
    actor.root.getWorldPosition(_target)
    if (_target.distanceTo(center) <= r) hits.push(actor)
  }
  return hits
}

export function meleeAttack(
  actors: Map<string, Actor>,
  attacker: Actor,
  range: number,
  damage: number,
  source?: Actor,
): Actor[] {
  const attackState = findCombatAttackState(attacker)
  if (attackState?.clipName) {
    triggerCombatOneshot(attacker, attackState.clipName, attackState.durationSec ?? 0.45)
  }
  const dmg = Math.max(0, Number(damage) || 0)
  const hitRadius = Math.max(DEFAULT_MELEE_RADIUS, range * 0.45)
  const targets = findMeleeTargets(actors, attacker, range, hitRadius)
  const src = source ?? attacker
  for (const target of targets) dealDamage(target, dmg, src)
  return targets
}

function raycastFirstDamageable(
  actors: Map<string, Actor>,
  origin: [number, number, number],
  dir: [number, number, number],
  maxDist: number,
): Actor | null {
  _rangedRay.set(new THREE.Vector3(...origin), new THREE.Vector3(...dir).normalize())
  _rangedRay.far = maxDist
  const meshes: THREE.Object3D[] = []
  for (const a of actors.values()) {
    a.root.updateMatrixWorld(true)
    a.root.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.isHelper && !o.userData.isEditorOnly) meshes.push(o)
    })
  }
  let fallback: Actor | null = null
  for (const hit of _rangedRay.intersectObjects(meshes, false)) {
    let cur: THREE.Object3D | null = hit.object
    while (cur) {
      const id = cur.userData.actorId as string | undefined
      if (id && actors.has(id)) {
        const actor = actors.get(id)!
        ensureCombatActor(actor)
        if (getAttribute(actor, 'Health') != null && isAlive(actor)) {
          if (actorHasTag(actor, COMBAT_TAG_ENEMY)) return actor
          if (!fallback) fallback = actor
        }
        break
      }
      cur = cur.parent
    }
  }
  return fallback
}

export function rangedAttack(
  actors: Map<string, Actor>,
  origin: [number, number, number],
  direction: [number, number, number],
  range: number,
  damage: number,
  source?: Actor,
): Actor | null {
  const len = Math.hypot(direction[0], direction[1], direction[2])
  if (len < 1e-6) return null
  const dir: [number, number, number] = [direction[0] / len, direction[1] / len, direction[2] / len]
  const maxDist = Math.max(0.5, Number(range) || 0)
  const target = raycastFirstDamageable(actors, origin, dir, maxDist)
  if (!target) return null
  dealDamage(target, damage, source)
  return target
}

export function resetRpgCombat(): void {
  // Per-play GAS state resets via resetAbilities(); defeat listeners persist.
}