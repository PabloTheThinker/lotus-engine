/**
 * Wave 92 (v4.99–v5.03) — RPG inventory lite + gold currency.
 * Godot inventory / UE AttributeSet analog; pairs with GAS-lite Health/Mana on player actors.
 */

import type { Actor } from './Actor'
import { getAttribute, initActorGAS, setAttribute } from './gameplayAbilities'
import {
  applyEquipmentCheckpointExtras,
  buildEquipmentCheckpointExtras,
  initActorEquipment,
} from './rpgEquipment'
import { restoreQuestsFromSavePayload, serializeQuestState } from './rpgQuests'

const ITEM_KEY = 'lotus-engine.rpg-items'
export const DEFAULT_INVENTORY_SLOTS = 20
export const DEFAULT_ATTRIBUTE_SET_ID = 'default'

export interface ItemDef {
  id: string
  name: string
  stackable: boolean
  maxStack: number
}

export interface InventorySlot {
  itemId: string
  quantity: number
}

export interface InventorySnapshot {
  slots: (InventorySlot | null)[]
  gold: number
}

export interface RpgCheckpointExtras {
  inventory?: InventorySnapshot
  attributes?: Record<string, number>
  equipment?: import('./rpgEquipment').EquipmentSnapshot
}

interface ActorInventoryState {
  slotCount: number
  slots: (InventorySlot | null)[]
  gold: number
}

const DEFAULT_ITEMS: ItemDef[] = [
  { id: 'health_potion', name: 'Health Potion', stackable: true, maxStack: 99 },
  { id: 'mana_potion', name: 'Mana Potion', stackable: true, maxStack: 99 },
]

const actorInventories = new WeakMap<Actor, ActorInventoryState>()

function cloneSlots(slots: (InventorySlot | null)[]): (InventorySlot | null)[] {
  return slots.map((s) => (s ? { ...s } : null))
}

export function loadItemLibrary(): ItemDef[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ITEM_KEY) ?? 'null') as ItemDef[] | null
    if (!Array.isArray(raw) || !raw.length) return [...DEFAULT_ITEMS]
    return raw.map((item) => ({
      id: String(item.id),
      name: String(item.name ?? item.id),
      stackable: item.stackable !== false,
      maxStack: Math.max(1, Number(item.maxStack) || 99),
    }))
  } catch {
    return [...DEFAULT_ITEMS]
  }
}

export function saveItemLibrary(items: ItemDef[]): void {
  localStorage.setItem(ITEM_KEY, JSON.stringify(items))
}

export function listItems(): ItemDef[] {
  return loadItemLibrary()
}

export function getItemDef(id: string): ItemDef | undefined {
  const q = id.toLowerCase()
  return listItems().find((item) => item.id.toLowerCase() === q || item.name.toLowerCase() === q)
}

export function registerItem(def: ItemDef): ItemDef {
  const items = loadItemLibrary()
  const normalized: ItemDef = {
    id: String(def.id).trim(),
    name: String(def.name ?? def.id).trim() || String(def.id),
    stackable: def.stackable !== false,
    maxStack: Math.max(1, Number(def.maxStack) || 99),
  }
  const idx = items.findIndex((item) => item.id === normalized.id)
  if (idx >= 0) items[idx] = normalized
  else items.push(normalized)
  saveItemLibrary(items)
  return normalized
}

export function resetRpgInventories(): void {
  // WeakMap entries drop when actors are GC'd; beginPlay creates fresh actors each session.
}

/** Ensure actor has default AttributeSet + GAS runtime for Health/Mana integration. */
export function ensurePlayerRpgActor(actor: Actor | undefined): Actor | null {
  if (!actor) return null
  if (!actor.attributeSetId) actor.attributeSetId = DEFAULT_ATTRIBUTE_SET_ID
  initActorGAS(actor)
  initActorInventory(actor)
  initActorEquipment(actor)
  return actor
}

export function initActorInventory(actor: Actor, slotCount = DEFAULT_INVENTORY_SLOTS): void {
  if (actorInventories.has(actor)) return
  const count = Math.max(1, Math.min(64, Math.floor(slotCount)))
  actorInventories.set(actor, {
    slotCount: count,
    slots: Array.from({ length: count }, () => null),
    gold: 0,
  })
}

function ensureInventory(actor: Actor): ActorInventoryState {
  let state = actorInventories.get(actor)
  if (!state) {
    initActorInventory(actor)
    state = actorInventories.get(actor)!
  }
  return state
}

export function getInventory(actor: Actor): InventorySnapshot {
  const state = ensureInventory(actor)
  return { slots: cloneSlots(state.slots), gold: state.gold }
}

export function applyInventory(actor: Actor, snapshot: InventorySnapshot | undefined): boolean {
  if (!snapshot) return false
  const state = ensureInventory(actor)
  const count = Math.max(state.slotCount, snapshot.slots?.length ?? 0)
  state.slotCount = Math.min(64, count)
  state.slots = Array.from({ length: state.slotCount }, (_, i) => {
    const slot = snapshot.slots?.[i]
    if (!slot?.itemId || slot.quantity <= 0) return null
    const def = getItemDef(slot.itemId)
    if (!def) return null
    const qty = Math.min(def.maxStack, Math.max(0, Math.floor(slot.quantity)))
    return qty > 0 ? { itemId: def.id, quantity: qty } : null
  })
  state.gold = Math.max(0, Math.floor(snapshot.gold ?? 0))
  return true
}

function firstEmptySlot(state: ActorInventoryState): number {
  return state.slots.findIndex((slot) => slot == null)
}

function findStackSlot(state: ActorInventoryState, itemId: string, maxStack: number): number {
  return state.slots.findIndex((slot) => slot?.itemId === itemId && slot.quantity < maxStack)
}

export function addItem(actor: Actor, itemId: string, quantity = 1): boolean {
  const def = getItemDef(itemId)
  if (!def) return false
  let remaining = Math.max(0, Math.floor(quantity))
  if (remaining <= 0) return false

  const state = ensureInventory(actor)
  while (remaining > 0) {
    let slotIdx = def.stackable ? findStackSlot(state, def.id, def.maxStack) : -1
    if (slotIdx < 0) {
      slotIdx = firstEmptySlot(state)
      if (slotIdx < 0) return false
      state.slots[slotIdx] = { itemId: def.id, quantity: 0 }
    }
    const slot = state.slots[slotIdx]!
    const space = def.maxStack - slot.quantity
    const add = def.stackable ? Math.min(space, remaining) : Math.min(1, remaining)
    if (add <= 0) {
      if (!def.stackable) return false
      slotIdx = firstEmptySlot(state)
      if (slotIdx < 0) return false
      state.slots[slotIdx] = { itemId: def.id, quantity: Math.min(def.maxStack, remaining) }
      remaining -= state.slots[slotIdx]!.quantity
      continue
    }
    slot.quantity += add
    remaining -= add
    if (!def.stackable && remaining > 0) {
      slotIdx = firstEmptySlot(state)
      if (slotIdx < 0) return remaining < quantity
      state.slots[slotIdx] = { itemId: def.id, quantity: 1 }
      remaining -= 1
    }
  }
  return true
}

export function removeItem(actor: Actor, itemId: string, quantity = 1): boolean {
  const def = getItemDef(itemId)
  if (!def) return false
  let remaining = Math.max(0, Math.floor(quantity))
  if (remaining <= 0) return false
  if (getItemCount(actor, def.id) < remaining) return false

  const state = ensureInventory(actor)
  for (let i = state.slots.length - 1; i >= 0 && remaining > 0; i--) {
    const slot = state.slots[i]
    if (!slot || slot.itemId !== def.id) continue
    const take = Math.min(slot.quantity, remaining)
    slot.quantity -= take
    remaining -= take
    if (slot.quantity <= 0) state.slots[i] = null
  }
  return remaining === 0
}

export function hasItem(actor: Actor, itemId: string): boolean {
  return getItemCount(actor, itemId) > 0
}

export function getItemCount(actor: Actor, itemId: string): number {
  const def = getItemDef(itemId)
  if (!def) return 0
  const state = actorInventories.get(actor)
  if (!state) return 0
  return state.slots.reduce((sum, slot) => (slot?.itemId === def.id ? sum + slot.quantity : sum), 0)
}

export function getGold(actor: Actor): number {
  return actorInventories.get(actor)?.gold ?? 0
}

export function addGold(actor: Actor, amount: number): number {
  const state = ensureInventory(actor)
  state.gold = Math.max(0, state.gold + Math.floor(amount))
  return state.gold
}

export function setGold(actor: Actor, amount: number): number {
  const state = ensureInventory(actor)
  state.gold = Math.max(0, Math.floor(amount))
  return state.gold
}

/** Consume one potion and apply Health/Mana via GAS-lite when available. */
export function useItem(actor: Actor, itemId: string): boolean {
  const def = getItemDef(itemId)
  if (!def || !hasItem(actor, def.id)) return false
  ensurePlayerRpgActor(actor)
  if (def.id === 'health_potion') {
    const cur = getAttribute(actor, 'Health') ?? 0
    setAttribute(actor, 'Health', Math.min(100, cur + 25))
  } else if (def.id === 'mana_potion') {
    const cur = getAttribute(actor, 'Mana') ?? 0
    setAttribute(actor, 'Mana', Math.min(50, cur + 15))
  }
  return removeItem(actor, def.id, 1)
}

export function getActorHealth(actor: Actor): number | null {
  ensurePlayerRpgActor(actor)
  return getAttribute(actor, 'Health')
}

export function getActorMana(actor: Actor): number | null {
  ensurePlayerRpgActor(actor)
  return getAttribute(actor, 'Mana')
}

export function setActorAttribute(actor: Actor, name: string, value: number): boolean {
  ensurePlayerRpgActor(actor)
  return setAttribute(actor, name, value)
}

export function buildRpgCheckpointExtras(actor: Actor | undefined): RpgCheckpointExtras {
  const player = ensurePlayerRpgActor(actor ?? undefined)
  if (!player) return {}
  const inventory = getInventory(player)
  const attrs = {
    Health: getAttribute(player, 'Health'),
    Mana: getAttribute(player, 'Mana'),
  }
  const attributes: Record<string, number> = {}
  if (attrs.Health != null) attributes.Health = attrs.Health
  if (attrs.Mana != null) attributes.Mana = attrs.Mana
  const equipmentExtras = buildEquipmentCheckpointExtras(player)
  return {
    inventory,
    attributes: Object.keys(attributes).length ? attributes : undefined,
    ...equipmentExtras,
  }
}

export function applyRpgCheckpointExtras(actor: Actor | undefined, data: unknown): void {
  const player = ensurePlayerRpgActor(actor ?? undefined)
  if (!player || !data || typeof data !== 'object') return
  const row = data as RpgCheckpointExtras & { inventory?: InventorySnapshot; attributes?: Record<string, number> }
  if (row.inventory) applyInventory(player, row.inventory)
  if (row.attributes) {
    for (const [name, value] of Object.entries(row.attributes)) {
      if (typeof value === 'number' && Number.isFinite(value)) setAttribute(player, name, value)
    }
  }
  applyEquipmentCheckpointExtras(player, data)
  restoreQuestsFromSavePayload(data)
}

export function mergeRpgIntoCheckpoint(
  base: Record<string, unknown>,
  actor: Actor | undefined,
): Record<string, unknown> {
  const extras = buildRpgCheckpointExtras(actor)
  return { ...base, ...extras, quests: serializeQuestState() }
}