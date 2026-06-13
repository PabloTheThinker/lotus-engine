/**
 * Editor keyboard shortcuts — UE Editor Preferences pattern.
 * Defaults + per-user overrides in localStorage (`vektra-engine.shortcuts`).
 */

export type ShortcutCategory = 'Viewport' | 'Play' | 'Tools' | 'Panels'

export interface ShortcutBinding {
  code: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

export interface ShortcutDef {
  id: string
  label: string
  category: ShortcutCategory
  description?: string
  defaultBinding: ShortcutBinding
}

const STORAGE_KEY = 'vektra-engine.shortcuts'

export const SHORTCUT_REGISTRY: ShortcutDef[] = [
  // Viewport — transform tools
  { id: 'gizmo.select', label: 'Select Tool', category: 'Viewport', defaultBinding: { code: 'KeyQ' } },
  { id: 'gizmo.translate', label: 'Move Tool', category: 'Viewport', defaultBinding: { code: 'KeyW' } },
  { id: 'gizmo.rotate', label: 'Rotate Tool', category: 'Viewport', defaultBinding: { code: 'KeyE' } },
  { id: 'gizmo.scale', label: 'Scale Tool', category: 'Viewport', defaultBinding: { code: 'KeyR' } },
  { id: 'gizmo.cycle', label: 'Cycle Transform Tool', category: 'Viewport', defaultBinding: { code: 'Space' } },
  { id: 'gizmo.space', label: 'Toggle Gizmo Space', category: 'Viewport', defaultBinding: { code: 'KeyT' } },
  { id: 'gizmo.spaceCtrl', label: 'Toggle Gizmo Space (modifier)', category: 'Viewport', defaultBinding: { code: 'Backquote', ctrl: true } },
  { id: 'viewport.focus', label: 'Focus Selection', category: 'Viewport', defaultBinding: { code: 'KeyF' } },
  { id: 'viewport.gameView', label: 'Toggle Game View', category: 'Viewport', defaultBinding: { code: 'KeyG' } },
  { id: 'viewport.deselect', label: 'Clear Selection', category: 'Viewport', defaultBinding: { code: 'Escape' } },
  { id: 'viewport.delete', label: 'Delete Selected', category: 'Viewport', defaultBinding: { code: 'Delete' } },
  { id: 'viewport.snapFloor', label: 'Snap to Floor', category: 'Viewport', defaultBinding: { code: 'End' } },
  { id: 'viewport.fullscreen', label: 'Toggle Fullscreen', category: 'Viewport', defaultBinding: { code: 'F11' } },
  { id: 'viewport.duplicate', label: 'Duplicate Selection', category: 'Viewport', defaultBinding: { code: 'KeyD', ctrl: true } },

  // Play
  { id: 'play.pie', label: 'Play In Editor', category: 'Play', defaultBinding: { code: 'KeyP', alt: true } },
  { id: 'play.stop', label: 'Stop Play / Simulate', category: 'Play', defaultBinding: { code: 'Escape' } },
  { id: 'play.eject', label: 'Eject (PIE)', category: 'Play', defaultBinding: { code: 'F8' } },
  { id: 'play.keepChanges', label: 'Keep Simulation Changes', category: 'Play', defaultBinding: { code: 'KeyK' } },

  // Tools
  { id: 'tools.save', label: 'Save Level', category: 'Tools', defaultBinding: { code: 'KeyS', ctrl: true } },
  { id: 'tools.undo', label: 'Undo', category: 'Tools', defaultBinding: { code: 'KeyZ', ctrl: true } },
  { id: 'tools.redo', label: 'Redo', category: 'Tools', defaultBinding: { code: 'KeyY', ctrl: true } },
  { id: 'tools.redoAlt', label: 'Redo (alternate)', category: 'Tools', defaultBinding: { code: 'KeyZ', ctrl: true, shift: true } },

  // Panels
  { id: 'panels.contentDrawer', label: 'Content Drawer', category: 'Panels', defaultBinding: { code: 'Space', ctrl: true } },
  { id: 'panels.commandPalette', label: 'Command Palette', category: 'Panels', defaultBinding: { code: 'KeyP', ctrl: true, shift: true } },
  { id: 'panels.console', label: 'Open Console', category: 'Panels', defaultBinding: { code: 'Backquote' } },
]

const registryById = new Map(SHORTCUT_REGISTRY.map((s) => [s.id, s]))

let overrides: Record<string, ShortcutBinding> = loadOverridesFromStorage()
let version = 0
const listeners = new Set<() => void>()

function loadOverridesFromStorage(): Record<string, ShortcutBinding> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, ShortcutBinding>
    const out: Record<string, ShortcutBinding> = {}
    for (const [id, b] of Object.entries(raw)) {
      if (registryById.has(id) && b?.code) out[id] = normalizeBinding(b)
    }
    return out
  } catch {
    return {}
  }
}

function persistOverrides() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
}

function notify() {
  version += 1
  listeners.forEach((l) => l())
}

function normalizeBinding(b: ShortcutBinding): ShortcutBinding {
  const out: ShortcutBinding = { code: b.code }
  if (b.ctrl) out.ctrl = true
  if (b.shift) out.shift = true
  if (b.alt) out.alt = true
  return out
}

export function bindingKey(b: ShortcutBinding): string {
  return `${b.ctrl ? 'c' : ''}${b.shift ? 's' : ''}${b.alt ? 'a' : ''}:${b.code}`
}

export function bindingsEqual(a: ShortcutBinding, b: ShortcutBinding): boolean {
  return bindingKey(a) === bindingKey(b)
}

export function getShortcutDef(id: string): ShortcutDef | undefined {
  return registryById.get(id)
}

export function loadOverrides(): Record<string, ShortcutBinding> {
  return { ...overrides }
}

export function getEffectiveBinding(id: string): ShortcutBinding {
  const def = registryById.get(id)
  if (!def) return { code: 'Unidentified' }
  return overrides[id] ?? def.defaultBinding
}

export function hasOverride(id: string): boolean {
  return id in overrides
}

export function setBindingOverride(id: string, binding: ShortcutBinding): boolean {
  if (!registryById.has(id)) return false
  const norm = normalizeBinding(binding)
  const conflict = SHORTCUT_REGISTRY.find(
    (s) => s.id !== id && bindingsEqual(getEffectiveBinding(s.id), norm),
  )
  if (conflict) return false
  overrides = { ...overrides, [id]: norm }
  persistOverrides()
  notify()
  return true
}

export function clearBindingOverride(id: string) {
  if (!(id in overrides)) return
  const next = { ...overrides }
  delete next[id]
  overrides = next
  persistOverrides()
  notify()
}

export function resetBinding(id: string) {
  clearBindingOverride(id)
}

export function resetAllBindings() {
  overrides = {}
  persistOverrides()
  notify()
}

export function findConflict(id: string, binding: ShortcutBinding): ShortcutDef | undefined {
  const norm = normalizeBinding(binding)
  return SHORTCUT_REGISTRY.find((s) => s.id !== id && bindingsEqual(getEffectiveBinding(s.id), norm))
}

/** True when the event target is a text field — callers usually skip shortcuts in that case. */
export function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  return t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || !!t?.isContentEditable
}

export function matchesShortcut(e: KeyboardEvent, binding: ShortcutBinding): boolean {
  const ctrl = e.ctrlKey || e.metaKey
  if (!!binding.ctrl !== ctrl) return false
  if (!!binding.shift !== e.shiftKey) return false
  if (!!binding.alt !== e.altKey) return false
  return e.code === binding.code
}

export function matchesShortcutId(e: KeyboardEvent, id: string): boolean {
  const def = registryById.get(id)
  if (!def) return false
  return matchesShortcut(e, getEffectiveBinding(id))
}

export function matchesAnyShortcutId(e: KeyboardEvent, ids: string[]): string | null {
  for (const id of ids) {
    if (matchesShortcutId(e, id)) return id
  }
  return null
}

const CODE_LABELS: Record<string, string> = {
  Backquote: '`',
  Backspace: 'Backspace',
  Delete: 'Del',
  Escape: 'Esc',
  Space: 'Space',
  F8: 'F8',
  F11: 'F11',
  End: 'End',
}

function codeToLabel(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return code
}

export function formatBinding(binding: ShortcutBinding): string {
  const parts: string[] = []
  if (binding.ctrl) parts.push('Ctrl')
  if (binding.shift) parts.push('Shift')
  if (binding.alt) parts.push('Alt')
  parts.push(codeToLabel(binding.code))
  return parts.join('+')
}

export function formatShortcutLabel(id: string): string {
  return formatBinding(getEffectiveBinding(id))
}

export function bindingFromKeyboardEvent(e: KeyboardEvent): ShortcutBinding | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null
  const binding: ShortcutBinding = { code: e.code }
  if (e.ctrlKey || e.metaKey) binding.ctrl = true
  if (e.shiftKey) binding.shift = true
  if (e.altKey) binding.alt = true
  return binding
}

export function getShortcutsVersion(): number {
  return version
}

export function subscribeShortcuts(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}