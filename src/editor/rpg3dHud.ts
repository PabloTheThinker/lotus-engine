/** Wave 95 (v5.14–v5.18) — 3D RPG HUD overlay (health, quest tracker, inventory, dialogue).
 *  Wave 97 (v5.24–v5.28) — equipment paper-doll row in inventory panel.
 *  Wave 100 (v5.39–v5.43) — crafting panel toggle (C key).
 *  Wave 106 (v5.69–v5.73) — screen-space damage number floaters (rpgDamageHud).
 *  Wave 107 (v5.74–v5.78) — vendor shop panel on Vendor NPC interact. */

import type { ScriptApi } from '../engine/scripting'
import { RPG3D_MANAGER_NAME } from './rpg3dExportPack'

export const RPG_HUD_OVERLAY_CSS = `
  #lotus-rpg-hud-root {
    position: fixed; inset: 0; z-index: 22; pointer-events: none;
    font: 600 13px system-ui, sans-serif; color: #e8edf4;
  }
  .lotus-rpg-hp-wrap {
    position: absolute; top: 16px; left: 16px; width: 200px;
  }
  .lotus-rpg-hp-label {
    font-size: 11px; letter-spacing: 0.06em; color: #9aa4b2; margin-bottom: 4px;
  }
  .lotus-rpg-hp-bar {
    height: 14px; border-radius: 4px; background: rgba(13,15,18,.72);
    border: 1px solid rgba(255,255,255,.22); overflow: hidden;
  }
  .lotus-rpg-hp-fill {
    height: 100%; border-radius: 3px; background: linear-gradient(90deg, #e5484d, #f76b6b);
    transition: width 0.2s ease-out;
  }
  .lotus-rpg-quest {
    position: absolute; top: 52px; left: 16px; max-width: 280px;
    padding: 8px 12px; border-radius: 8px;
    background: rgba(13,15,18,.78); border: 1px solid rgba(255,255,255,.14);
    font-size: 12px; color: #c8d0d8;
  }
  .lotus-rpg-quest-title {
    font-size: 10px; font-weight: 800; letter-spacing: 0.08em;
    color: #f6d365; margin-bottom: 4px;
  }
  .lotus-rpg-inventory {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    min-width: 240px; padding: 16px 20px; border-radius: 10px;
    background: rgba(13,15,18,.92); border: 1px solid rgba(255,255,255,.16);
    box-shadow: 0 12px 36px rgba(0,0,0,.45); display: none;
    pointer-events: auto;
  }
  .lotus-rpg-inventory.open { display: block; }
  .lotus-rpg-inventory-title {
    font-size: 14px; font-weight: 800; color: #f6d365; margin-bottom: 8px;
  }
  .lotus-rpg-inventory-hint {
    font-size: 11px; color: #79828f; margin-top: 8px;
  }
  .lotus-rpg-equipment {
    display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px;
    margin-bottom: 12px;
  }
  .lotus-rpg-equip-slot {
    min-height: 44px; padding: 4px 6px; border-radius: 6px;
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14);
    text-align: center; font-size: 10px; color: #9aa4b2;
  }
  .lotus-rpg-equip-slot .label {
    display: block; font-weight: 800; letter-spacing: 0.04em;
    text-transform: uppercase; margin-bottom: 2px; color: #79828f;
  }
  .lotus-rpg-equip-slot .item {
    display: block; font-size: 11px; color: #e8edf4; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
  }
  .lotus-rpg-inventory ul {
    margin: 0; padding-left: 18px; font-size: 12px; color: #c8d0d8;
  }
  .lotus-rpg-dialogue {
    position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%);
    width: min(560px, 92vw); padding: 16px 20px; border-radius: 10px;
    background: rgba(13,15,18,.9); border: 1px solid rgba(255,255,255,.16);
    box-shadow: 0 8px 28px rgba(0,0,0,.4); display: none;
    pointer-events: auto;
  }
  .lotus-rpg-dialogue.open { display: block; }
  .lotus-rpg-dialogue-speaker {
    font-size: 11px; font-weight: 800; letter-spacing: 0.06em; color: #f6d365;
    margin-bottom: 6px;
  }
  .lotus-rpg-dialogue-text {
    font-size: 14px; line-height: 1.45; color: #e8edf4;
  }
  .lotus-rpg-dialogue-hint {
    margin-top: 10px; font-size: 11px; color: #79828f;
  }
  .lotus-rpg-crafting {
    position: absolute; top: 50%; right: 24px; transform: translateY(-50%);
    min-width: 260px; padding: 16px 20px; border-radius: 10px;
    background: rgba(13,15,18,.92); border: 1px solid rgba(255,255,255,.16);
    box-shadow: 0 12px 36px rgba(0,0,0,.45); display: none;
    pointer-events: auto;
  }
  .lotus-rpg-crafting.open { display: block; }
  .lotus-rpg-crafting-title {
    font-size: 14px; font-weight: 800; color: #7ec8a4; margin-bottom: 8px;
  }
  .lotus-rpg-crafting-hint {
    font-size: 11px; color: #79828f; margin-top: 8px;
  }
  .lotus-rpg-crafting ul {
    margin: 0; padding-left: 0; list-style: none; font-size: 12px; color: #c8d0d8;
  }
  .lotus-rpg-crafting li {
    padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.08);
  }
  .lotus-rpg-crafting li:last-child { border-bottom: none; }
  .lotus-rpg-crafting .recipe-name {
    font-weight: 700; color: #e8edf4; margin-bottom: 4px;
  }
  .lotus-rpg-crafting .recipe-formula {
    font-size: 11px; color: #9aa4b2;
  }
  .lotus-rpg-crafting .recipe-ready {
    font-size: 10px; font-weight: 800; letter-spacing: 0.06em;
    color: #7ec8a4; margin-top: 4px;
  }
  .lotus-rpg-crafting .recipe-locked {
    font-size: 10px; font-weight: 800; letter-spacing: 0.06em;
    color: #79828f; margin-top: 4px;
  }
  .lotus-rpg-shop {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    min-width: 300px; padding: 16px 20px; border-radius: 10px;
    background: rgba(13,15,18,.94); border: 1px solid rgba(255,255,255,.18);
    box-shadow: 0 12px 36px rgba(0,0,0,.45); display: none;
    pointer-events: auto;
  }
  .lotus-rpg-shop.open { display: block; }
  .lotus-rpg-shop-title {
    font-size: 14px; font-weight: 800; color: #f6d365; margin-bottom: 4px;
  }
  .lotus-rpg-shop-greeting {
    font-size: 12px; color: #9aa4b2; margin-bottom: 10px; line-height: 1.4;
  }
  .lotus-rpg-shop-gold {
    font-size: 11px; font-weight: 700; color: #7ec8a4; margin-bottom: 10px;
  }
  .lotus-rpg-shop ul {
    margin: 0; padding-left: 0; list-style: none; font-size: 12px; color: #c8d0d8;
  }
  .lotus-rpg-shop li {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.08);
  }
  .lotus-rpg-shop li:last-child { border-bottom: none; }
  .lotus-rpg-shop .item-name { font-weight: 700; color: #e8edf4; }
  .lotus-rpg-shop .item-price { color: #f6d365; font-weight: 800; }
  .lotus-rpg-shop-hint {
    font-size: 11px; color: #79828f; margin-top: 10px;
  }
`

const HUD_ROOT_ID = 'lotus-rpg-hud-root'
const INVENTORY_ID = 'lotus-rpg-inventory'
const CRAFTING_ID = 'lotus-rpg-crafting'
const SHOP_ID = 'lotus-rpg-shop'
const DIALOGUE_ID = 'lotus-rpg-dialogue'
const QUEST_ID = 'lotus-rpg-quest-text'
const HP_FILL_ID = 'lotus-rpg-hp-fill'

let hudRoot: HTMLElement | null = null
let wired = false
let hudEnabled = false
let dialogueLines: string[] = []
let dialogueIndex = 0
let dialogueSpeaker = ''

function ensureHudRoot(parent?: HTMLElement): HTMLElement {
  const host = parent ?? document.body
  let root = host.querySelector<HTMLElement>(`#${HUD_ROOT_ID}`)
  if (!root) {
    root = document.createElement('div')
    root.id = HUD_ROOT_ID
    root.innerHTML = `<div class="lotus-rpg-hp-wrap">
      <div class="lotus-rpg-hp-label">HP</div>
      <div class="lotus-rpg-hp-bar"><div class="lotus-rpg-hp-fill" id="${HP_FILL_ID}" style="width:100%"></div></div>
    </div>
    <div class="lotus-rpg-quest" id="lotus-rpg-quest">
      <div class="lotus-rpg-quest-title">QUEST</div>
      <div id="${QUEST_ID}">Talk to the Village Elder</div>
    </div>
    <div class="lotus-rpg-inventory" id="${INVENTORY_ID}">
      <div class="lotus-rpg-inventory-title">Inventory</div>
      <div class="lotus-rpg-equipment" id="lotus-rpg-equipment-row"></div>
      <ul id="lotus-rpg-inventory-list"></ul>
      <div class="lotus-rpg-inventory-hint">Press I to close</div>
    </div>
    <div class="lotus-rpg-crafting" id="${CRAFTING_ID}">
      <div class="lotus-rpg-crafting-title">Crafting</div>
      <ul id="lotus-rpg-crafting-list"></ul>
      <div class="lotus-rpg-crafting-hint">Press C to close · Enter to craft ready recipe</div>
    </div>
    <div class="lotus-rpg-shop" id="${SHOP_ID}">
      <div class="lotus-rpg-shop-title" id="lotus-rpg-shop-title">Shop</div>
      <div class="lotus-rpg-shop-greeting" id="lotus-rpg-shop-greeting"></div>
      <div class="lotus-rpg-shop-gold" id="lotus-rpg-shop-gold">Gold: 0</div>
      <ul id="lotus-rpg-shop-list"></ul>
      <div class="lotus-rpg-shop-hint">Press Esc to close</div>
    </div>
    <div class="lotus-rpg-dialogue" id="${DIALOGUE_ID}">
      <div class="lotus-rpg-dialogue-speaker" id="lotus-rpg-dialogue-speaker"></div>
      <div class="lotus-rpg-dialogue-text" id="lotus-rpg-dialogue-text"></div>
      <div class="lotus-rpg-dialogue-hint">Interact / E — next line</div>
    </div>`
    host.appendChild(root)
  }
  hudRoot = root
  return root
}

function setHpFraction(fraction: number) {
  const fill = document.getElementById(HP_FILL_ID)
  if (fill) fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`
}

function setQuestText(text: string) {
  const el = document.getElementById(QUEST_ID)
  if (el) el.textContent = text
}

const EQUIP_SLOT_LABELS: Record<string, string> = {
  weapon: 'Weapon',
  head: 'Head',
  chest: 'Chest',
  legs: 'Legs',
  accessory: 'Acc',
}

function renderEquipmentRow(equipment: Record<string, string | null> | null) {
  const row = document.getElementById('lotus-rpg-equipment-row')
  if (!row) return
  const slots = ['weapon', 'head', 'chest', 'legs', 'accessory']
  row.innerHTML = slots
    .map((slot) => {
      const label = EQUIP_SLOT_LABELS[slot] ?? slot
      const item = equipment?.[slot]
      const itemLabel = item ? String(item) : '—'
      return `<div class="lotus-rpg-equip-slot" data-slot="${slot}"><span class="label">${label}</span><span class="item">${itemLabel}</span></div>`
    })
    .join('')
}

function renderInventory(items: string[], equipment?: Record<string, string | null> | null) {
  const list = document.getElementById('lotus-rpg-inventory-list')
  const panel = document.getElementById(INVENTORY_ID)
  if (!list || !panel) return
  renderEquipmentRow(equipment ?? null)
  if (!items.length) {
    list.innerHTML = '<li><em>Empty</em></li>'
  } else {
    list.innerHTML = items.map((item) => `<li>${item}</li>`).join('')
  }
}

function showInventory(open: boolean) {
  const panel = document.getElementById(INVENTORY_ID)
  if (panel) panel.classList.toggle('open', open)
}

export interface CraftingRecipeRow {
  id: string
  name: string
  inputs: string
  output: string
  canCraft: boolean
}

function renderCrafting(recipes: CraftingRecipeRow[]) {
  const list = document.getElementById('lotus-rpg-crafting-list')
  const panel = document.getElementById(CRAFTING_ID)
  if (!list || !panel) return
  if (!recipes.length) {
    list.innerHTML = '<li><em>No recipes</em></li>'
    return
  }
  list.innerHTML = recipes
    .map(
      (recipe) => `<li>
        <div class="recipe-name">${recipe.name}</div>
        <div class="recipe-formula">${recipe.inputs} → ${recipe.output}</div>
        <div class="${recipe.canCraft ? 'recipe-ready' : 'recipe-locked'}">${recipe.canCraft ? 'READY' : 'NEED MATERIALS'}</div>
      </li>`,
    )
    .join('')
}

function showCrafting(open: boolean) {
  const panel = document.getElementById(CRAFTING_ID)
  if (panel) panel.classList.toggle('open', open)
}

export interface ShopListingRow {
  itemId: string
  name: string
  price: number
  canAfford: boolean
}

function renderShop(
  vendorName: string,
  greeting: string,
  gold: number,
  listings: ShopListingRow[],
) {
  const title = document.getElementById('lotus-rpg-shop-title')
  const greet = document.getElementById('lotus-rpg-shop-greeting')
  const goldEl = document.getElementById('lotus-rpg-shop-gold')
  const list = document.getElementById('lotus-rpg-shop-list')
  if (!title || !greet || !goldEl || !list) return
  title.textContent = vendorName
  greet.textContent = greeting
  goldEl.textContent = `Gold: ${gold}`
  if (!listings.length) {
    list.innerHTML = '<li><em>No items</em></li>'
    return
  }
  list.innerHTML = listings
    .map(
      (row) => `<li>
        <span class="item-name">${row.name}</span>
        <span class="item-price">${row.canAfford ? '' : '✗ '}${row.price}g</span>
      </li>`,
    )
    .join('')
}

function showShop(open: boolean) {
  const panel = document.getElementById(SHOP_ID)
  if (panel) panel.classList.toggle('open', open)
}

function onShopToggle(payload: unknown) {
  const row = Array.isArray(payload) ? payload : []
  const open = row[0] === true
  const vendorName = String(row[1] ?? 'Shop')
  const greeting = String(row[2] ?? '')
  const gold = Math.max(0, Math.floor(Number(row[3]) || 0))
  const listings = Array.isArray(row[4])
    ? row[4].map((entry) => {
        const r = entry as ShopListingRow
        return {
          itemId: String(r.itemId ?? ''),
          name: String(r.name ?? r.itemId ?? ''),
          price: Math.max(0, Math.floor(Number(r.price) || 0)),
          canAfford: r.canAfford === true,
        }
      })
    : []
  renderShop(vendorName, greeting, gold, listings)
  showShop(open)
}

function showDialogueLine() {
  const panel = document.getElementById(DIALOGUE_ID)
  const speakerEl = document.getElementById('lotus-rpg-dialogue-speaker')
  const textEl = document.getElementById('lotus-rpg-dialogue-text')
  if (!panel || !speakerEl || !textEl) return
  if (dialogueIndex >= dialogueLines.length) {
    panel.classList.remove('open')
    dialogueLines = []
    dialogueIndex = 0
    return
  }
  speakerEl.textContent = dialogueSpeaker
  textEl.textContent = dialogueLines[dialogueIndex]
  panel.classList.add('open')
}

function onDialogueStart(payload: unknown) {
  const row = Array.isArray(payload) ? payload : []
  const id = String(row[0] ?? '')
  const lines = Array.isArray(row[1]) ? row[1].map((l) => String(l)) : []
  dialogueSpeaker = id === 'village_elder' ? 'Village Elder' : id
  dialogueLines = lines
  dialogueIndex = 0
  showDialogueLine()
}

function onDialogueAdvance() {
  if (!dialogueLines.length) return
  dialogueIndex++
  showDialogueLine()
}

function onInventoryToggle(payload: unknown) {
  const row = Array.isArray(payload) ? payload : []
  const open = row[0] === true
  const items = Array.isArray(row[1]) ? row[1].map((i) => String(i)) : []
  const equipment =
    row[2] && typeof row[2] === 'object' && !Array.isArray(row[2])
      ? (row[2] as Record<string, string | null>)
      : null
  renderInventory(items, equipment)
  showInventory(open)
}

function onCraftingToggle(payload: unknown) {
  const row = Array.isArray(payload) ? payload : []
  const open = row[0] === true
  const recipes = Array.isArray(row[1])
    ? row[1].map((entry) => {
        const r = entry as CraftingRecipeRow
        return {
          id: String(r.id ?? ''),
          name: String(r.name ?? r.id ?? ''),
          inputs: String(r.inputs ?? ''),
          output: String(r.output ?? ''),
          canCraft: r.canCraft === true,
        }
      })
    : []
  renderCrafting(recipes)
  showCrafting(open)
}

function onQuestUpdate(payload: unknown) {
  const text = typeof payload === 'string' ? payload : String((payload as { text?: string })?.text ?? '')
  if (text) setQuestText(text)
}

function onHpUpdate(payload: unknown) {
  const frac = typeof payload === 'number' ? payload : Number((payload as { fraction?: number })?.fraction ?? 1)
  if (Number.isFinite(frac)) setHpFraction(frac)
}

/** Wire RPG HUD DOM overlay to script signals during PIE. */
export function wireRpg3dHud(api: Pick<ScriptApi, 'on' | 'actionJustPressed'>) {
  if (wired) return
  wired = true
  ensureHudRoot()
  api.on('rpg_hud_ready', () => setHpFraction(1))
  api.on('dialogue_start', onDialogueStart)
  api.on('dialogue_advance', onDialogueAdvance)
  api.on('inventory_toggle', onInventoryToggle)
  api.on('crafting_toggle', onCraftingToggle)
  api.on('shop_toggle', onShopToggle)
  api.on('quest_update', onQuestUpdate)
  api.on('hp_update', onHpUpdate)
  api.on('quest_complete', () => setQuestText('Quest complete: Herbs delivered!'))
  api.on('dialogue_advance', onDialogueAdvance)
}

export function unwireRpg3dHud() {
  wired = false
  hudRoot?.remove()
  hudRoot = null
  dialogueLines = []
  dialogueIndex = 0
}

export function hasRpg3dManager(actors: Iterable<{ name: string }>): boolean {
  for (const a of actors) {
    if (a.name === RPG3D_MANAGER_NAME) return true
  }
  return false
}

export function enableRpg3dHud() {
  hudEnabled = true
}

export function isRpg3dHudEnabled() {
  return hudEnabled
}

export function resetRpg3dHudState() {
  hudEnabled = false
}

export function mountRpg3dHudForPlay(parent: HTMLElement, api: Pick<ScriptApi, 'on' | 'actionJustPressed'>) {
  ensureHudRoot(parent)
  wireRpg3dHud(api)
}

export function unmountRpg3dHudForPlay() {
  unwireRpg3dHud()
  resetRpg3dHudState()
}

/** Editor / smoke-test helper — mount inventory panel with optional equipment row. */
export function previewRpg3dInventory(
  open: boolean,
  items: string[],
  equipment?: Record<string, string | null> | null,
  parent?: HTMLElement,
) {
  ensureHudRoot(parent)
  renderInventory(items, equipment ?? null)
  showInventory(open)
}

/** Editor / smoke-test helper — mount crafting panel with recipe rows. */
export function previewRpg3dCrafting(
  open: boolean,
  recipes: CraftingRecipeRow[],
  parent?: HTMLElement,
) {
  ensureHudRoot(parent)
  renderCrafting(recipes)
  showCrafting(open)
}

/** Editor / smoke-test helper — mount vendor shop panel. */
export function previewRpg3dShop(
  open: boolean,
  vendorName: string,
  greeting: string,
  gold: number,
  listings: ShopListingRow[],
  parent?: HTMLElement,
) {
  ensureHudRoot(parent)
  renderShop(vendorName, greeting, gold, listings)
  showShop(open)
}

/** Advance dialogue on Interact while panel is open (called from play loop). */
export function tickRpg3dDialogue(api: Pick<ScriptApi, 'actionJustPressed' | 'emit'>) {
  const panel = document.getElementById(DIALOGUE_ID)
  if (!panel?.classList.contains('open')) return
  if (api.actionJustPressed('Interact')) {
    dialogueIndex++
    if (dialogueIndex >= dialogueLines.length) {
      panel.classList.remove('open')
      dialogueLines = []
      dialogueIndex = 0
      api.emit('dialogue_end')
    } else {
      showDialogueLine()
    }
  }
}