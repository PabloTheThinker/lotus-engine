import { Crowd, type CrowdAgent, init } from 'recast-navigation'
import { getNavMesh, isRecastNavReady } from './nav'

/** Wave 11 — DetourCrowd avoidance on baked Recast navmesh. */

let crowd: Crowd | null = null
const agents = new Map<string, CrowdAgent>()

export function resetCrowd() {
  for (const a of agents.values()) crowd?.removeAgent(a)
  agents.clear()
  crowd = null
}

export function initCrowd(maxAgents = 48): boolean {
  if (crowd) return true
  const nav = getNavMesh()
  if (!nav || !isRecastNavReady()) return false
  crowd = new Crowd(nav, { maxAgents, maxAgentRadius: 0.6 })
  return true
}

export function tickCrowd(dt: number) {
  crowd?.update(dt)
}

export function crowdAddAgent(
  id: string,
  position: [number, number, number],
  target?: [number, number, number],
): boolean {
  if (!initCrowd()) return false
  if (agents.has(id)) return true
  const agent = crowd!.addAgent(
    { x: position[0], y: position[1], z: position[2] },
    {
      radius: 0.35,
      height: 1.8,
      maxAcceleration: 12,
      maxSpeed: 4.5,
      collisionQueryRange: 2.5,
      separationWeight: 2,
    },
  )
  agents.set(id, agent)
  if (target) crowdSetTarget(id, target)
  return true
}

export function crowdSetTarget(id: string, target: [number, number, number]) {
  const agent = agents.get(id)
  if (!agent || !crowd) return false
  agent.requestMoveTarget({ x: target[0], y: target[1], z: target[2] })
  return true
}

export function crowdGetPosition(id: string): [number, number, number] | null {
  const agent = agents.get(id)
  if (!agent) return null
  const p = agent.position()
  return [p.x, p.y, p.z]
}

export function crowdRemoveAgent(id: string) {
  const agent = agents.get(id)
  if (agent && crowd) crowd.removeAgent(agent)
  agents.delete(id)
}

export function crowdAgentCount(): number {
  return agents.size
}

/** Warm WASM module for crowd (idempotent). */
export async function preloadCrowd(): Promise<void> {
  await init()
}