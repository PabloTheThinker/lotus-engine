/**
 * Wave 107 (v5.74–v5.78) — Vendor NPC interact: dialogue hook + shop panel on Vendor-tagged actors.
 */

import * as THREE from 'three'
import type { Actor } from './Actor'
import { actionJustPressed } from './inputActions'
import { DEFAULT_SHOP_ID } from './rpgShop'

export const VENDOR_NPC_TAG = 'Vendor'
export const VENDOR_INTERACT_RADIUS = 2.5

export interface VendorOpenPayload {
  shopId: string
  vendorName: string
  greeting: string
}

type VendorOpenListener = (payload: VendorOpenPayload) => void

let openListener: VendorOpenListener | null = null

const _pos = new THREE.Vector3()

function actorWorldPosition(actor: Actor, out: THREE.Vector3): THREE.Vector3 {
  actor.root.updateMatrixWorld(true)
  return out.setFromMatrixPosition(actor.root.matrixWorld)
}

export function vendorShopIdForActor(actor: Actor): string {
  const raw = actor.scriptVars?.shopId
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return DEFAULT_SHOP_ID
}

export function vendorGreetingForActor(actor: Actor): string {
  const raw = actor.scriptVars?.greeting
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return `Welcome to ${actor.name}'s shop!`
}

export function setVendorOpenListener(listener: VendorOpenListener | null): void {
  openListener = listener
}

export function openVendorShop(actor: Actor): boolean {
  if (!actor.tags.includes(VENDOR_NPC_TAG)) return false
  const payload: VendorOpenPayload = {
    shopId: vendorShopIdForActor(actor),
    vendorName: actor.name,
    greeting: vendorGreetingForActor(actor),
  }
  openListener?.(payload)
  return true
}

/** Interact with nearest Vendor-tagged actor within radius. */
export function tickVendorInteract(
  actors: Iterable<Actor>,
  pawnPos: THREE.Vector3 | null,
  interactJustPressed = actionJustPressed('Interact'),
): boolean {
  if (!pawnPos || !interactJustPressed) return false
  let best: { actor: Actor; distSq: number } | null = null
  const r2 = VENDOR_INTERACT_RADIUS * VENDOR_INTERACT_RADIUS
  for (const actor of actors) {
    if (!actor.tags.includes(VENDOR_NPC_TAG)) continue
    actorWorldPosition(actor, _pos)
    const dx = _pos.x - pawnPos.x
    const dz = _pos.z - pawnPos.z
    const distSq = dx * dx + dz * dz
    if (distSq > r2) continue
    if (!best || distSq < best.distSq) best = { actor, distSq }
  }
  if (!best) return false
  return openVendorShop(best.actor)
}

export function resetRpgVendorNpc(): void {
  openListener = null
}