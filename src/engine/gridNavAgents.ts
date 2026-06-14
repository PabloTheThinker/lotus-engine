/** Wave 76 (v4.19–v4.23) — DetourCrowd agents per grid navmesh layer. */

import { Crowd, type CrowdAgent, importNavMesh, init, NavMeshQuery, type NavMesh } from 'recast-navigation'
import type { Actor } from './Actor'
import { collectGridNavMeshes, layerMaskFromIndex } from './gridNavmeshBake'
import { bakeNavMeshDataFromMeshes } from './nav'

const GRID_NAV_LAYERS = 4

export function clampGridNavLayer(layer: number): number {
  return Math.max(0, Math.min(GRID_NAV_LAYERS - 1, Math.floor(layer)))
}

interface LayerNavState {
  layer: number
  navMesh: NavMesh
  navMeshQuery: NavMeshQuery
  crowd: Crowd
  ready: boolean
  agents: Map<string, CrowdAgent>
}

const layerStates = new Map<number, LayerNavState>()
const agentLayers = new Map<string, number>()
const bakingPromises = new Map<number, Promise<boolean>>()

function destroyLayerState(state: LayerNavState) {
  for (const agent of state.agents.values()) state.crowd.removeAgent(agent)
  state.agents.clear()
  state.navMeshQuery.destroy()
  state.navMesh.destroy()
}

export function resetGridNavAgents() {
  for (const state of layerStates.values()) destroyLayerState(state)
  layerStates.clear()
  agentLayers.clear()
  bakingPromises.clear()
}

/** Bake and install a per-layer navmesh + crowd without touching the global navmesh. */
export async function bakeGridNavLayer(actors: Map<string, Actor>, layer: number): Promise<boolean> {
  const L = clampGridNavLayer(layer)
  const existing = layerStates.get(L)
  if (existing?.ready) return true

  const pending = bakingPromises.get(L)
  if (pending) return pending

  const bake = (async () => {
    try {
      const meshes = collectGridNavMeshes(actors, layerMaskFromIndex(L))
      const data = await bakeNavMeshDataFromMeshes(meshes)
      if (!data) return false

      await init()

      const prev = layerStates.get(L)
      if (prev) {
        for (const id of [...prev.agents.keys()]) agentLayers.delete(id)
        destroyLayerState(prev)
      }

      const { navMesh } = importNavMesh(data)
      const navMeshQuery = new NavMeshQuery(navMesh)
      const crowd = new Crowd(navMesh, { maxAgents: 48, maxAgentRadius: 0.6 })
      layerStates.set(L, {
        layer: L,
        navMesh,
        navMeshQuery,
        crowd,
        ready: true,
        agents: new Map(),
      })
      return true
    } finally {
      bakingPromises.delete(L)
    }
  })()

  bakingPromises.set(L, bake)
  return bake
}

export function isGridNavLayerReady(layer: number): boolean {
  return layerStates.get(clampGridNavLayer(layer))?.ready === true
}

export async function spawnGridNavAgent(
  actors: Map<string, Actor>,
  id: string,
  layer: number,
  position: [number, number, number],
  target?: [number, number, number],
): Promise<boolean> {
  const L = clampGridNavLayer(layer)
  const baked = await bakeGridNavLayer(actors, L)
  if (!baked) return false

  const state = layerStates.get(L)
  if (!state?.ready) return false

  if (!state.agents.has(id)) {
    const agent = state.crowd.addAgent(
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
    state.agents.set(id, agent)
    agentLayers.set(id, L)
  }

  if (target) setGridNavAgentTarget(id, target)
  return true
}

export function setGridNavAgentTarget(id: string, target: [number, number, number]): boolean {
  const L = agentLayers.get(id)
  if (L === undefined) return false
  const agent = layerStates.get(L)?.agents.get(id)
  if (!agent) return false
  agent.requestMoveTarget({ x: target[0], y: target[1], z: target[2] })
  return true
}

export function gridNavAgentGetPosition(id: string): [number, number, number] | null {
  const L = agentLayers.get(id)
  if (L === undefined) return null
  const agent = layerStates.get(L)?.agents.get(id)
  if (!agent) return null
  const p = agent.position()
  return [p.x, p.y, p.z]
}

export function gridNavAgentLayer(id: string): number | null {
  const L = agentLayers.get(id)
  return L === undefined ? null : L
}

export function gridNavAgentCount(layer?: number): number {
  if (layer === undefined) return agentLayers.size
  const L = clampGridNavLayer(layer)
  return layerStates.get(L)?.agents.size ?? 0
}

export function removeGridNavAgent(id: string) {
  const L = agentLayers.get(id)
  if (L === undefined) return
  const state = layerStates.get(L)
  const agent = state?.agents.get(id)
  if (agent && state?.crowd) state.crowd.removeAgent(agent)
  state?.agents.delete(id)
  agentLayers.delete(id)
}

export function tickGridNavAgents(dt: number) {
  for (const state of layerStates.values()) {
    if (state.ready) state.crowd.update(dt)
  }
}