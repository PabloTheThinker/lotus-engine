/** Wave 80 (v4.39–v4.43) — in-export / PIE pause menu for save/load slots. */

import { isTypingTarget } from './shortcuts'

export const SAVE_MENU_SLOTS = ['slot1', 'slot2', 'slot3'] as const
export type SaveMenuSlot = (typeof SAVE_MENU_SLOTS)[number]

/** Pause overlay CSS — shared by editor PIE and export HTML. */
export const SAVE_MENU_OVERLAY_CSS = `
  .lotus-save-menu-overlay {
    position: fixed; inset: 0; z-index: 45;
    display: none; align-items: center; justify-content: center;
    background: rgba(13, 15, 18, 0.72);
    font: 600 14px system-ui, sans-serif; color: #e8edf4;
    pointer-events: auto;
    animation: lotus-save-menu-in 0.22s ease-out;
  }
  .lotus-save-menu-panel {
    min-width: min(360px, 92vw);
    padding: 24px 28px 20px;
    border-radius: 12px;
    background: rgba(18, 21, 28, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
  }
  .lotus-save-menu-title {
    font-size: 22px; letter-spacing: 0.06em; text-align: center;
    margin-bottom: 4px;
  }
  .lotus-save-menu-sub {
    text-align: center; font-size: 12px; font-weight: 500; color: #9aa4b2;
    margin-bottom: 18px;
  }
  .lotus-save-menu-row {
    display: grid; grid-template-columns: 1fr auto auto;
    gap: 8px; align-items: center;
    margin-bottom: 10px;
  }
  .lotus-save-menu-slot-label {
    font-size: 13px; color: #c8d0d8;
  }
  .lotus-save-menu-slot-hint {
    grid-column: 1 / -1;
    font-size: 11px; font-weight: 500; color: #6b7585;
    margin-top: -6px; margin-bottom: 2px;
  }
  .lotus-save-menu-btn {
    padding: 7px 14px; border: none; border-radius: 6px;
    font: inherit; cursor: pointer; color: #fff;
  }
  .lotus-save-menu-btn-save { background: #2f80ed; }
  .lotus-save-menu-btn-save:active { background: #2568c7; }
  .lotus-save-menu-btn-load { background: #3d4450; }
  .lotus-save-menu-btn-load:disabled { opacity: 0.45; cursor: default; }
  .lotus-save-menu-btn-load:not(:disabled):active { background: #525a68; }
  .lotus-save-menu-resume {
    width: 100%; margin-top: 12px; padding: 10px 16px;
    border: none; border-radius: 8px;
    background: rgba(255, 255, 255, 0.08); color: #e8edf4;
    font: inherit; cursor: pointer;
  }
  .lotus-save-menu-resume:hover { background: rgba(255, 255, 255, 0.12); }
  @keyframes lotus-save-menu-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
`

export interface SaveMenuHandlers {
  getCheckpointData: () => unknown
  onLoadCheckpoint?: (data: unknown) => void
  saveSlot: (slot: string, data: unknown) => boolean
  loadSlot: (slot: string) => unknown | null
  listSlots?: () => string[]
}

let overlayEl: HTMLElement | null = null
let menuPaused = false
let keyHandler: ((e: KeyboardEvent) => void) | null = null
let handlers: SaveMenuHandlers | null = null
let menuEnabled = false
let mountParent: HTMLElement | null = null

export function isSaveMenuPaused(): boolean {
  return menuPaused
}

function slotDisplayName(slot: string): string {
  const n = slot.replace(/^slot/, '')
  return `Save Slot ${n}`
}

function ensureSaveMenuStyles(): void {
  if (document.getElementById('lotus-save-menu-style')) return
  const style = document.createElement('style')
  style.id = 'lotus-save-menu-style'
  style.textContent = SAVE_MENU_OVERLAY_CSS
  document.head.appendChild(style)
}

function refreshSlotHints(): void {
  if (!overlayEl || !handlers?.listSlots) return
  const filled = new Set(handlers.listSlots())
  for (const slot of SAVE_MENU_SLOTS) {
    const hint = overlayEl.querySelector<HTMLElement>(`[data-slot-hint="${slot}"]`)
    const loadBtn = overlayEl.querySelector<HTMLButtonElement>(`[data-slot-load="${slot}"]`)
    const has = filled.has(slot)
    if (hint) hint.textContent = has ? 'Saved data available' : 'Empty'
    if (loadBtn) loadBtn.disabled = !has
  }
}

function wireMenuButtons(root: HTMLElement): void {
  for (const slot of SAVE_MENU_SLOTS) {
    const saveBtn = root.querySelector<HTMLButtonElement>(`[data-slot-save="${slot}"]`)
    const loadBtn = root.querySelector<HTMLButtonElement>(`[data-slot-load="${slot}"]`)
    saveBtn?.addEventListener('click', (e) => {
      e.preventDefault()
      if (!handlers) return
      const data = handlers.getCheckpointData()
      handlers.saveSlot(slot, data)
      refreshSlotHints()
    })
    loadBtn?.addEventListener('click', (e) => {
      e.preventDefault()
      if (!handlers) return
      const data = handlers.loadSlot(slot)
      if (data == null) return
      handlers.onLoadCheckpoint?.(data)
      hideSaveMenu()
    })
  }
  root.querySelector<HTMLButtonElement>('[data-save-menu-resume]')?.addEventListener('click', (e) => {
    e.preventDefault()
    hideSaveMenu()
  })
}

function buildMenuDOM(): HTMLElement {
  const root = document.createElement('div')
  root.id = 'lotus-save-menu'
  root.className = 'lotus-save-menu-overlay'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', 'Pause — Save / Load')

  const rows = SAVE_MENU_SLOTS.map((slot) => {
    const label = slotDisplayName(slot)
    return `<div class="lotus-save-menu-row">
      <span class="lotus-save-menu-slot-label">${label}</span>
      <button type="button" class="lotus-save-menu-btn lotus-save-menu-btn-save" data-slot-save="${slot}">Save</button>
      <button type="button" class="lotus-save-menu-btn lotus-save-menu-btn-load" data-slot-load="${slot}" disabled>Load</button>
      <div class="lotus-save-menu-slot-hint" data-slot-hint="${slot}">Empty</div>
    </div>`
  }).join('')

  root.innerHTML = `<div class="lotus-save-menu-panel">
    <div class="lotus-save-menu-title">PAUSED</div>
    <div class="lotus-save-menu-sub">Escape to resume · Save or load a checkpoint</div>
    ${rows}
    <button type="button" class="lotus-save-menu-resume" data-save-menu-resume>Resume</button>
  </div>`
  wireMenuButtons(root)
  return root
}

/** Show the pause save menu and freeze gameplay (PIE / export). */
export function showSaveMenu(parent?: HTMLElement): void {
  if (!menuEnabled) return
  const host = parent ?? mountParent ?? document.body
  if (!overlayEl) {
    overlayEl = buildMenuDOM()
    host.appendChild(overlayEl)
  } else if (!overlayEl.parentElement) {
    host.appendChild(overlayEl)
  }
  overlayEl.style.display = 'flex'
  menuPaused = true
  refreshSlotHints()
  if (document.pointerLockElement) void document.exitPointerLock()
}

/** Hide the pause save menu and resume gameplay. */
export function hideSaveMenu(): void {
  if (overlayEl) overlayEl.style.display = 'none'
  menuPaused = false
}

/** Toggle pause save menu visibility. */
export function toggleSaveMenu(parent?: HTMLElement): void {
  if (menuPaused) hideSaveMenu()
  else showSaveMenu(parent)
}

/** Escape toggles the menu when saves are enabled. */
export function wireSaveMenuEscape(enabled: boolean): void {
  if (keyHandler) {
    window.removeEventListener('keydown', keyHandler)
    keyHandler = null
  }
  if (!enabled) return
  keyHandler = (e: KeyboardEvent) => {
    if (e.code !== 'Escape' || !menuEnabled) return
    if (isTypingTarget(e.target)) return
    e.preventDefault()
    e.stopPropagation()
    toggleSaveMenu()
  }
  window.addEventListener('keydown', keyHandler, true)
}

/** Mount save menu handlers for PIE or export runtime. */
export function mountExportSaveMenu(opts: {
  parent?: HTMLElement
  enabled: boolean
  handlers: SaveMenuHandlers
}): void {
  unmountExportSaveMenu()
  if (!opts.enabled) return
  menuEnabled = true
  mountParent = opts.parent ?? null
  handlers = opts.handlers
  ensureSaveMenuStyles()
  wireSaveMenuEscape(true)
}

/** Tear down save menu overlay and listeners. */
export function unmountExportSaveMenu(): void {
  hideSaveMenu()
  overlayEl?.remove()
  overlayEl = null
  wireSaveMenuEscape(false)
  handlers = null
  menuEnabled = false
  mountParent = null
}