/** Wave 66 (v3.69–v3.73) — per-grid-layer Rapier collision groups for tile colliders. */

import * as THREE from 'three'
import type { Actor } from './Actor'
import { ensureGridLayerVisibility } from './gridMap'
import type { FoliageProps } from './types'

export const GRID_LAYER_COUNT = 4

const _colliderGeo = new THREE.BoxGeometry(1, 1, 1)
const _colliderMat = new THREE.MeshBasicMaterial({ visible: false })

function clampGridLayer(layer: number): number {
  return Math.max(0, Math.min(3, Math.floor(layer)))
}

/** Default Rapier group: membership = grid layer bit, collides with all layers. */
export function defaultGridLayerCollisionGroup(layer: number): number {
  const L = clampGridLayer(layer)
  return rapierGroupsFromLayerMask(L, 0xffff)
}

/** Pack UE-style membership layer (0–7) + collides-with bitmask into a Rapier group. */
export function rapierGroupsFromLayerMask(membership: number, mask: number): number {
  const layer = Math.max(0, Math.min(7, Math.floor(membership)))
  return (((1 << layer) << 16) | (mask & 0xffff)) >>> 0
}

export function membershipFromRapierGroup(group: number): number {
  const membership = (group >>> 16) & 0xffff
  for (let i = 0; i < 16; i++) {
    if (membership === 1 << i) return i
  }
  return 0
}

export function maskFromRapierGroup(group: number): number {
  return group & 0xffff
}

/** Ensure foliage props carry four packed Rapier collision groups (layers 0–3). */
export function ensureGridLayerCollisionGroups(props: FoliageProps): number[] {
  if (!props.gridLayerCollisionGroups) {
    props.gridLayerCollisionGroups = [0, 1, 2, 3].map((i) => defaultGridLayerCollisionGroup(i))
  }
  while (props.gridLayerCollisionGroups.length < GRID_LAYER_COUNT) {
    const i = props.gridLayerCollisionGroups.length
    props.gridLayerCollisionGroups.push(defaultGridLayerCollisionGroup(i))
  }
  return props.gridLayerCollisionGroups
}

export function getLayerCollisionGroup(props: FoliageProps, layer: number): number {
  const groups = ensureGridLayerCollisionGroups(props)
  return groups[clampGridLayer(layer)] ?? defaultGridLayerCollisionGroup(layer)
}

export function setLayerCollisionGroup(props: FoliageProps, layer: number, group: number): void {
  const groups = ensureGridLayerCollisionGroups(props)
  groups[clampGridLayer(layer)] = group >>> 0
}

function disposeFoliageColliderGroup(actor: Actor): void {
  const group = actor.foliageColliderGroup
  if (!group) return
  group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material !== _colliderMat) {
      ;(o.material as THREE.Material).dispose()
    }
  })
  group.removeFromParent()
  actor.foliageColliderGroup = undefined
}

/** Rebuild invisible cuboid colliders for painted grid cells with per-layer Rapier groups. */
export function rebuildFoliageColliders(actor: Actor): void {
  const props = actor.foliageProps
  if (!props?.snap) {
    disposeFoliageColliderGroup(actor)
    return
  }

  disposeFoliageColliderGroup(actor)
  const vis = ensureGridLayerVisibility(props)
  const groups = ensureGridLayerCollisionGroups(props)
  const group = new THREE.Group()
  group.userData.isFoliageCollider = true

  for (let layer = 0; layer <= 3; layer++) {
    if (vis[layer] === false) continue
    const bucket = props.gridLayers?.[layer]
    if (!bucket?.length) continue
    const collisionGroup = groups[layer] ?? defaultGridLayerCollisionGroup(layer)
    for (const [x, y, z] of bucket) {
      const mesh = new THREE.Mesh(_colliderGeo, _colliderMat)
      mesh.position.set(x, y, z)
      mesh.userData.isFoliageCollider = true
      mesh.userData.gridLayer = layer
      mesh.userData.rapierCollisionGroup = collisionGroup
      group.add(mesh)
    }
  }

  if (group.children.length === 0) return
  actor.foliageColliderGroup = group
  actor.root.add(group)
}

/** Read packed Rapier groups from rebuilt foliage tile colliders (test / debug). */
export function foliageColliderGroups(actor: Actor): number[] {
  const out: number[] = []
  actor.foliageColliderGroup?.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.isFoliageCollider) {
      out.push((o.userData.rapierCollisionGroup as number) ?? 0)
    }
  })
  return out
}