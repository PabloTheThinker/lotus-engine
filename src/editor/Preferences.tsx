import { useState } from 'react'
import { useEditor } from './store'

/**
 * Editor Preferences — UE Editor Preferences modal (the most-touched subset):
 * camera, invert look, autosave. Persisted in localStorage; applied live.
 */
export interface Prefs {
  invertLookY: boolean
  autosaveSeconds: number
  defaultCameraSpeed: number
}

const KEY = 'vektra-engine.prefs'

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      invertLookY: !!raw.invertLookY,
      autosaveSeconds: raw.autosaveSeconds ?? 5,
      defaultCameraSpeed: raw.defaultCameraSpeed ?? 4,
    }
  } catch {
    return { invertLookY: false, autosaveSeconds: 5, defaultCameraSpeed: 4 }
  }
}

export function savePrefs(p: Prefs) {
  localStorage.setItem(KEY, JSON.stringify(p))
}

export function PreferencesModal({ onClose }: { onClose: () => void }) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const setCameraSpeed = useEditor((s) => s.setCameraSpeed)
  const update = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    savePrefs(next)
    if (patch.defaultCameraSpeed !== undefined) setCameraSpeed(patch.defaultCameraSpeed)
  }
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette prefs" onMouseDown={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <span>Editor Preferences</span>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="details-grid" style={{ padding: 12 }}>
          <label className="field check">
            <span>Invert Mouse Look Y</span>
            <input type="checkbox" checked={prefs.invertLookY} onChange={(e) => update({ invertLookY: e.target.checked })} />
          </label>
          <label className="field">
            <span>Camera Speed</span>
            <input
              type="range"
              min={1}
              max={8}
              step={1}
              value={prefs.defaultCameraSpeed}
              onChange={(e) => update({ defaultCameraSpeed: parseInt(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Autosave (s)</span>
            <input
              type="number"
              min={2}
              step={1}
              value={prefs.autosaveSeconds}
              onChange={(e) => update({ autosaveSeconds: Math.max(2, parseInt(e.target.value) || 5) })}
            />
          </label>
          <div className="panel-empty" style={{ padding: '4px 0' }}>
            Autosave interval applies on next reload. Snap presets live in the toolbar dropdowns; input bindings in World Settings → Input Map.
          </div>
        </div>
      </div>
    </div>
  )
}
