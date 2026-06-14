/** Wave 81 (v4.44–v4.48) — Grid nav agent AI: patrol / chase / idle on navmesh layers. */

import type { Actor } from './Actor'

export type GridNavBehavior = 'patrol' | 'chase' | 'idle'

export const DEFAULT_CHASE_TAG = 'grid_nav_target'
export const DEFAULT_PATROL_WAYPOINTS: [number, number, number][] = [
  [0, 1, 0],
  [8, 1, 0],
  [8, 1, 8],
  [0, 1, 8],
]

const PATROL_ARRIVE_RADIUS = 1.25
const CHASE_RETARGET_INTERVAL = 0.35

interface AgentAiState {
  behavior: GridNavBehavior
  patrolWaypoints: [number, number, number][]
  patrolIndex: number
  needsPatrolTarget: boolean
  chaseTag: string
  chaseRange: number
  chaseRetargetTimer: number
}

const aiStates = new Map<string, AgentAiState>()

export function resetGridNavAi() {
  aiStates.clear()
}

export function removeAgentBehavior(id: string) {
  aiStates.delete(id)
}

export function setAgentBehavior(
  id: string,
  behavior: GridNavBehavior,
  opts?: {
    waypoints?: [number, number, number][]
    chaseTag?: string
    chaseRange?: number
  },
) {
  const prev = aiStates.get(id)
  const waypoints = opts?.waypoints ?? prev?.patrolWaypoints ?? DEFAULT_PATROL_WAYPOINTS
  aiStates.set(id, {
    behavior,
    patrolWaypoints: waypoints.length ? [...waypoints] : [...DEFAULT_PATROL_WAYPOINTS],
    patrolIndex: behavior === 'patrol' ? 0 : (prev?.patrolIndex ?? 0),
    needsPatrolTarget: behavior === 'patrol',
    chaseTag: opts?.chaseTag ?? prev?.chaseTag ?? DEFAULT_CHASE_TAG,
    chaseRange: opts?.chaseRange ?? prev?.chaseRange ?? 64,
    chaseRetargetTimer: 0,
  })
}

export function getAgentBehavior(id: string): GridNavBehavior | null {
  return aiStates.get(id)?.behavior ?? null
}

export function getAgentPatrolWaypoints(id: string): [number, number, number][] | null {
  const state = aiStates.get(id)
  return state ? [...state.patrolWaypoints] : null
}

export function getAgentChaseTag(id: string): string | null {
  return aiStates.get(id)?.chaseTag ?? null
}

function dist3(a: [number, number, number], b: [number, number, number]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function findNearestTaggedActor(
  actors: Map<string, Actor>,
  from: [number, number, number],
  tag: string,
  maxRange: number,
): Actor | null {
  let best: Actor | null = null
  let bestDist = maxRange
  const tagLower = tag.toLowerCase()
  for (const actor of actors.values()) {
    if (!actor.tags.some((t) => t.toLowerCase() === tagLower)) continue
    const p = actor.root.position
    const d = dist3(from, [p.x, p.y, p.z])
    if (d < bestDist) {
      bestDist = d
      best = actor
    }
  }
  return best
}

export interface GridNavAiDeps {
  getPosition: (id: string) => [number, number, number] | null
  setTarget: (id: string, target: [number, number, number]) => boolean
  snapToNavmesh: (layer: number, pos: [number, number, number]) => [number, number, number]
  getLayer: (id: string) => number | null
}

export function tickGridNavAi(actors: Map<string, Actor>, dt: number, deps: GridNavAiDeps) {
  for (const [id, state] of aiStates) {
    const pos = deps.getPosition(id)
    if (!pos) continue
    const layer = deps.getLayer(id)
    if (layer === null) continue

    if (state.behavior === 'patrol') {
      const wps = state.patrolWaypoints
      if (!wps.length) continue
      const idx = state.patrolIndex % wps.length
      const waypoint = deps.snapToNavmesh(layer, wps[idx])
      if (state.needsPatrolTarget || dist3(pos, waypoint) < PATROL_ARRIVE_RADIUS) {
        if (!state.needsPatrolTarget) {
          state.patrolIndex = (idx + 1) % wps.length
        }
        state.needsPatrolTarget = false
        const next = deps.snapToNavmesh(layer, wps[state.patrolIndex % wps.length])
        deps.setTarget(id, next)
      }
      continue
    }

    if (state.behavior === 'chase') {
      state.chaseRetargetTimer -= dt
      if (state.chaseRetargetTimer > 0) continue
      state.chaseRetargetTimer = CHASE_RETARGET_INTERVAL
      const target = findNearestTaggedActor(actors, pos, state.chaseTag, state.chaseRange)
      if (!target) continue
      const tp = target.root.position
      deps.setTarget(id, deps.snapToNavmesh(layer, [tp.x, tp.y, tp.z]))
    }
  }
}