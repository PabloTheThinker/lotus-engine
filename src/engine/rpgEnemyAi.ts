/**
 * Wave 96 (v5.19–v5.23) — Enemy chase AI on grid navmesh layer 0.
 * Integrates with gridNavAgents + gridNavAi chase behavior (Player tag).
 */

import type { Actor } from './Actor'
import {
  gridNavAgentGetPosition,
  removeGridNavAgent,
  setAgentBehavior,
  spawnGridNavChaseAgent,
} from './gridNavAgents'
import { COMBAT_TAG_ENEMY, COMBAT_TAG_PLAYER, ensureCombatActor } from './rpgCombat'

export const DEFAULT_ENEMY_NAV_LAYER = 0
export const DEFAULT_AGGRO_RANGE = 16

interface EnemyAiState {
  actorId: string
  layer: number
  aggroRange: number
}

const enemyStates = new Map<string, EnemyAiState>()

function actorHasEnemyTag(actor: Actor): boolean {
  const q = COMBAT_TAG_ENEMY.toLowerCase()
  return actor.tags.some((t) => {
    const tl = t.toLowerCase()
    return tl === q || tl.startsWith(q + '.')
  })
}

export function resetRpgEnemyAi(): void {
  for (const id of [...enemyStates.keys()]) removeGridNavAgent(id)
  enemyStates.clear()
}

export function listRegisteredEnemies(): string[] {
  return [...enemyStates.keys()]
}

export function isEnemyRegistered(actorId: string): boolean {
  return enemyStates.has(actorId)
}

export async function registerEnemy(
  actor: Actor,
  actors: Map<string, Actor>,
  opts?: { layer?: number; aggroRange?: number },
): Promise<boolean> {
  if (!actorHasEnemyTag(actor)) return false
  if (enemyStates.has(actor.id)) return true

  ensureCombatActor(actor)
  const layer = Math.max(0, Math.min(3, Math.floor(opts?.layer ?? DEFAULT_ENEMY_NAV_LAYER)))
  const aggroRange = Math.max(2, Number(opts?.aggroRange) || DEFAULT_AGGRO_RANGE)
  const p = actor.root.position
  const position: [number, number, number] = [p.x, p.y, p.z]

  const ok = await spawnGridNavChaseAgent(actors, actor.id, layer, position, COMBAT_TAG_PLAYER)
  if (!ok) return false

  setAgentBehavior(actor.id, 'chase', { chaseTag: COMBAT_TAG_PLAYER, chaseRange: aggroRange })
  enemyStates.set(actor.id, { actorId: actor.id, layer, aggroRange })
  return true
}

export function unregisterEnemy(actorId: string): void {
  removeGridNavAgent(actorId)
  enemyStates.delete(actorId)
}

/** Scan level actors and spawn nav chase agents for Enemy-tagged pawns. */
export async function initRpgEnemyAgents(actors: Map<string, Actor>): Promise<number> {
  let count = 0
  for (const actor of actors.values()) {
    if (!actorHasEnemyTag(actor)) continue
    const ok = await registerEnemy(actor, actors)
    if (ok) count += 1
  }
  return count
}

/** Mirror crowd agent transforms onto enemy actor roots for viewport feedback. */
export function syncEnemyActorPositions(actors: Map<string, Actor>): void {
  for (const { actorId } of enemyStates.values()) {
    const actor = actors.get(actorId)
    if (!actor) continue
    const pos = gridNavAgentGetPosition(actorId)
    if (!pos) continue
    actor.root.position.set(pos[0], pos[1], pos[2])
  }
}

export function tickRpgEnemyAi(actors: Map<string, Actor>, _dt: number): void {
  syncEnemyActorPositions(actors)
}