/** Wave 71 (v3.94–v3.98) — Recast walkable mask per grid collision layer. */

import * as THREE from 'three'
import type { Actor } from './Actor'
import { bakeNavMeshFromMeshes, collectNavMeshes } from './nav'
import type { FoliageProps } from './types'

export const DEFAULT_GRID_NAVMESH_LAYER_MASK = 0b0001

export function clampNavmeshLayerMask(mask: number): number {
  return mask & 0x0f
}

/** Bitmask of grid layers (0–3) included in navmesh bake; default layer 0 only. */
export function getNavmeshLayerMask(props: FoliageProps): number {
  const mask = props.gridNavmeshLayerMask
  return mask === undefined ? DEFAULT_GRID_NAVMESH_LAYER_MASK : clampNavmeshLayerMask(mask)
}

export function setNavmeshLayerMask(props: FoliageProps, mask: number): void {
  props.gridNavmeshLayerMask = clampNavmeshLayerMask(mask)
}

export function layerMaskFromIndex(layer: number): number {
  const L = Math.max(0, Math.min(3, Math.floor(layer)))
  return 1 << L
}

export function isLayerInNavmeshMask(mask: number, layer: number): boolean {
  return (clampNavmeshLayerMask(mask) & layerMaskFromIndex(layer)) !== 0
}

/** Foliage grid tile colliders whose layer bit is set in mask. */
export function collectFoliageNavColliderMeshes(actors: Map<string, Actor>, layerMask: number): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  const mask = clampNavmeshLayerMask(layerMask)
  if (!mask) return meshes

  for (const a of actors.values()) {
    if (!a.foliageProps?.snap) continue
    a.foliageColliderGroup?.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      if (!o.userData.isFoliageCollider) return
      const layer = (o.userData.gridLayer as number) ?? 0
      if (!isLayerInNavmeshMask(mask, layer)) return
      meshes.push(o)
    })
  }
  return meshes
}

/** Static + landscape + foliage colliders for layers in mask. */
export function collectGridNavMeshes(actors: Map<string, Actor>, layerMask: number): THREE.Mesh[] {
  return [...collectNavMeshes(actors), ...collectFoliageNavColliderMeshes(actors, layerMask)]
}

export async function bakeNavMeshLayers(actors: Map<string, Actor>, layerMask: number): Promise<boolean> {
  return bakeNavMeshFromMeshes(collectGridNavMeshes(actors, layerMask))
}

/** Bake navmesh from one grid layer's foliage colliders merged with static geometry. */
export async function bakeNavMeshForGridLayer(actors: Map<string, Actor>, layer: number): Promise<boolean> {
  return bakeNavMeshLayers(actors, layerMaskFromIndex(layer))
}

/** Union navmesh layer masks from all snap-mode foliage actors; default layer 0. */
export function combinedNavmeshLayerMask(actors: Map<string, Actor>): number {
  let mask = 0
  for (const a of actors.values()) {
    if (!a.foliageProps?.snap) continue
    mask |= getNavmeshLayerMask(a.foliageProps)
  }
  return mask || DEFAULT_GRID_NAVMESH_LAYER_MASK
}