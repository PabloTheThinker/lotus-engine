/**
 * Wave 100 (v5.39–v5.43) — Crafting recipes lite (.tres resource sync optional).
 * Recipe defs: inputs[], output itemId + qty; canCraft / craft consumes inventory.
 */

import type { Actor } from './Actor'
import { getItemCount, registerItem, removeItem, addItem } from './rpgInventory'
import { listResources, saveResource } from './resources'

const RECIPE_KEY = 'lotus-engine.rpg-recipes'

export interface RecipeInput {
  itemId: string
  quantity: number
}

export interface RecipeOutput {
  itemId: string
  quantity: number
}

export interface RecipeDef {
  id: string
  name: string
  inputs: RecipeInput[]
  output: RecipeOutput
}

/** Built-in recipe catalog — extend via registerRecipeDef or .tres resources. */
export const RECIPE_DEFS: Record<string, RecipeDef> = {
  health_potion: {
    id: 'health_potion',
    name: 'Health Potion',
    inputs: [{ itemId: 'herb', quantity: 2 }],
    output: { itemId: 'health_potion', quantity: 1 },
  },
  mana_potion: {
    id: 'mana_potion',
    name: 'Mana Potion',
    inputs: [{ itemId: 'herb', quantity: 3 }],
    output: { itemId: 'mana_potion', quantity: 1 },
  },
}

function normalizeInput(row: RecipeInput): RecipeInput | null {
  const itemId = String(row.itemId ?? '').trim()
  const quantity = Math.max(1, Math.floor(Number(row.quantity) || 1))
  if (!itemId) return null
  return { itemId, quantity }
}

function normalizeRecipe(def: RecipeDef): RecipeDef {
  const id = String(def.id ?? '').trim()
  const inputs = (def.inputs ?? []).map(normalizeInput).filter((r): r is RecipeInput => r != null)
  const out = def.output ?? { itemId: id, quantity: 1 }
  const output: RecipeOutput = {
    itemId: String(out.itemId ?? id).trim() || id,
    quantity: Math.max(1, Math.floor(Number(out.quantity) || 1)),
  }
  return {
    id,
    name: String(def.name ?? id).trim() || id,
    inputs,
    output,
  }
}

export function listRecipes(): RecipeDef[] {
  return Object.values(RECIPE_DEFS)
}

export function findRecipe(id: string): RecipeDef | null {
  const q = String(id ?? '').trim()
  return q ? (RECIPE_DEFS[q] ?? null) : null
}

export function registerRecipeDef(def: RecipeDef): RecipeDef {
  const normalized = normalizeRecipe(def)
  if (!normalized.id) return normalized
  RECIPE_DEFS[normalized.id] = normalized
  try {
    localStorage.setItem(RECIPE_KEY, JSON.stringify(Object.values(RECIPE_DEFS)))
  } catch {
    /* ignore quota */
  }
  return normalized
}

/** Persist a recipe as a .tres-like resource (kind: recipe). */
export function saveRecipeResource(def: RecipeDef) {
  const recipe = registerRecipeDef(def)
  return saveResource({
    id: `recipe_${recipe.id}`,
    name: recipe.name,
    kind: 'recipe',
    data: recipe as unknown as Record<string, unknown>,
  })
}

export function loadRecipesFromResources(): RecipeDef[] {
  const loaded: RecipeDef[] = []
  for (const res of listResources('recipe')) {
    const data = res.data as Partial<RecipeDef>
    if (!data?.id && !res.name) continue
    const recipe = registerRecipeDef({
      id: String(data.id ?? res.name),
      name: String(data.name ?? res.name),
      inputs: Array.isArray(data.inputs) ? (data.inputs as RecipeInput[]) : [],
      output: (data.output as RecipeOutput) ?? { itemId: String(data.id ?? res.name), quantity: 1 },
    })
    loaded.push(recipe)
  }
  return loaded
}

export function ensureDefaultCraftingItems(): void {
  registerItem({ id: 'herb', name: 'Herb', stackable: true, maxStack: 99 })
  registerItem({ id: 'health_potion', name: 'Health Potion', stackable: true, maxStack: 99 })
  registerItem({ id: 'mana_potion', name: 'Mana Potion', stackable: true, maxStack: 99 })
  for (const def of Object.values(RECIPE_DEFS)) registerRecipeDef(def)
  loadRecipesFromResources()
}

export function canCraft(actor: Actor, recipeId: string): boolean {
  const recipe = findRecipe(recipeId)
  if (!recipe || !recipe.inputs.length) return false
  return recipe.inputs.every((input) => getItemCount(actor, input.itemId) >= input.quantity)
}

export function craft(actor: Actor, recipeId: string): boolean {
  const recipe = findRecipe(recipeId)
  if (!recipe || !canCraft(actor, recipeId)) return false
  for (const input of recipe.inputs) {
    if (!removeItem(actor, input.itemId, input.quantity)) return false
  }
  return addItem(actor, recipe.output.itemId, recipe.output.quantity)
}

export function resetRpgCrafting(): void {
  // Recipe defs persist in RECIPE_DEFS / localStorage across sessions.
}