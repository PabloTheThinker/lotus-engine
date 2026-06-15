/**
 * Wave 102 (v5.49–v5.53) — Equipment visuals: socket-attached weapon mesh on paper-doll pawn.
 * Wave 108 (v5.79–v5.83) — Head/chest armor socket meshes.
 */

import * as THREE from 'three'
import type { Actor } from './Actor'
import { getEquipped, getEquipmentDef } from './rpgEquipment'

const WEAPON_SOCKET_NAME = 'EquipWeaponSocket'
const HEAD_SOCKET_NAME = 'EquipHeadSocket'
const CHEST_SOCKET_NAME = 'EquipChestSocket'

const weaponVisuals = new WeakMap<Actor, THREE.Object3D>()
const headVisuals = new WeakMap<Actor, THREE.Object3D>()
const chestVisuals = new WeakMap<Actor, THREE.Object3D>()

const WEAPON_SHAPES: Record<string, { color: string; scale: [number, number, number] }> = {
  iron_sword: { color: '#9aa4b2', scale: [0.08, 0.9, 0.18] },
  default: { color: '#b08df1', scale: [0.1, 0.5, 0.1] },
}

const ARMOR_SHAPES: Record<string, { color: string; scale: [number, number, number]; slot: 'head' | 'chest' }> = {
  leather_helm: { color: '#8b6914', scale: [0.55, 0.28, 0.55], slot: 'head' },
  leather_chest: { color: '#6b4f2a', scale: [0.7, 0.55, 0.35], slot: 'chest' },
}

function ensureSocket(actor: Actor, name: string, position: [number, number, number]): THREE.Object3D {
  let socket = actor.root.getObjectByName(name)
  if (!socket) {
    socket = new THREE.Object3D()
    socket.name = name
    socket.position.set(position[0], position[1], position[2])
    actor.root.add(socket)
  }
  return socket
}

function weaponSocket(actor: Actor): THREE.Object3D {
  return ensureSocket(actor, WEAPON_SOCKET_NAME, [0.35, 0.85, -0.15])
}

function headSocket(actor: Actor): THREE.Object3D {
  const s = ensureSocket(actor, HEAD_SOCKET_NAME, [0, 1.55, 0])
  s.rotation.set(0, 0, 0)
  return s
}

function chestSocket(actor: Actor): THREE.Object3D {
  return ensureSocket(actor, CHEST_SOCKET_NAME, [0, 1.05, 0])
}

function disposeMesh(mesh: THREE.Object3D): void {
  mesh.parent?.remove(mesh)
  if (mesh instanceof THREE.Mesh) {
    mesh.geometry.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) m.dispose()
  }
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

function buildArmorMesh(itemId: string, slot: 'head' | 'chest'): THREE.Mesh {
  const style = ARMOR_SHAPES[itemId] ?? {
    color: slot === 'head' ? '#7a8a9a' : '#5a6a7a',
    scale: slot === 'head' ? ([0.5, 0.25, 0.5] as [number, number, number]) : ([0.65, 0.5, 0.32] as [number, number, number]),
    slot,
  }
  const geo = slot === 'head' ? new THREE.SphereGeometry(0.5, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55) : new THREE.BoxGeometry(1, 1, 0.5)
  const mat = new THREE.MeshStandardMaterial({
    color: style.color,
    metalness: 0.25,
    roughness: 0.65,
    emissive: '#101418',
    emissiveIntensity: 0.08,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.scale.set(style.scale[0], style.scale[1], style.scale[2])
  mesh.castShadow = true
  mesh.userData.equipmentVisual = itemId
  mesh.userData.equipmentSlot = slot
  return mesh
}

export function detachWeaponVisual(actor: Actor): void {
  const prev = weaponVisuals.get(actor)
  if (prev) {
    disposeMesh(prev)
    weaponVisuals.delete(actor)
  }
}

export function detachArmorVisual(actor: Actor, slot: 'head' | 'chest'): void {
  const map = slot === 'head' ? headVisuals : chestVisuals
  const prev = map.get(actor)
  if (prev) {
    disposeMesh(prev)
    map.delete(actor)
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

export function attachArmorVisual(actor: Actor, itemId: string): boolean {
  const def = getEquipmentDef(itemId)
  if (!def || (def.slot !== 'head' && def.slot !== 'chest')) return false
  detachArmorVisual(actor, def.slot)
  const mesh = buildArmorMesh(def.id, def.slot)
  const socket = def.slot === 'head' ? headSocket(actor) : chestSocket(actor)
  socket.add(mesh)
  const map = def.slot === 'head' ? headVisuals : chestVisuals
  map.set(actor, mesh)
  return true
}

/** Sync weapon + armor socket meshes from equipped slots. */
export function syncEquipmentVisuals(actor: Actor): string | null {
  const equipped = getEquipped(actor)
  detachWeaponVisual(actor)
  detachArmorVisual(actor, 'head')
  detachArmorVisual(actor, 'chest')
  let primary: string | null = null
  if (equipped.weapon) {
    attachWeaponVisual(actor, equipped.weapon)
    primary = equipped.weapon
  }
  if (equipped.head) attachArmorVisual(actor, equipped.head)
  if (equipped.chest) attachArmorVisual(actor, equipped.chest)
  return primary
}

export function getWeaponVisualId(actor: Actor): string | null {
  const obj = weaponVisuals.get(actor)
  if (!obj) return null
  return (obj.userData.equipmentVisual as string | undefined) ?? null
}

export function getArmorVisualId(actor: Actor, slot: 'head' | 'chest'): string | null {
  const map = slot === 'head' ? headVisuals : chestVisuals
  const obj = map.get(actor)
  if (!obj) return null
  return (obj.userData.equipmentVisual as string | undefined) ?? null
}

export function resetEquipmentVisuals(): void {
  // WeakMap entries drop when actors are GC'd.
}