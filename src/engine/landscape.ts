import * as THREE from 'three'
import { Actor, nextActorId } from './Actor'
import type { LandscapeProps, SculptTool } from './types'
import { createLandscapeSplatMaterial, refreshLandscapeSplatMaterial } from './landscapeSplat'

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

/** grass, rock, dirt, snow */
export const DEFAULT_LAYERS: [string, string, string, string] = ['#46553f', '#6e6e72', '#6e5239', '#dfe7ec']

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
  const vcount = geo.attributes.position.count
  if (!props.layerColors) props.layerColors = [...DEFAULT_LAYERS]
  if (!props.weights || props.weights.length !== vcount * 4) {
    props.weights = new Array(vcount * 4).fill(0)
    for (let i = 0; i < vcount; i++) props.weights[i * 4] = 1
  }
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vcount * 3), 3))
  const mat = props.useSplatMap
    ? createLandscapeSplatMaterial(props)
    : new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, metalness: 0, vertexColors: true })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = true
  mesh.castShadow = false
  mesh.userData.actorId = actor.id
  mesh.userData.isLandscape = true
  actor.mesh = mesh
  actor.root.add(mesh)
  syncLandscapeHeights(actor)
  syncLandscapeColors(actor)
}

/** blend layer colors by per-vertex weights into the color attribute */
export function syncLandscapeColors(actor: Actor) {
  const props = actor.landscapeProps!
  const mesh = actor.mesh!
  if (props.useSplatMap && mesh.material instanceof THREE.ShaderMaterial) {
    refreshLandscapeSplatMaterial(mesh.material, props)
    return
  }
  const colorAttr = mesh.geometry.attributes.color
  if (!colorAttr || !props.weights || !props.layerColors) return
  const cols = props.layerColors.map((c) => new THREE.Color(c))
  for (let i = 0; i < colorAttr.count; i++) {
    let r = 0, g = 0, b = 0
    for (let l = 0; l < 4; l++) {
      const w = props.weights[i * 4 + l]
      r += cols[l].r * w
      g += cols[l].g * w
      b += cols[l].b * w
    }
    colorAttr.setXYZ(i, r, g, b)
  }
  colorAttr.needsUpdate = true
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
  paintLayer = 0,
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
      if (tool === 'paint' && props.weights) {
        const blend = Math.min(1, strength * 2) * falloff
        let sum = 0
        for (let l = 0; l < 4; l++) {
          const cur = props.weights[idx * 4 + l]
          const target = l === paintLayer ? 1 : 0
          const w = THREE.MathUtils.lerp(cur, target, blend)
          props.weights[idx * 4 + l] = w
          sum += w
        }
        for (let l = 0; l < 4; l++) props.weights[idx * 4 + l] /= sum || 1
        changed = true
        continue
      }
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
  if (changed) {
    if (tool === 'paint') syncLandscapeColors(actor)
    else syncLandscapeHeights(actor)
  }
  return changed
}

/** Bilinear sample of landscape height at world XZ (returns world Y or null if no hit). */
export function sampleLandscapeHeight(actors: Iterable<Actor>, worldX: number, worldZ: number): number | null {
  let best: number | null = null
  const probe = new THREE.Vector3(worldX, 0, worldZ)
  const local = new THREE.Vector3()
  const worldPt = new THREE.Vector3()

  for (const actor of actors) {
    if (actor.type !== 'Landscape' || !actor.landscapeProps || !actor.mesh) continue
    const props = actor.landscapeProps
    const mesh = actor.mesh
    local.copy(probe)
    mesh.worldToLocal(local)

    const half = props.size / 2
    const n = props.resolution + 1
    const step = props.size / props.resolution
    const gx = (local.x + half) / step
    const gy = (half - local.y) / step
    if (gx < 0 || gy < 0 || gx > n - 1 || gy > n - 1) continue

    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    const fx = gx - x0
    const fy = gy - y0
    const x1 = Math.min(x0 + 1, n - 1)
    const y1 = Math.min(y0 + 1, n - 1)
    const h00 = props.heights[y0 * n + x0] ?? 0
    const h10 = props.heights[y0 * n + x1] ?? h00
    const h01 = props.heights[y1 * n + x0] ?? h00
    const h11 = props.heights[y1 * n + x1] ?? h00
    const h = THREE.MathUtils.lerp(THREE.MathUtils.lerp(h00, h10, fx), THREE.MathUtils.lerp(h01, h11, fx), fy)

    local.z = h
    worldPt.copy(local)
    mesh.localToWorld(worldPt)
    if (best === null || worldPt.y > best) best = worldPt.y
  }
  return best
}
