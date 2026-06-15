/**
 * Wave 105 (v5.64–v5.68) — RPG shop / vendor buy-sell on inventory gold.
 */

import type { Actor } from './Actor'
import {
  addGold,
  addItem,
  ensurePlayerRpgActor,
  getGold,
  getItemDef,
  hasItem,
  removeItem,
} from './rpgInventory'
import { registerEquipmentItem } from './rpgEquipment'
import { ensureDefaultCraftingItems } from './rpgCrafting'
import { resolveBuyPrice, resolveSellPrice } from './rpgShopEconomy'

const SHOP_KEY = 'lotus-engine.rpg-shops'

export interface ShopListing {
  itemId: string
  price: number
  stock?: number
}

export interface ShopDef {
  id: string
  name: string
  listings: ShopListing[]
  /** Fraction of buy price paid on sell (0–1). */
  sellRate: number
}

export const DEFAULT_SHOP_ID = 'village_vendor'

const SHOP_DEFS: Record<string, ShopDef> = {
  village_vendor: {
    id: 'village_vendor',
    name: 'Village Vendor',
    sellRate: 0.5,
    listings: [
      { itemId: 'herb', price: 8, stock: 99 },
      { itemId: 'health_potion', price: 25, stock: 12 },
      { itemId: 'iron_sword', price: 80, stock: 1 },
    ],
  },
}

function normalizeListing(row: ShopListing): ShopListing | null {
  const itemId = String(row.itemId ?? '').trim()
  const price = Math.max(0, Math.floor(Number(row.price) || 0))
  if (!itemId || price <= 0) return null
  const stockRaw = row.stock
  const stock = stockRaw == null ? undefined : Math.max(0, Math.floor(Number(stockRaw)))
  return { itemId, price, stock }
}

function normalizeShop(def: ShopDef): ShopDef {
  const id = String(def.id ?? '').trim()
  const listings = (def.listings ?? []).map(normalizeListing).filter((l): l is ShopListing => l != null)
  const sellRate = Math.max(0, Math.min(1, Number(def.sellRate ?? 0.5)))
  return { id, name: String(def.name ?? id).trim() || id, listings, sellRate }
}

export function listShops(): ShopDef[] {
  return Object.values(SHOP_DEFS)
}

export function getShop(id: string): ShopDef | null {
  const q = String(id ?? '').trim()
  return q ? (SHOP_DEFS[q] ?? null) : null
}

export function registerShop(def: ShopDef): ShopDef {
  const shop = normalizeShop(def)
  if (!shop.id) return shop
  SHOP_DEFS[shop.id] = shop
  try {
    localStorage.setItem(SHOP_KEY, JSON.stringify(Object.values(SHOP_DEFS)))
  } catch {
    /* ignore */
  }
  return shop
}

export function findListing(shop: ShopDef, itemId: string): ShopListing | null {
  const q = itemId.toLowerCase()
  return shop.listings.find((l) => l.itemId.toLowerCase() === q) ?? null
}

export function getSellPrice(shop: ShopDef, itemId: string, actor?: Actor): number {
  if (actor) return resolveSellPrice(actor, shop, itemId)
  const listing = findListing(shop, itemId)
  if (!listing) return 0
  return Math.max(1, Math.floor(listing.price * shop.sellRate))
}

export function getBuyPrice(actor: Actor | undefined, shopId: string, itemId: string): number {
  return resolveBuyPrice(actor, shopId, itemId)
}

export function ensureDefaultShops(): void {
  ensureDefaultCraftingItems()
  registerEquipmentItem({
    id: 'iron_sword',
    name: 'Iron Sword',
    slot: 'weapon',
    modifiers: [{ attribute: 'damage', value: 10 }],
  })
  registerEquipmentItem({
    id: 'leather_chest',
    name: 'Leather Chest',
    slot: 'chest',
    modifiers: [{ attribute: 'Health', value: 8 }],
  })
  for (const def of Object.values(SHOP_DEFS)) registerShop(def)
}

export function canBuy(actor: Actor | undefined, shopId: string, itemId: string): boolean {
  ensureDefaultShops()
  const player = ensurePlayerRpgActor(actor ?? undefined)
  const shop = getShop(shopId)
  if (!player || !shop) return false
  const listing = findListing(shop, itemId)
  if (!listing || !getItemDef(listing.itemId)) return false
  if (listing.stock != null && listing.stock <= 0) return false
  return getGold(player) >= resolveBuyPrice(player, shopId, itemId)
}

export function buyItem(actor: Actor | undefined, shopId: string, itemId: string): boolean {
  ensureDefaultShops()
  if (!canBuy(actor, shopId, itemId)) return false
  const player = ensurePlayerRpgActor(actor ?? undefined)!
  const shop = getShop(shopId)!
  const listing = findListing(shop, itemId)!
  const price = resolveBuyPrice(player, shopId, itemId)
  addGold(player, -price)
  if (!addItem(player, listing.itemId, 1)) {
    addGold(player, price)
    return false
  }
  if (listing.stock != null) listing.stock = Math.max(0, listing.stock - 1)
  return true
}

export function canSell(actor: Actor | undefined, shopId: string, itemId: string): boolean {
  ensureDefaultShops()
  const player = ensurePlayerRpgActor(actor ?? undefined)
  const shop = getShop(shopId)
  if (!player || !shop) return false
  if (!hasItem(player, itemId)) return false
  return getSellPrice(shop, itemId) > 0 || findListing(shop, itemId) != null
}

export function sellItem(actor: Actor | undefined, shopId: string, itemId: string): boolean {
  ensureDefaultShops()
  const player = ensurePlayerRpgActor(actor ?? undefined)
  const shop = getShop(shopId)
  if (!player || !shop || !hasItem(player, itemId)) return false
  const payout = resolveSellPrice(player, shop, itemId) || Math.max(1, Math.floor((findListing(shop, itemId)?.price ?? 10) * shop.sellRate))
  if (!removeItem(player, itemId, 1)) return false
  addGold(player, payout)
  return true
}

export function resetRpgShops(): void {
  // Shop defs persist in memory/localStorage.
}