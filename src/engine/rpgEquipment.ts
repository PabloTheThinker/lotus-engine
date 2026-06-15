/**
 * Wave 97 (v5.24–v5.28) — RPG equipment slots (weapon/armor paper-doll + GAS stat modifiers).
 * Pairs with rpgInventory.ts items and gameplayAbilities.ts AttributeSet.
 */

import type { Actor } from './Actor'
import { getAttribute, setAttribute } from './gameplayAbilities'
import {
  addItem,
  ensurePlayerRpgActor,
  hasItem,
  registerItem,
  removeItem,
} from './rpgInventory'

const EQUIP_KEY = 'lotus-engine.rpg-equipment'

export const EQUIPMENT_SLOTS = ['weapon', 'head', 'chest', 'legs', 'accessory'] as const
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number]

export interface EquipmentStatModifier {
  attribute: string
  value: number
}

export interface EquipmentItemDef {
  id: string
  name: string
  slot: EquipmentSlot
  modifiers: EquipmentStatModifier[]
}

export type EquipmentSnapshot = Record<EquipmentSlot, string | null>

interface ActorEquipmentState {
  slots: EquipmentSnapshot
}

const DEFAULT_EQUIPMENT: EquipmentItemDef[] = [
  {
    id: 'iron_sword',
    name: 'Iron Sword',
    slot: 'weapon',
    modifiers: [{ attribute: 'damage', value: 10 }],
  },
  {
    id: 'leather_helm',
    name: 'Leather Helm',
    slot: 'head',
    modifiers: [{ attribute: 'Health', value: 5 }],
  },
]

const actorEquipment = new WeakMap<Actor, ActorEquipmentState>()

function emptyEquipmentSnapshot(): EquipmentSnapshot {
  return {
    weapon: null,
    head: null,
    chest: null,
    legs: null,
    accessory: null,
  }
}

function normalizeModifier(mod: EquipmentStatModifier): EquipmentStatModifier {
  const attribute = String(mod.attribute ?? '').trim()
  const value = Number(mod.value)
  if (!attribute || !Number.isFinite(value)) return { attribute: 'Health', value: 0 }
  return { attribute, value }
}

function normalizeEquipmentDef(def: EquipmentItemDef): EquipmentItemDef {
  return {
    id: String(def.id).trim(),
    name: String(def.name ?? def.id).trim() || String(def.id),
    slot: EQUIPMENT_SLOTS.includes(def.slot) ? def.slot : 'accessory',
    modifiers: Array.isArray(def.modifiers) ? def.modifiers.map(normalizeModifier).filter((m) => m.value !== 0) : [],
  }
}

export function loadEquipmentLibrary(): EquipmentItemDef[] {
  try {
    const raw = JSON.parse(localStorage.getItem(EQUIP_KEY) ?? 'null') as EquipmentItemDef[] | null
    if (!Array.isArray(raw) || !raw.length) return [...DEFAULT_EQUIPMENT]
    return raw.map(normalizeEquipmentDef)
  } catch {
    return [...DEFAULT_EQUIPMENT]
  }
}

export function saveEquipmentLibrary(items: EquipmentItemDef[]): void {
  localStorage.setItem(EQUIP_KEY, JSON.stringify(items))
}

export function listEquipmentItems(): EquipmentItemDef[] {
  return loadEquipmentLibrary()
}

export function getEquipmentDef(id: string): EquipmentItemDef | undefined {
  const q = id.toLowerCase()
  return listEquipmentItems().find((item) => item.id.toLowerCase() === q || item.name.toLowerCase() === q)
}

/** Register equippable item (also adds a non-stackable inventory entry). */
export function registerEquipmentItem(def: EquipmentItemDef): EquipmentItemDef {
  const normalized = normalizeEquipmentDef(def)
  const items = loadEquipmentLibrary()
  const idx = items.findIndex((item) => item.id === normalized.id)
  if (idx >= 0) items[idx] = normalized
  else items.push(normalized)
  saveEquipmentLibrary(items)
  registerItem({
    id: normalized.id,
    name: normalized.name,
    stackable: false,
    maxStack: 1,
  })
  return normalized
}

export function resetRpgEquipment(): void {
  // WeakMap entries drop when actors are GC'd; beginPlay creates fresh actors each session.
}

export function initActorEquipment(actor: Actor): void {
  if (actorEquipment.has(actor)) return
  actorEquipment.set(actor, { slots: emptyEquipmentSnapshot() })
}

function ensureEquipment(actor: Actor): ActorEquipmentState {
  let state = actorEquipment.get(actor)
  if (!state) {
    initActorEquipment(actor)
    state = actorEquipment.get(actor)!
  }
  return state
}

function applyModifiers(actor: Actor, modifiers: EquipmentStatModifier[], sign: 1 | -1): void {
  ensurePlayerRpgActor(actor)
  for (const mod of modifiers) {
    const cur = getAttribute(actor, mod.attribute) ?? 0
    setAttribute(actor, mod.attribute, cur + sign * mod.value)
  }
}

export function getEquipped(actor: Actor): EquipmentSnapshot {
  return { ...ensureEquipment(actor).slots }
}

export function equip(actor: Actor, itemId: string): boolean {
  const def = getEquipmentDef(itemId)
  if (!def) return false
  if (!hasItem(actor, def.id)) return false

  ensurePlayerRpgActor(actor)
  const state = ensureEquipment(actor)
  const occupied = state.slots[def.slot]
  if (occupied) {
    const swapped = unequip(actor, def.slot)
    if (!swapped) return false
  }
  if (!removeItem(actor, def.id, 1)) return false

  state.slots[def.slot] = def.id
  applyModifiers(actor, def.modifiers, 1)
  return true
}

export function unequip(actor: Actor, slot: EquipmentSlot): boolean {
  const state = ensureEquipment(actor)
  const itemId = state.slots[slot]
  if (!itemId) return false
  const def = getEquipmentDef(itemId)
  if (!def) {
    state.slots[slot] = null
    return false
  }

  state.slots[slot] = null
  applyModifiers(actor, def.modifiers, -1)
  return addItem(actor, def.id, 1)
}

export function applyEquipment(actor: Actor, snapshot: EquipmentSnapshot | undefined): boolean {
  if (!snapshot) return false
  ensurePlayerRpgActor(actor)
  const state = ensureEquipment(actor)

  for (const slot of EQUIPMENT_SLOTS) {
    const currentId = state.slots[slot]
    if (currentId) {
      const curDef = getEquipmentDef(currentId)
      if (curDef) applyModifiers(actor, curDef.modifiers, -1)
      state.slots[slot] = null
    }
  }

  for (const slot of EQUIPMENT_SLOTS) {
    const itemId = snapshot[slot]
    if (!itemId) {
      state.slots[slot] = null
      continue
    }
    const def = getEquipmentDef(itemId)
    if (!def || def.slot !== slot) {
      state.slots[slot] = null
      continue
    }
    state.slots[slot] = def.id
    applyModifiers(actor, def.modifiers, 1)
  }
  return true
}

export function buildEquipmentCheckpointExtras(actor: Actor | undefined): { equipment?: EquipmentSnapshot } {
  const player = ensurePlayerRpgActor(actor ?? undefined)
  if (!player) return {}
  const equipped = getEquipped(player)
  const hasAny = EQUIPMENT_SLOTS.some((slot) => equipped[slot] != null)
  return hasAny ? { equipment: equipped } : {}
}

export function applyEquipmentCheckpointExtras(actor: Actor | undefined, data: unknown): void {
  const player = ensurePlayerRpgActor(actor ?? undefined)
  if (!player || !data || typeof data !== 'object') return
  const row = data as { equipment?: EquipmentSnapshot }
  if (row.equipment) applyEquipment(player, row.equipment)
}

/** Seed default equipment defs + inventory entries on first boot. */
export function ensureDefaultEquipmentItems(): void {
  for (const def of DEFAULT_EQUIPMENT) registerEquipmentItem(def)
}