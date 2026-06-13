import { useEffect, useRef, useState } from 'react'
import { redo, undo, runCommand, DeleteActorCommand } from './commands'
import { newLevel, openLevelFromFile, saveLevelToFile } from './levelIO'
import { exportPlayable, exportPlayablePWA } from './exportPlayable'
import { bakeAO } from '../engine/lightmapBake'
import { world } from '../engine/World'
import { spawnAsset } from './spawn'
import { useEditor } from './store'
import { formatShortcutLabel, getShortcutsVersion, subscribeShortcuts } from './shortcuts'
import { useSyncExternalStore } from 'react'

interface MenuItem {
  label: string
  shortcut?: string
  action?: () => void
  divider?: boolean
}

function Menu({ title, items }: { title: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="menu" ref={ref}>
      <button className={`menu-title ${open ? 'open' : ''}`} onClick={() => setOpen(!open)}>
        {title}
      </button>
      {open && (
        <div className="menu-dropdown">
          {items.map((item, i) =>
            item.divider ? (
              <div className="menu-divider" key={i} />
            ) : (
              <button
                key={item.label}
                className="menu-item"
                onClick={() => {
                  setOpen(false)
                  item.action?.()
                }}
              >
                <span>{item.label}</span>
                {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}

export function MenuBar() {
  useSyncExternalStore(subscribeShortcuts, getShortcutsVersion)
  const levelName = useEditor((s) => s.levelName)
  const setLevelName = useEditor((s) => s.setLevelName)

  return (
    <div className="menubar">
      <div className="menubar-logo">
        VEKTRA<span>ENGINE</span>
      </div>
      <Menu
        title="File"
        items={[
          { label: 'New Level', action: newLevel },
          { label: 'Open Level…', action: openLevelFromFile },
          { label: 'Save Level', shortcut: formatShortcutLabel('tools.save'), action: saveLevelToFile },
          { label: '', divider: true },
          { label: 'Export Playable HTML', action: () => exportPlayable() },
          { label: 'Export Playable HTML (PWA)', action: exportPlayablePWA },
        ]}
      />
      <Menu
        title="Edit"
        items={[
          { label: 'Undo', shortcut: formatShortcutLabel('tools.undo'), action: undo },
          { label: 'Redo', shortcut: formatShortcutLabel('tools.redo'), action: redo },
          { label: '', divider: true },
          { label: 'Editor Preferences…', action: () => useEditor.getState().setShowPrefs(true) },
          { label: '', divider: true },
          {
            label: 'Delete Selected',
            shortcut: 'Del',
            action: () => {
              const id = useEditor.getState().selectedId
              if (id) runCommand(new DeleteActorCommand(id))
            },
          },
        ]}
      />
      <Menu
        title="Build"
        items={[
          {
            label: 'Bake AO (approx)',
            action: () => {
              const s = useEditor.getState()
              s.setStatus('Baking AO (approx)…')
              void bakeAO(world.actors, {
                samples: 16,
                radius: 1,
                onProgress: (_done, _total, label) => s.setStatus(label),
              }).then((res) => {
                s.setStatus(
                  res.ok
                    ? `Baked AO (approx): ${res.actorsBaked} actors, ${res.verticesProcessed} verts`
                    : `Bake AO failed: ${res.error ?? 'unknown'}`,
                )
                s.touch()
              })
            },
          },
        ]}
      />
      <Menu
        title="Window"
        items={[
          { label: 'Plugin Manager…', action: () => useEditor.getState().setShowPluginManager(true) },
          { label: '', divider: true },
          { label: 'Editor Preferences…', action: () => useEditor.getState().setShowPrefs(true) },
        ]}
      />
      <Menu
        title="Place"
        items={[
          { label: 'Cube', action: () => spawnAsset({ kind: 'mesh', geometry: 'box' }) },
          { label: 'Sphere', action: () => spawnAsset({ kind: 'mesh', geometry: 'sphere' }) },
          { label: 'Cylinder', action: () => spawnAsset({ kind: 'mesh', geometry: 'cylinder' }) },
          { label: 'Plane', action: () => spawnAsset({ kind: 'mesh', geometry: 'plane' }) },
          { label: '', divider: true },
          { label: 'Point Light', action: () => spawnAsset({ kind: 'light', type: 'PointLight' }) },
          { label: 'Spot Light', action: () => spawnAsset({ kind: 'light', type: 'SpotLight' }) },
          { label: 'Directional Light', action: () => spawnAsset({ kind: 'light', type: 'DirectionalLight' }) },
          { label: 'Ambient Light', action: () => spawnAsset({ kind: 'light', type: 'AmbientLight' }) },
          { label: '', divider: true },
          { label: 'Camera', action: () => spawnAsset({ kind: 'camera' }) },
          { label: 'Empty Actor', action: () => spawnAsset({ kind: 'empty' }) },
        ]}
      />
      <div className="menubar-spacer" />
      <input
        className="level-name"
        value={levelName}
        onChange={(e) => setLevelName(e.target.value)}
        spellCheck={false}
        title="Level name"
      />
    </div>
  )
}
