import { useEffect, useMemo, useRef, useState } from 'react'
import { redo, undo } from './commands'
import { exportPlayable, exportPlayablePWA } from './exportPlayable'
import { newLevel, openLevelFromFile, saveLevelToFile } from './levelIO'
import { spawnAsset, type AssetPayload } from './spawn'
import { useEditor } from './store'
import { runCSG } from './csg'
import { world } from '../engine/World'
import { getPluginPaletteCommands, type PaletteCommand } from './plugins'
import { isTypingTarget, matchesShortcutId } from './shortcuts'

/**
 * Command palette (Ctrl+Shift+P) — built-in commands + plugin-registered commands.
 * Plugin API lives in `src/editor/plugins.ts` and `window.vektra`.
 */

export type { PaletteCommand } from './plugins'
export {
  registerPlugin,
  registerNodeType,
  registerPanel,
  registerImporter,
  registerConsoleCommand,
  registerPanelCallback,
  installPlugin,
  loadUserPlugins,
} from './plugins'

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

function buildCommands(): PaletteCommand[] {
  const s = useEditor.getState()
  return [
    { label: 'Play In Editor', run: () => s.startPlay('pie') },
    { label: 'Simulate', run: () => s.startPlay('simulate') },
    { label: 'Stop', run: () => s.stopPlay() },
    { label: 'New Level', run: newLevel },
    { label: 'Open Level…', run: openLevelFromFile },
    { label: 'Save Level', run: saveLevelToFile },
    { label: 'Export Playable HTML', run: () => exportPlayable() },
    { label: 'Export Playable HTML (PWA)', run: exportPlayablePWA },
    { label: 'Undo', run: undo },
    { label: 'Redo', run: redo },
    { label: 'Toggle Game View', run: () => s.toggleGameView() },
    { label: 'Open Console', run: () => s.openConsole() },
    { label: 'Open Sequencer', run: () => s.setBottomTab('sequencer') },
    { label: 'Open Blueprint Editor', run: () => s.setBottomTab('blueprint') },
    { label: 'Open AI Copilot', run: () => s.setBottomTab('ai') },
    { label: 'Open Debug Panel', run: () => s.setBottomTab('debug') },
    { label: 'Open Plugin Manager', run: () => s.setShowPluginManager(true) },
    { label: 'CSG: Union (2 selected)', run: () => runCSG('union') },
    { label: 'CSG: Subtract (2 selected)', run: () => runCSG('subtract') },
    { label: 'CSG: Intersect (2 selected)', run: () => runCSG('intersect') },
    {
      label: 'Bake Reflection Probes',
      run: () => {
        for (const a of world.actors.values()) if (a.type === 'ReflectionProbe') world.probeBakeQueue.push(a.id)
        s.setStatus('Probe bake queued')
      },
    },
    ...SPAWNABLES.map(([label, payload]): PaletteCommand => ({ label: `Place: ${label}`, run: () => spawnAsset(payload) })),
    ...getPluginPaletteCommands(),
  ]
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const sceneVersion = useEditor((s) => s.sceneVersion)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isTypingTarget(e.target) && matchesShortcutId(e, 'panels.commandPalette')) {
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

  const commands = useMemo(buildCommands, [open, sceneVersion])
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