import * as THREE from 'three'
import { Actor, nextActorId } from './Actor'
import type { LandscapeProps, SculptTool } from './types'

/**
 * Landscape — UE heightmap terrain. A subdivided plane whose vertex heights
 * live in a serializable float list; sculpt brushes mutate the heights and
 * resync the geometry. Physics uses a trimesh collider built from the mesh.
 */

export const DEFAULT_LANDSCAPE: Omit<LandscapeProps, 'heights'> = {
  size: 60,
  resolution: 96,
  color: '#46553f',
}

export function createLandscapeActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'Landscape')
  const res = DEFAULT_LANDSCAPE.resolution
  actor.landscapeProps = {
    ...DEFAULT_LANDSCAPE,
    heights: new Array((res + 1) * (res + 1)).fill(0),
  }
  buildLandscapeMesh(actor)
  return actor
}

export function buildLandscapeMesh(actor: Actor) {
  const props = actor.landscapeProps!
  if (actor.mesh) {
    actor.mesh.removeFromParent()
    actor.mesh.geometry.dispose()
    ;(actor.mesh.material as THREE.Material).dispose()
  }
  const geo = new THREE.PlaneGeometry(props.size, props.size, props.resolution, props.resolution)
  const mat = new THREE.MeshStandardMaterial({ color: props.color, roughness: 0.92, metalness: 0 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = true
  mesh.castShadow = false
  mesh.userData.actorId = actor.id
  mesh.userData.isLandscape = true
  actor.mesh = mesh
  actor.root.add(mesh)
  syncLandscapeHeights(actor)
}

/** write the heights list into the geometry (plane local Z = world Y). */
export function syncLandscapeHeights(actor: Actor) {
  const props = actor.landscapeProps!
  const pos = actor.mesh!.geometry.attributes.position
  for (let i = 0; i < pos.count; i++) {
    pos.setZ(i, props.heights[i] ?? 0)
  }
  pos.needsUpdate = true
  actor.mesh!.geometry.computeVertexNormals()
  actor.mesh!.geometry.computeBoundingSphere()
}

/**
 * Apply one brush stamp at a world-space point.
 * Returns true if any height changed.
 */
export function sculptStamp(
  actor: Actor,
  worldPoint: THREE.Vector3,
  tool: SculptTool,
  radius: number,
  strength: number,
): boolean {
  const props = actor.landscapeProps!
  const mesh = actor.mesh!
  const local = mesh.worldToLocal(worldPoint.clone()) // plane space: x, y in-plane, z = height
  const n = props.resolution + 1
  const half = props.size / 2
  const step = props.size / props.resolution
  let changed = false

  // brush center height for flatten
  let centerH = 0
  if (tool === 'flatten') {
    const cx = Math.round((local.x + half) / step)
    const cy = Math.round((half - local.y) / step)
    centerH = props.heights[THREE.MathUtils.clamp(cy, 0, n - 1) * n + THREE.MathUtils.clamp(cx, 0, n - 1)] ?? 0
  }

  const minX = Math.max(0, Math.floor((local.x - radius + half) / step))
  const maxX = Math.min(n - 1, Math.ceil((local.x + radius + half) / step))
  const minY = Math.max(0, Math.floor((half - local.y - radius) / step))
  const maxY = Math.min(n - 1, Math.ceil((half - local.y + radius) / step))

  for (let gy = minY; gy <= maxY; gy++) {
    for (let gx = minX; gx <= maxX; gx++) {
      const vx = -half + gx * step
      const vy = half - gy * step
      const d = Math.hypot(vx - local.x, vy - local.y)
      if (d > radius) continue
      const falloff = 1 - THREE.MathUtils.smoothstep(d / radius, 0, 1)
      const idx = gy * n + gx
      const h = props.heights[idx]
      let next = h
      switch (tool) {
        case 'raise':
          next = h + strength * falloff
          break
        case 'lower':
          next = h - strength * falloff
          break
        case 'flatten':
          next = THREE.MathUtils.lerp(h, centerH, Math.min(1, strength * 2) * falloff)
          break
        case 'smooth': {
          // average of the 4-neighborhood
          const l = props.heights[idx - 1] ?? h
          const r = props.heights[idx + 1] ?? h
          const u = props.heights[idx - n] ?? h
          const dn = props.heights[idx + n] ?? h
          next = THREE.MathUtils.lerp(h, (l + r + u + dn) / 4, Math.min(1, strength * 2) * falloff)
          break
        }
      }
      if (next !== h) {
        props.heights[idx] = next
        changed = true
      }
    }
  }
  if (changed) syncLandscapeHeights(actor)
  return changed
}
