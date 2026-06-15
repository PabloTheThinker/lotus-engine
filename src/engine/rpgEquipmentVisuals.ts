/**
 * Wave 102 (v5.49–v5.53) — Equipment visuals: socket-attached weapon mesh on paper-doll pawn.
 */

import * as THREE from 'three'
import type { Actor } from './Actor'
import { getEquipped, getEquipmentDef } from './rpgEquipment'

const WEAPON_SOCKET_NAME = 'EquipWeaponSocket'
const weaponVisuals = new WeakMap<Actor, THREE.Object3D>()

const WEAPON_SHAPES: Record<string, { color: string; scale: [number, number, number] }> = {
  iron_sword: { color: '#9aa4b2', scale: [0.08, 0.9, 0.18] },
  default: { color: '#b08df1', scale: [0.1, 0.5, 0.1] },
}

function weaponSocket(actor: Actor): THREE.Object3D {
  let socket = actor.root.getObjectByName(WEAPON_SOCKET_NAME)
  if (!socket) {
    socket = new THREE.Object3D()
    socket.name = WEAPON_SOCKET_NAME
    socket.position.set(0.35, 0.85, -0.15)
    socket.rotation.set(0, 0, -0.35)
    actor.root.add(socket)
  }
  return socket
}

function buildWeaponMesh(itemId: string): THREE.Mesh {
  const style = WEAPON_SHAPES[itemId] ?? WEAPON_SHAPES.default
  const geo = new THREE.BoxGeometry(1, 1, 1)
  const mat = new THREE.MeshStandardMaterial({
    color: style.color,
    metalness: 0.55,
    roughness: 0.35,
    emissive: '#1a2030',
    emissiveIntensity: 0.15,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.scale.set(style.scale[0], style.scale[1], style.scale[2])
  mesh.castShadow = true
  mesh.userData.equipmentVisual = itemId
  return mesh
}

export function detachWeaponVisual(actor: Actor): void {
  const prev = weaponVisuals.get(actor)
  if (prev) {
    prev.parent?.remove(prev)
    if (prev instanceof THREE.Mesh) {
      prev.geometry.dispose()
      const mats = Array.isArray(prev.material) ? prev.material : [prev.material]
      for (const m of mats) m.dispose()
    }
    weaponVisuals.delete(actor)
  }
}

export function attachWeaponVisual(actor: Actor, itemId: string): boolean {
  const def = getEquipmentDef(itemId)
  if (!def || def.slot !== 'weapon') return false
  detachWeaponVisual(actor)
  const mesh = buildWeaponMesh(def.id)
  weaponSocket(actor).add(mesh)
  weaponVisuals.set(actor, mesh)
  return true
}

/** Sync weapon socket mesh from equipped weapon slot. */
export function syncEquipmentVisuals(actor: Actor): string | null {
  const equipped = getEquipped(actor).weapon
  detachWeaponVisual(actor)
  if (!equipped) return null
  attachWeaponVisual(actor, equipped)
  return equipped
}

export function getWeaponVisualId(actor: Actor): string | null {
  const obj = weaponVisuals.get(actor)
  if (!obj) return null
  return (obj.userData.equipmentVisual as string | undefined) ?? null
}

export function resetEquipmentVisuals(): void {
  // WeakMap entries drop when actors are GC'd.
}