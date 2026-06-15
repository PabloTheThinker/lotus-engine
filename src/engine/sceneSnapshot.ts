/**
 * Wave 112 (v5.99–v6.03) — Generic scene snapshot capture/apply (transforms + script vars).
 * Engine-core round-trip for save systems, replay, and editor tooling — not RPG-specific.
 */

import type { Actor } from './Actor'
import type { TransformSnapshot } from './types'

export const SCENE_SNAPSHOT_VERSION = 1 as const

export interface SceneActorSnapshot {
  id: string
  name: string
  transform: TransformSnapshot
  scriptVars?: Record<string, unknown>
  visible?: boolean
}

export interface SceneSnapshot {
  version: typeof SCENE_SNAPSHOT_VERSION
  capturedAt: number
  levelName: string
  actors: SceneActorSnapshot[]
}

export function captureSceneSnapshot(
  actors: Iterable<Actor>,
  levelName: string,
  now = Date.now(),
): SceneSnapshot {
  const rows: SceneActorSnapshot[] = []
  for (const actor of actors) {
    rows.push({
      id: actor.id,
      name: actor.name,
      transform: {
        position: [...actor.transform.position] as [number, number, number],
        rotation: [...actor.transform.rotation] as [number, number, number],
        scale: [...actor.transform.scale] as [number, number, number],
      },
      scriptVars: actor.scriptVars ? { ...actor.scriptVars } : undefined,
      visible: actor.visible,
    })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return { version: SCENE_SNAPSHOT_VERSION, capturedAt: now, levelName, actors: rows }
}

export function applySceneSnapshot(actors: Map<string, Actor>, snapshot: unknown): number {
  if (!snapshot || typeof snapshot !== 'object') return 0
  const raw = snapshot as SceneSnapshot
  if (raw.version !== SCENE_SNAPSHOT_VERSION || !Array.isArray(raw.actors)) return 0
  let applied = 0
  for (const row of raw.actors) {
    const actor = actors.get(row.id) ?? [...actors.values()].find((a) => a.name === row.name)
    if (!actor || !row.transform) continue
    actor.transform.position = [...row.transform.position] as [number, number, number]
    actor.transform.rotation = [...row.transform.rotation] as [number, number, number]
    actor.transform.scale = [...row.transform.scale] as [number, number, number]
    actor.root.position.set(...actor.transform.position)
    actor.root.rotation.set(...actor.transform.rotation)
    actor.root.scale.set(...actor.transform.scale)
    if (row.scriptVars) actor.scriptVars = { ...row.scriptVars }
    if (row.visible != null) actor.visible = row.visible
    applied++
  }
  return applied
}