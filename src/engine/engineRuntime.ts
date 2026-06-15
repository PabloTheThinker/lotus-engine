/**
 * Wave 115 (v6.14–v6.18) — Engine runtime introspection (three.js core, genre-agnostic).
 */

import type { World } from './World'
import type { RenderBackend } from './renderBackend'
import type { LiveSnapshot } from './liveSnapshot'
import { getLiveSnapshot } from './liveSnapshot'

export interface EngineRuntimeSnapshot extends LiveSnapshot {
  levelName: string
  renderBackend: RenderBackend
  saveSlotsEnabled: boolean
  streamingEnabled: boolean
}

export function getEngineRuntimeSnapshot(
  world: World,
  editor: { playing: boolean; ejected: boolean; simulate: boolean; selectedId: string | null },
  renderBackend: RenderBackend,
): EngineRuntimeSnapshot {
  const live = getLiveSnapshot(world, editor)
  return {
    ...live,
    levelName: world.levelName,
    renderBackend,
    saveSlotsEnabled: world.environment.saveSlotsEnabled === true,
    streamingEnabled: world.streaming.enabled === true,
  }
}