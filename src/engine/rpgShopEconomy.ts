/**
 * Wave 110 (v5.89–v5.93) — Quest-linked shop prices + reputation stub.
 */

import type { Actor } from './Actor'
import { ensurePlayerRpgActor } from './rpgInventory'
import { findListing, getShop, type ShopDef } from './rpgShop'
import { getQuestState } from './rpgQuests'

const REPUTATION_KEY = 'lotus-engine.rpg-reputation'

/** Quest stage → buy price multiplier (1 = full price). */
const QUEST_PRICE_MODIFIERS: Record<string, { questId: string; multiplier: number; itemIds?: string[] }> = {
  find_herbs_herb_discount: {
    questId: 'find_herbs',
    multiplier: 0.75,
    itemIds: ['herb'],
  },
  find_herbs_potion_discount: {
    questId: 'find_herbs',
    multiplier: 0.9,
    itemIds: ['health_potion'],
  },
}

export function getReputation(actor?: Actor): number {
  ensurePlayerRpgActor(actor ?? undefined)
  try {
    const raw = localStorage.getItem(REPUTATION_KEY)
    const n = Number(raw)
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.floor(n))) : 0
  } catch {
    return 0
  }
}

export function setReputation(value: number, _actor?: Actor): number {
  const rep = Math.max(0, Math.min(100, Math.floor(Number(value) || 0)))
  try {
    localStorage.setItem(REPUTATION_KEY, String(rep))
  } catch {
    /* ignore */
  }
  return rep
}

/** Reputation tiers shave up to 10% off listed buy prices. */
export function reputationPriceMultiplier(actor?: Actor): number {
  const rep = getReputation(actor)
  return 1 - rep * 0.001
}

export function questPriceMultiplier(_actor: Actor | undefined, itemId: string): number {
  let mult = 1
  for (const rule of Object.values(QUEST_PRICE_MODIFIERS)) {
    const quest = getQuestState(rule.questId)
    if (!quest || quest.state !== 'active') continue
    if (rule.itemIds && !rule.itemIds.some((id) => id.toLowerCase() === itemId.toLowerCase())) continue
    mult = Math.min(mult, rule.multiplier)
  }
  return mult
}

export function resolveBuyPrice(actor: Actor | undefined, shopId: string, itemId: string): number {
  const shop = getShop(shopId)
  if (!shop) return 0
  const listing = findListing(shop, itemId)
  if (!listing) return 0
  const base = Math.max(1, Math.floor(listing.price))
  const questMult = questPriceMultiplier(actor, itemId)
  const repMult = reputationPriceMultiplier(actor)
  return Math.max(1, Math.floor(base * questMult * repMult))
}

export function resolveSellPrice(actor: Actor | undefined, shop: ShopDef, itemId: string): number {
  const listing = findListing(shop, itemId)
  if (!listing) return 0
  const buy = resolveBuyPrice(actor, shop.id, itemId)
  return Math.max(1, Math.floor(buy * shop.sellRate))
}

export function priceBreakdown(
  actor: Actor | undefined,
  shopId: string,
  itemId: string,
): { base: number; resolved: number; questMult: number; repMult: number } | null {
  const shop = getShop(shopId)
  const listing = findListing(shop ?? { id: '', name: '', listings: [], sellRate: 0.5 }, itemId)
  if (!shop || !listing) return null
  const base = Math.max(1, Math.floor(listing.price))
  const questMult = questPriceMultiplier(actor, itemId)
  const repMult = reputationPriceMultiplier(actor)
  return { base, resolved: resolveBuyPrice(actor, shopId, itemId), questMult, repMult }
}

export function listQuestPriceRules(): typeof QUEST_PRICE_MODIFIERS {
  return { ...QUEST_PRICE_MODIFIERS }
}

export function resetRpgShopEconomy(): void {
  try {
    localStorage.removeItem(REPUTATION_KEY)
  } catch {
    /* ignore */
  }
}