/**
 * Wave 100 (v5.39–v5.43) — Loot tables per enemy tag; rollLoot on enemy defeat.
 * Auto-adds rolled drops to the player inventory (gold + items).
 */

import type { Actor } from './Actor'
import { addGold, addItem, ensurePlayerRpgActor } from './rpgInventory'
import { listResources, saveResource } from './resources'

const COMBAT_TAG_ENEMY = 'Enemy'
const COMBAT_TAG_PLAYER = 'Player'
import { ensureDefaultCraftingItems } from './rpgCrafting'

const LOOT_KEY = 'lotus-engine.rpg-loot'

export type LootEntryType = 'item' | 'gold'

export interface LootEntry {
  type: LootEntryType
  itemId?: string
  /** Fixed quantity for items, or min gold when min/max omitted */
  quantity?: number
  min?: number
  max?: number
  /** 0–1 drop chance */
  chance: number
}

export interface LootTableDef {
  id: string
  name: string
  entries: LootEntry[]
}

export interface LootDropResult {
  type: LootEntryType
  itemId?: string
  quantity: number
}

/** Enemy gameplay tag → loot table id */
export const LOOT_TAG_MAP: Record<string, string> = {
  Goblin: 'goblin',
  Enemy: 'enemy_default',
}

export const LOOT_TABLE_DEFS: Record<string, LootTableDef> = {
  goblin: {
    id: 'goblin',
    name: 'Goblin Drops',
    entries: [
      { type: 'gold', min: 5, max: 15, chance: 1 },
      { type: 'item', itemId: 'herb', quantity: 1, chance: 0.75 },
    ],
  },
  enemy_default: {
    id: 'enemy_default',
    name: 'Enemy Drops',
    entries: [{ type: 'gold', min: 1, max: 5, chance: 0.5 }],
  },
}

let lootRecipientResolver: () => Actor | null = () => null

export function setLootRecipientResolver(fn: () => Actor | null): void {
  lootRecipientResolver = fn
}

function actorHasTag(actor: Actor, tag: string): boolean {
  const q = tag.toLowerCase()
  return actor.tags.some((t) => {
    const tl = t.toLowerCase()
    return tl === q || tl.startsWith(q + '.')
  })
}

function normalizeEntry(row: LootEntry): LootEntry | null {
  const type = row.type === 'gold' ? 'gold' : 'item'
  const chance = Math.max(0, Math.min(1, Number(row.chance) ?? 1))
  if (type === 'gold') {
    const min = Math.max(0, Math.floor(Number(row.min ?? row.quantity ?? 1)))
    const max = Math.max(min, Math.floor(Number(row.max ?? row.quantity ?? min)))
    return { type: 'gold', min, max, chance }
  }
  const itemId = String(row.itemId ?? '').trim()
  if (!itemId) return null
  const quantity = Math.max(1, Math.floor(Number(row.quantity) || 1))
  return { type: 'item', itemId, quantity, chance }
}

function normalizeLootTable(def: LootTableDef): LootTableDef {
  const id = String(def.id ?? '').trim()
  const entries = (def.entries ?? []).map(normalizeEntry).filter((e): e is LootEntry => e != null)
  return { id, name: String(def.name ?? id).trim() || id, entries }
}

export function listLootTables(): LootTableDef[] {
  return Object.values(LOOT_TABLE_DEFS)
}

export function findLootTable(id: string): LootTableDef | null {
  const q = String(id ?? '').trim()
  return q ? (LOOT_TABLE_DEFS[q] ?? null) : null
}

export function registerLootTable(def: LootTableDef): LootTableDef {
  const normalized = normalizeLootTable(def)
  if (!normalized.id) return normalized
  LOOT_TABLE_DEFS[normalized.id] = normalized
  try {
    localStorage.setItem(LOOT_KEY, JSON.stringify(Object.values(LOOT_TABLE_DEFS)))
  } catch {
    /* ignore */
  }
  return normalized
}

export function saveLootTableResource(def: LootTableDef) {
  const table = registerLootTable(def)
  return saveResource({
    id: `loot_${table.id}`,
    name: table.name,
    kind: 'loot_table',
    data: table as unknown as Record<string, unknown>,
  })
}

export function loadLootTablesFromResources(): LootTableDef[] {
  const loaded: LootTableDef[] = []
  for (const res of listResources('loot_table')) {
    const data = res.data as Partial<LootTableDef>
    if (!data?.id && !res.name) continue
    const table = registerLootTable({
      id: String(data.id ?? res.name),
      name: String(data.name ?? res.name),
      entries: Array.isArray(data.entries) ? (data.entries as LootEntry[]) : [],
    })
    loaded.push(table)
  }
  return loaded
}

export function ensureDefaultLootTables(): void {
  ensureDefaultCraftingItems()
  for (const def of Object.values(LOOT_TABLE_DEFS)) registerLootTable(def)
  loadLootTablesFromResources()
}

/** Resolve loot table id from enemy actor tags (most specific tag wins). */
export function resolveLootTableForActor(actor: Actor): string | null {
  if (!actorHasTag(actor, COMBAT_TAG_ENEMY)) return null
  const defaultTable = LOOT_TAG_MAP.Enemy
  let fallback: string | null =
    defaultTable && findLootTable(defaultTable) ? defaultTable : null
  for (const tag of actor.tags) {
    const direct = LOOT_TAG_MAP[tag]
    if (direct && direct !== defaultTable && findLootTable(direct)) return direct
    const base = tag.split('.')[0]
    const mapped = LOOT_TAG_MAP[base]
    if (mapped && mapped !== defaultTable && findLootTable(mapped)) return mapped
  }
  return fallback
}

function rollQuantity(entry: LootEntry): number {
  if (entry.type === 'item') return Math.max(1, Math.floor(Number(entry.quantity) || 1))
  const min = Math.max(0, Math.floor(Number(entry.min ?? entry.quantity ?? 1)))
  const max = Math.max(min, Math.floor(Number(entry.max ?? entry.quantity ?? min)))
  if (min === max) return min
  return min + Math.floor(Math.random() * (max - min + 1))
}

function rollEntry(entry: LootEntry): LootDropResult | null {
  if (Math.random() >= Math.max(0, Math.min(1, entry.chance))) return null
  const quantity = rollQuantity(entry)
  if (quantity <= 0) return null
  if (entry.type === 'gold') return { type: 'gold', quantity }
  const itemId = String(entry.itemId ?? '').trim()
  if (!itemId) return null
  return { type: 'item', itemId, quantity }
}

/** Roll a loot table and apply drops to the given player actor. */
export function rollLoot(tableId: string, player?: Actor | null): LootDropResult[] {
  const table = findLootTable(tableId)
  const recipient = ensurePlayerRpgActor(player ?? lootRecipientResolver() ?? undefined)
  if (!table || !recipient) return []

  const drops: LootDropResult[] = []
  for (const entry of table.entries) {
    const rolled = rollEntry(entry)
    if (!rolled) continue
    if (rolled.type === 'gold') {
      addGold(recipient, rolled.quantity)
      drops.push(rolled)
    } else if (rolled.itemId && addItem(recipient, rolled.itemId, rolled.quantity)) {
      drops.push(rolled)
    }
  }
  return drops
}

/** Called from rpgCombat when an Enemy-tagged actor dies. */
export function handleEnemyDefeat(victim: Actor, killer?: Actor): LootDropResult[] {
  const tableId = resolveLootTableForActor(victim)
  if (!tableId) return []
  const recipient =
    killer && actorHasTag(killer, COMBAT_TAG_PLAYER)
      ? ensurePlayerRpgActor(killer)
      : ensurePlayerRpgActor(lootRecipientResolver() ?? undefined)
  if (!recipient) return []
  return rollLoot(tableId, recipient)
}

export function resetRpgLoot(): void {
  // Loot table defs persist; recipient resolver re-set each beginPlay.
}