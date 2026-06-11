import * as THREE from 'three'
import { Actor, nextActorId } from './Actor'
import type { WaterProps } from './types'

/** Water — UE Water-lite: CPU Gerstner-ish waves on a transparent plane. */

export const DEFAULT_WATER: WaterProps = {
  size: 40,
  color: '#1b4f6e',
  opacity: 0.78,
  waveHeight: 0.25,
  waveLength: 6,
  speed: 1,
}

const SEGS = 48

export function createWaterActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'Water')
  actor.waterProps = { ...DEFAULT_WATER }
  buildWaterMesh(actor)
  return actor
}

export function buildWaterMesh(actor: Actor) {
  const props = actor.waterProps!
  if (actor.mesh) {
    actor.mesh.removeFromParent()
    actor.mesh.geometry.dispose()
    ;(actor.mesh.material as THREE.Material).dispose()
  }
  const geo = new THREE.PlaneGeometry(props.size, props.size, SEGS, SEGS)
  const mat = new THREE.MeshStandardMaterial({
    color: props.color,
    transparent: true,
    opacity: props.opacity,
    roughness: 0.15,
    metalness: 0.4,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.userData.actorId = actor.id
  mesh.userData.isWater = true
  actor.mesh = mesh
  actor.root.add(mesh)
}

/** animate wave displacement — called every frame */
export function updateWater(actor: Actor, t: number) {
  const props = actor.waterProps
  const mesh = actor.mesh
  if (!props || !mesh) return
  const pos = mesh.geometry.attributes.position
  const k = (Math.PI * 2) / props.waveLength
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const h =
      Math.sin(x * k + t * props.speed) * 0.6 +
      Math.sin(y * k * 0.8 + t * props.speed * 1.3) * 0.3 +
      Math.sin((x + y) * k * 0.5 + t * props.speed * 0.7) * 0.4
    pos.setZ(i, h * props.waveHeight)
  }
  pos.needsUpdate = true
  mesh.geometry.computeVertexNormals()
}
