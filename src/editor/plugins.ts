/**
 * Vektra Plugin API (v0.41) — Godot EditorPlugin-style extensibility
 * ===================================================================
 *
 * Plugins are JavaScript snippets evaluated at boot (localStorage) or installed
 * via the Plugin Manager. They register editor hooks through `registerPlugin`
 * or the granular helpers on `window.vektra`.
 *
 * ## Quick start
 *
 * ```js
 * registerPlugin({
 *   name: 'My Plugin',
 *   commands: [{ label: 'Do Thing', run: () => vektra.useEditor.getState().setStatus('Done!') }],
 *   panels: [{ id: 'my-panel', title: 'My Panel' }],
 *   nodeTypes: [{
 *     type: 'my-actor',
 *     label: 'My Actor',
 *     icon: '★',
 *     category: 'Plugins',
 *     factory: (pos) => ({ id: 'x', name: 'MyActor', type: 'Empty', ... }),
 *   }],
 *   importers: [{ ext: '.csv', label: 'CSV', import: (file) => file.text().then(console.log) }],
 *   consoleCommands: [{ name: 'greet', help: 'greet [name]', run: (args) => 'Hello ' + (args[0] || 'World') }],
 * })
 * registerPanelCallback('my-panel', (el) => { el.innerHTML = '<p>Hello panel</p>' })
 * ```
 *
 * ## API surface (`window.vektra`)
 *
 * | Function | Description |
 * |----------|-------------|
 * | `registerPlugin(def)` | Register all hooks from one definition |
 * | `registerNodeType(def)` | Add a spawnable actor type (Content Browser + Place Actors) |
 * | `registerPanel(def)` | Register a bottom-dock panel tab (needs `registerPanelCallback`) |
 * | `registerImporter(def)` | Register drag-drop file handler by extension |
 * | `registerConsoleCommand(def)` | Register a `~` console command |
 * | `registerPanelCallback(id, fn)` | Provide panel render: `(container: HTMLElement) => void \| cleanup` |
 *
 * ## Panel rendering
 *
 * Panels cannot ship React components from evaluated JS. Call `registerPanelCallback`
 * with a function that mounts DOM into the supplied `HTMLElement`. Return a cleanup
 * function to run on unmount (optional).
 *
 * ## Persistence
 *
 * Installed plugins are stored in `localStorage` (`vektra-engine.plugins.v2`) with
 * enable/disable flags. Disabled plugins are not evaluated until re-enabled.
 *
 * ## Example
 *
 * See `src/editor/plugins/example-hello.js` or the Plugin Manager "Load example" button.
 */

import type { SerializedActor } from '../engine/types'
import { AddActorCommand, runCommand } from './commands'
import { useEditor } from './store'
import exampleHelloRaw from './plugins/example-hello.js?raw'

/** Built-in example plugin source (Plugin Manager → Example). */
export const EXAMPLE_HELLO_PLUGIN = exampleHelloRaw

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PaletteCommand {
  label: string
  run: () => void
}

export interface PluginPanelDef {
  id: string
  title: string
  /** Optional hint for documentation; actual render via registerPanelCallback */
  component?: string
  pluginName?: string
}

export interface PluginNodeTypeDef {
  type: string
  label: string
  icon?: string
  category?: string
  pluginName?: string
  factory: (position: [number, number, number]) => SerializedActor
}

export interface PluginImporterDef {
  ext: string
  label: string
  pluginName?: string
  import: (file: File) => void | Promise<void>
}

export interface PluginConsoleCommandDef {
  name: string
  help: string
  pluginName?: string
  run: (args: string[]) => string | void
}

export interface PluginDefinition {
  name: string
  commands?: PaletteCommand[]
  panels?: Omit<PluginPanelDef, 'pluginName'>[]
  nodeTypes?: Omit<PluginNodeTypeDef, 'pluginName'>[]
  importers?: Omit<PluginImporterDef, 'pluginName'>[]
  consoleCommands?: Omit<PluginConsoleCommandDef, 'pluginName'>[]
}

export interface PluginRecord {
  id: string
  name: string
  source: string
  enabled: boolean
}

export type PanelRenderFn = (container: HTMLElement) => void | (() => void)

// ── Registry state ──────────────────────────────────────────────────────────

const paletteCommands: PaletteCommand[] = []
const panels = new Map<string, PluginPanelDef>()
const panelCallbacks = new Map<string, PanelRenderFn>()
const nodeTypes = new Map<string, PluginNodeTypeDef>()
const importers: PluginImporterDef[] = []
const consoleCommands = new Map<string, PluginConsoleCommandDef>()

const PLUGIN_KEY_V2 = 'vektra-engine.plugins.v2'
const PLUGIN_KEY_LEGACY = 'vektra-engine.plugins'

function bumpPlugins() {
  useEditor.getState().touch()
}

function normalizeExt(ext: string): string {
  const e = ext.trim().toLowerCase()
  return e.startsWith('.') ? e : `.${e}`
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerPanelCallback(id: string, render: PanelRenderFn) {
  panelCallbacks.set(id, render)
  bumpPlugins()
}

export function registerPanel(def: Omit<PluginPanelDef, 'pluginName'>, pluginName = 'Plugin') {
  panels.set(def.id, { ...def, pluginName })
  bumpPlugins()
}

export function registerNodeType(def: Omit<PluginNodeTypeDef, 'pluginName'>, pluginName = 'Plugin') {
  nodeTypes.set(def.type, { ...def, pluginName })
  bumpPlugins()
}

export function registerImporter(def: Omit<PluginImporterDef, 'pluginName'>, pluginName = 'Plugin') {
  importers.push({ ...def, ext: normalizeExt(def.ext), pluginName })
  bumpPlugins()
}

export function registerConsoleCommand(def: Omit<PluginConsoleCommandDef, 'pluginName'>, pluginName = 'Plugin') {
  consoleCommands.set(def.name.toLowerCase(), { ...def, pluginName })
  bumpPlugins()
}

export function registerPlugin(plugin: PluginDefinition) {
  const name = plugin.name?.trim() || 'Unnamed Plugin'

  for (const c of plugin.commands ?? []) {
    paletteCommands.push({ ...c, label: `${name}: ${c.label}` })
  }
  for (const p of plugin.panels ?? []) registerPanel(p, name)
  for (const n of plugin.nodeTypes ?? []) registerNodeType(n, name)
  for (const i of plugin.importers ?? []) registerImporter(i, name)
  for (const c of plugin.consoleCommands ?? []) registerConsoleCommand(c, name)

  useEditor.getState().setStatus(`Plugin loaded: ${name}`)
  bumpPlugins()
}

// ── Readers (for editor UI wiring) ──────────────────────────────────────────

export function getPluginPaletteCommands(): PaletteCommand[] {
  return paletteCommands
}

export function getPluginPanels(): PluginPanelDef[] {
  return [...panels.values()]
}

export function getPluginPanelCallback(id: string): PanelRenderFn | undefined {
  return panelCallbacks.get(id)
}

export function getPluginNodeTypes(): PluginNodeTypeDef[] {
  return [...nodeTypes.values()]
}

export function getPluginNodeType(type: string): PluginNodeTypeDef | undefined {
  return nodeTypes.get(type)
}

export function getPluginImporters(): PluginImporterDef[] {
  return importers
}

export function getPluginConsoleCommands(): PluginConsoleCommandDef[] {
  return [...consoleCommands.values()]
}

export function findImporterForFile(file: File): PluginImporterDef | undefined {
  const name = file.name.toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot < 0) return undefined
  const ext = name.slice(dot)
  return importers.find((i) => i.ext === ext)
}

export function findImporterForExtension(ext: string): PluginImporterDef | undefined {
  const norm = normalizeExt(ext)
  return importers.find((i) => i.ext === norm)
}

/** Execute a plugin console command; returns response string or null if not handled. */
export function execPluginConsoleCommand(raw: string): string | null {
  const input = raw.trim()
  if (!input) return null
  const parts = input.split(/\s+/)
  const cmdName = parts[0].toLowerCase()
  const cmd = consoleCommands.get(cmdName)
  if (!cmd) return null
  const args = parts.slice(1)
  try {
    const result = cmd.run(args)
    return result !== undefined ? String(result) : `${cmd.name} executed`
  } catch (err) {
    return `plugin error: ${(err as Error).message}`
  }
}

/** Autocomplete suggestions from plugin console commands. */
export function pluginConsoleSuggestions(prefix: string): string[] {
  const p = prefix.toLowerCase()
  if (!p) return []
  const out: string[] = []
  for (const cmd of consoleCommands.values()) {
    const full = `${cmd.name} `
    if (cmd.name.startsWith(p) || full.startsWith(p)) out.push(full)
  }
  return out.slice(0, 6)
}

export function spawnPluginNode(nodeType: string, position: [number, number, number] = [0, 0.5, 0]) {
  const def = nodeTypes.get(nodeType)
  if (!def) {
    useEditor.getState().setStatus(`Unknown plugin node type: ${nodeType}`)
    return
  }
  runCommand(new AddActorCommand(def.factory(position)))
}

/** Handle OS file drop onto the viewport — returns true if a plugin importer handled it. */
export async function handlePluginFileDrop(files: FileList | File[]): Promise<boolean> {
  const list = [...files]
  if (!list.length) return false
  let handled = false
  for (const file of list) {
    const imp = findImporterForFile(file)
    if (!imp) continue
    handled = true
    try {
      await imp.import(file)
      useEditor.getState().setStatus(`${imp.label}: imported ${file.name}`)
      useEditor.getState().touch()
    } catch (err) {
      useEditor.getState().setStatus(`${imp.label} failed: ${(err as Error).message}`)
    }
  }
  return handled
}

// ── Registry reset (before reload) ────────────────────────────────────────────

function clearRegistry() {
  paletteCommands.length = 0
  panels.clear()
  panelCallbacks.clear()
  nodeTypes.clear()
  importers.length = 0
  consoleCommands.clear()
}

// ── Persistence & lifecycle ───────────────────────────────────────────────────

function migrateLegacyPlugins(): PluginRecord[] {
  try {
    const sources = JSON.parse(localStorage.getItem(PLUGIN_KEY_LEGACY) ?? '[]') as string[]
    if (!Array.isArray(sources) || !sources.length) return []
    const records = sources.map((source, i) => ({
      id: `legacy-${i}-${Date.now()}`,
      name: extractPluginName(source) ?? `Plugin ${i + 1}`,
      source,
      enabled: true,
    }))
    savePluginRecords(records)
    localStorage.removeItem(PLUGIN_KEY_LEGACY)
    return records
  } catch {
    return []
  }
}

function extractPluginName(source: string): string | null {
  const m = source.match(/registerPlugin\s*\(\s*\{[^}]*name\s*:\s*['"`]([^'"`]+)['"`]/s)
  return m?.[1] ?? null
}

export function loadPluginRecords(): PluginRecord[] {
  try {
    const raw = localStorage.getItem(PLUGIN_KEY_V2)
    if (!raw) return migrateLegacyPlugins()
    const records = JSON.parse(raw) as PluginRecord[]
    return Array.isArray(records) ? records : []
  } catch {
    return []
  }
}

export function savePluginRecords(records: PluginRecord[]) {
  localStorage.setItem(PLUGIN_KEY_V2, JSON.stringify(records))
}

function makeEvalScope() {
  const vektra = (window as unknown as Record<string, unknown>).vektra
  return {
    registerPlugin,
    registerNodeType,
    registerPanel,
    registerImporter,
    registerConsoleCommand,
    registerPanelCallback,
    vektra,
  }
}

function evalPluginSource(source: string) {
  const scope = makeEvalScope()
  const keys = Object.keys(scope)
  const vals = Object.values(scope)
  new Function(...keys, source)(...vals)
}

/** Evaluate all enabled plugins — call once at boot and after registry changes. */
export function reloadAllPlugins() {
  clearRegistry()
  const records = loadPluginRecords().filter((r) => r.enabled)
  for (const rec of records) {
    try {
      evalPluginSource(rec.source)
    } catch (err) {
      console.warn(`Plugin "${rec.name}" failed:`, err)
      useEditor.getState().setStatus(`Plugin error: ${rec.name}`)
    }
  }
  bumpPlugins()
}

/** Load persisted user plugins at boot. */
export function loadUserPlugins() {
  reloadAllPlugins()
}

export function installPlugin(source: string, name?: string): PluginRecord {
  const records = loadPluginRecords()
  const record: PluginRecord = {
    id: `plugin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name?.trim() || extractPluginName(source) || `Plugin ${records.length + 1}`,
    source,
    enabled: true,
  }
  records.push(record)
  savePluginRecords(records)
  try {
    evalPluginSource(source)
    useEditor.getState().setStatus(`Installed plugin: ${record.name}`)
  } catch (err) {
    console.warn('install plugin eval failed:', err)
    useEditor.getState().setStatus(`Plugin installed but failed to load: ${(err as Error).message}`)
  }
  bumpPlugins()
  return record
}

export function removePlugin(id: string) {
  const records = loadPluginRecords().filter((r) => r.id !== id)
  savePluginRecords(records)
  reloadAllPlugins()
}

export function setPluginEnabled(id: string, enabled: boolean) {
  const records = loadPluginRecords()
  const rec = records.find((r) => r.id === id)
  if (!rec) return
  rec.enabled = enabled
  savePluginRecords(records)
  reloadAllPlugins()
}

export function updatePluginSource(id: string, source: string, name?: string) {
  const records = loadPluginRecords()
  const rec = records.find((r) => r.id === id)
  if (!rec) return
  rec.source = source
  if (name?.trim()) rec.name = name.trim()
  else {
    const extracted = extractPluginName(source)
    if (extracted) rec.name = extracted
  }
  savePluginRecords(records)
  if (rec.enabled) reloadAllPlugins()
  else bumpPlugins()
}