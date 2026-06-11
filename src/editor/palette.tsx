import { useEffect, useMemo, useRef, useState } from 'react'
import { redo, undo } from './commands'
import { exportPlayable } from './exportPlayable'
import { newLevel, openLevelFromFile, saveLevelToFile } from './levelIO'
import { spawnAsset, type AssetPayload } from './spawn'
import { useEditor } from './store'

/**
 * Command palette (Ctrl+Shift+P) + plugin API — the web-native extensibility
 * layer. Plugins register commands at runtime:
 *   window.vektra.registerPlugin({ name, commands: [{ label, run }] })
 * User plugin sources persist in localStorage and load at boot.
 */

export interface PaletteCommand {
  label: string
  run: () => void
}

const SPAWNABLES: Array<[string, AssetPayload]> = [
  ['Cube', { kind: 'mesh', geometry: 'box' }],
  ['Sphere', { kind: 'mesh', geometry: 'sphere' }],
  ['Point Light', { kind: 'light', type: 'PointLight' }],
  ['Camera', { kind: 'camera' }],
  ['Particles', { kind: 'particles' }],
  ['Foliage', { kind: 'foliage' }],
  ['Landscape', { kind: 'landscape' }],
  ['Trigger Volume', { kind: 'trigger' }],
  ['Player Start', { kind: 'playerstart' }],
]

const pluginCommands: PaletteCommand[] = []

export function registerPlugin(plugin: { name: string; commands?: PaletteCommand[] }) {
  for (const c of plugin.commands ?? []) {
    pluginCommands.push({ ...c, label: `${plugin.name}: ${c.label}` })
  }
  useEditor.getState().setStatus(`Plugin loaded: ${plugin.name}`)
}

const PLUGIN_KEY = 'vektra-engine.plugins'

/** load persisted user plugin sources (JS evaluated with registerPlugin in scope) */
export function loadUserPlugins() {
  try {
    const sources = JSON.parse(localStorage.getItem(PLUGIN_KEY) ?? '[]') as string[]
    for (const src of sources) {
      try {
        new Function('registerPlugin', 'vektra', src)(registerPlugin, (window as unknown as Record<string, unknown>).vektra)
      } catch (err) {
        console.warn('plugin failed:', err)
      }
    }
  } catch {
    /* no plugins */
  }
}

export function installPlugin(source: string) {
  const sources = JSON.parse(localStorage.getItem(PLUGIN_KEY) ?? '[]') as string[]
  sources.push(source)
  localStorage.setItem(PLUGIN_KEY, JSON.stringify(sources))
  new Function('registerPlugin', 'vektra', source)(registerPlugin, (window as unknown as Record<string, unknown>).vektra)
}

function buildCommands(): PaletteCommand[] {
  const s = useEditor.getState()
  return [
    { label: 'Play In Editor', run: () => s.startPlay('pie') },
    { label: 'Simulate', run: () => s.startPlay('simulate') },
    { label: 'Stop', run: () => s.stopPlay() },
    { label: 'New Level', run: newLevel },
    { label: 'Open Level…', run: openLevelFromFile },
    { label: 'Save Level', run: saveLevelToFile },
    { label: 'Export Playable HTML', run: exportPlayable },
    { label: 'Undo', run: undo },
    { label: 'Redo', run: redo },
    { label: 'Toggle Game View', run: () => s.toggleGameView() },
    { label: 'Open Console', run: () => s.openConsole() },
    { label: 'Open Sequencer', run: () => s.setBottomTab('sequencer') },
    { label: 'Open Blueprint Editor', run: () => s.setBottomTab('blueprint') },
    { label: 'Open AI Copilot', run: () => s.setBottomTab('ai') },
    { label: 'Open Debug Panel', run: () => s.setBottomTab('debug') },
    ...SPAWNABLES.map(([label, payload]): PaletteCommand => ({ label: `Place: ${label}`, run: () => spawnAsset(payload) })),
    ...pluginCommands,
  ]
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyP') {
        e.preventDefault()
        setOpen((o) => !o)
        setQuery('')
        setSel(0)
      }
      if (e.code === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const commands = useMemo(buildCommands, [open])
  const filtered = commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))

  if (!open) return null
  return (
    <div className="palette-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          placeholder="Type a command…"
          onChange={(e) => {
            setQuery(e.target.value)
            setSel(0)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'ArrowDown') setSel((x) => Math.min(filtered.length - 1, x + 1))
            if (e.key === 'ArrowUp') setSel((x) => Math.max(0, x - 1))
            if (e.key === 'Enter' && filtered[sel]) {
              setOpen(false)
              filtered[sel].run()
            }
            if (e.key === 'Escape') setOpen(false)
          }}
        />
        <div className="palette-list">
          {filtered.slice(0, 12).map((c, i) => (
            <button
              key={c.label}
              className={i === sel ? 'active' : ''}
              onMouseEnter={() => setSel(i)}
              onClick={() => {
                setOpen(false)
                c.run()
              }}
            >
              {c.label}
            </button>
          ))}
          {filtered.length === 0 && <div className="panel-empty">No matching command.</div>}
        </div>
      </div>
    </div>
  )
}
