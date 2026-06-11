import * as THREE from 'three'
import { Actor, nextActorId } from './Actor'
import { buildGeometry } from './factory'
import type { PCGProps } from './types'

/**
 * PCG-lite — UE Procedural Content Generation, fixed pipeline:
 * sample (seeded jittered grid in the volume) → filter (surface hit + slope)
 * → transform (scale/rotation jitter, normal alignment) → spawn (instances).
 * Regenerates live when props change; only the seed serializes.
 */

export const DEFAULT_PCG: PCGProps = {
  geometry: 'cone',
  color: '#4a6b3f',
  density: 6,
  seed: 42,
  scaleMin: 0.5,
  scaleMax: 1.6,
  maxSlopeDeg: 35,
  alignToNormal: false,
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createPCGVolumeActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'PCGVolume')
  actor.pcgProps = { ...DEFAULT_PCG }
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xd6a839, wireframe: true, transparent: true, opacity: 0.4, depthWrite: false }),
  )
  box.userData.actorId = id
  box.userData.isEditorOnly = true
  actor.mesh = box
  actor.root.add(box)
  return actor
}

/** regenerate instances inside the volume by raycasting the world */
export function regeneratePCG(actor: Actor, actors: Map<string, Actor>) {
  const props = actor.pcgProps
  if (!props) return
  if (actor.pcgMesh) {
    actor.pcgMesh.removeFromParent()
    actor.pcgMesh.geometry.dispose()
    ;(actor.pcgMesh.material as THREE.Material).dispose()
  }
  const rand = mulberry32(props.seed)
  const scale = new THREE.Vector3()
  actor.root.getWorldScale(scale)
  const origin = new THREE.Vector3()
  actor.root.getWorldPosition(origin)
  const w = scale.x
  const d = scale.z
  const top = origin.y + scale.y / 2

  const targets: THREE.Object3D[] = []
  for (const a of actors.values()) {
    if (a.id === actor.id) continue
    a.root.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.isHelper && !o.userData.isEditorOnly && !o.userData.isWater) targets.push(o)
    })
  }

  const count = Math.min(2000, Math.round((w * d * props.density) / 100))
  const placements: Array<{ p: THREE.Vector3; q: THREE.Quaternion; s: number }> = []
  const ray = new THREE.Raycaster()
  const down = new THREE.Vector3(0, -1, 0)
  const maxSlopeCos = Math.cos(THREE.MathUtils.degToRad(props.maxSlopeDeg))
  for (let i = 0; i < count; i++) {
    const x = origin.x + (rand() - 0.5) * w
    const z = origin.z + (rand() - 0.5) * d
    ray.set(new THREE.Vector3(x, top, z), down)
    ray.far = scale.y + 2
    const hit = ray.intersectObjects(targets, false)[0]
    if (!hit || !hit.face) continue
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
    if (n.y < maxSlopeCos) continue // slope filter
    const sc = props.scaleMin + rand() * (props.scaleMax - props.scaleMin)
    const q = new THREE.Quaternion()
    if (props.alignToNormal) q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n)
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2))
    placements.push({ p: hit.point.clone().add(new THREE.Vector3(0, sc * 0.5, 0)), q, s: sc })
  }

  const mesh = new THREE.InstancedMesh(
    buildGeometry(props.geometry),
    new THREE.MeshStandardMaterial({ color: props.color, roughness: 0.85 }),
    Math.max(1, placements.length),
  )
  mesh.castShadow = true
  mesh.userData.isEditorOnly = true
  const m4 = new THREE.Matrix4()
  const sv = new THREE.Vector3()
  placements.forEach((pl, i) => {
    sv.setScalar(pl.s)
    m4.compose(pl.p, pl.q, sv)
    mesh.setMatrixAt(i, m4)
  })
  mesh.count = placements.length
  // instances live in world space — attach to the scene root, not the volume
  actor.pcgMesh = mesh
  actor.root.parent?.add(mesh)
}
