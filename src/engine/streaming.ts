import * as THREE from 'three'
import type { Actor } from './Actor'
import type { SerializedActor, SerializedLevel, StreamingSettings } from './types'
import { DEFAULT_STREAMING } from './types'

/** Actor types that stay loaded regardless of grid cell (global / spawn). */
export const ALWAYS_LOADED_TYPES = new Set(['DirectionalLight', 'AmbientLight', 'PlayerStart'])

export function worldToCell(x: number, z: number, gridSize: number): [number, number] {
  const g = Math.max(1, gridSize)
  return [Math.floor(x / g), Math.floor(z / g)]
}

export function cellKey(cx: number, cz: number): string {
  return `${cx},${cz}`
}

export function parseCellKey(key: string): [number, number] | null {
  const parts = key.split(',')
  if (parts.length !== 2) return null
  const cx = parseInt(parts[0], 10)
  const cz = parseInt(parts[1], 10)
  if (!Number.isFinite(cx) || !Number.isFinite(cz)) return null
  return [cx, cz]
}

export function isCellInRadius(
  actorCx: number,
  actorCz: number,
  camCx: number,
  camCz: number,
  radius: number,
): boolean {
  return Math.abs(actorCx - camCx) <= radius && Math.abs(actorCz - camCz) <= radius
}

export function actorAlwaysLoaded(type: string, streamCell?: [number, number]): boolean {
  if (ALWAYS_LOADED_TYPES.has(type)) return true
  if (!streamCell) return true
  return false
}

/** Whether an actor should be visible for the current camera cell. */
export function computeActorStreamVisible(
  actor: Pick<Actor, 'type' | 'streamCell'>,
  camPos: THREE.Vector3,
  settings: StreamingSettings,
): boolean {
  if (!settings.enabled || settings.gridSize <= 0) return true
  if (actorAlwaysLoaded(actor.type, actor.streamCell)) return true
  const camCell = worldToCell(camPos.x, camPos.z, settings.gridSize)
  return isCellInRadius(actor.streamCell![0], actor.streamCell![1], camCell[0], camCell[1], settings.loadRadius)
}

/** Combined grid + per-actor cull distance visibility. */
export function applyActorStreamingVisibility(
  actor: Actor,
  camPos: THREE.Vector3,
  settings: StreamingSettings,
): void {
  const streamOk = computeActorStreamVisible(actor, camPos, settings)
  const cullOk =
    actor.cullDistance <= 0 || actor.root.position.distanceTo(camPos) < actor.cullDistance
  actor.root.visible = actor.visible && streamOk && cullOk
}

/** Auto-assign streamCell from world XZ on save for non-global actors. */
export function assignStreamCellOnSave(
  sa: SerializedActor,
  gridSize: number,
  enabled: boolean,
): SerializedActor {
  if (!enabled || gridSize <= 0 || ALWAYS_LOADED_TYPES.has(sa.type)) return sa
  const [cx, cz] = worldToCell(sa.transform.position[0], sa.transform.position[2], gridSize)
  return { ...sa, streamCell: [cx, cz] }
}

export interface CellSplitResult {
  /** Actors that ship with the main level (lights, player start, no cell). */
  globalActors: SerializedActor[]
  /** Per-cell actor lists keyed by "cx,cz". */
  cells: Record<string, SerializedActor[]>
}

/** Split a serialized level into global + per-cell actor buckets for lazy export. */
export function splitLevelByCells(level: SerializedLevel): CellSplitResult {
  const settings: StreamingSettings = { ...DEFAULT_STREAMING, ...level.streaming }
  const globalActors: SerializedActor[] = []
  const cells: Record<string, SerializedActor[]> = {}

  for (const raw of level.actors) {
    const sa = assignStreamCellOnSave(raw, settings.gridSize, settings.enabled)
    if (actorAlwaysLoaded(sa.type, sa.streamCell)) {
      globalActors.push(sa)
      continue
    }
    const key = cellKey(sa.streamCell![0], sa.streamCell![1])
    if (!cells[key]) cells[key] = []
    cells[key].push(sa)
  }

  return { globalActors, cells }
}

/** Build or refresh a wireframe grid overlay around the camera cell. */
export function updateStreamingGridHelper(
  helper: THREE.LineSegments | null,
  camPos: THREE.Vector3,
  settings: StreamingSettings,
): THREE.LineSegments | null {
  if (!settings.enabled || settings.gridSize <= 0) {
    if (helper) {
      helper.geometry.dispose()
      ;(helper.material as THREE.Material).dispose()
    }
    return null
  }

  const gridSize = settings.gridSize
  const camCell = worldToCell(camPos.x, camPos.z, gridSize)
  const extent = settings.loadRadius + 2
  const minCx = camCell[0] - extent
  const maxCx = camCell[0] + extent + 1
  const minCz = camCell[1] - extent
  const maxCz = camCell[1] + extent + 1
  const y = 0.08
  const points: number[] = []

  for (let cx = minCx; cx <= maxCx; cx++) {
    const x = cx * gridSize
    points.push(x, y, minCz * gridSize, x, y, maxCz * gridSize)
  }
  for (let cz = minCz; cz <= maxCz; cz++) {
    const z = cz * gridSize
    points.push(minCx * gridSize, y, z, maxCx * gridSize, y, z)
  }

  // highlight load-radius cell borders
  const r = settings.loadRadius
  const loadMinCx = camCell[0] - r
  const loadMaxCx = camCell[0] + r + 1
  const loadMinCz = camCell[1] - r
  const loadMaxCz = camCell[1] + r + 1
  const hy = y + 0.02
  const loadPoints: number[] = []
  loadPoints.push(
    loadMinCx * gridSize,
    hy,
    loadMinCz * gridSize,
    loadMaxCx * gridSize,
    hy,
    loadMinCz * gridSize,
    loadMaxCx * gridSize,
    hy,
    loadMinCz * gridSize,
    loadMaxCx * gridSize,
    hy,
    loadMaxCz * gridSize,
    loadMaxCx * gridSize,
    hy,
    loadMaxCz * gridSize,
    loadMinCx * gridSize,
    hy,
    loadMaxCz * gridSize,
    loadMinCx * gridSize,
    hy,
    loadMinCz * gridSize,
  )

  const allPoints = [...points, ...loadPoints]

  if (!helper) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(allPoints, 3))
    helper = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0x44cc88, transparent: true, opacity: 0.75 }),
    )
    helper.userData.isHelper = true
    return helper
  }

  helper.geometry.dispose()
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(allPoints, 3))
  helper.geometry = geo
  return helper
}