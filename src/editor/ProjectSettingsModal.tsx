import { useState } from 'react'
import { world } from '../engine/World'
import { useEditor } from './store'
import {
  DEFAULT_PROJECT,
  loadProjectSettings,
  saveProjectSettings,
  type ProjectSettings,
} from './projectSettings'

/** Project Settings modal (Wave 12) — global, not per-level. */
export function ProjectSettingsModal({ onClose }: { onClose: () => void }) {
  const touch = useEditor((s) => s.touch)
  const [proj, setProj] = useState<ProjectSettings>(loadProjectSettings)

  const update = (patch: Partial<ProjectSettings>) => {
    const next = { ...proj, ...patch }
    setProj(next)
    saveProjectSettings(next)
    if (patch.defaultRenderBackend !== undefined) world.environment.renderBackend = patch.defaultRenderBackend
    if (patch.defaultPhysicsHz !== undefined) world.environment.fixedPhysicsHz = patch.defaultPhysicsHz
    if (patch.defaultMaterialBackend !== undefined) world.environment.materialBackend = patch.defaultMaterialBackend
    if (patch.defaultPostSsgi !== undefined) world.environment.postSsgi = patch.defaultPostSsgi
    world.applyEnvironment()
    touch()
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette prefs project-settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <span>Project Settings</span>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="details-grid" style={{ padding: 12 }}>
          <label className="field">
            <span>Project name</span>
            <input value={proj.projectName} onChange={(e) => update({ projectName: e.target.value })} />
          </label>
          <label className="field">
            <span>Default render backend</span>
            <select
              value={proj.defaultRenderBackend}
              onChange={(e) => update({ defaultRenderBackend: e.target.value as 'webgl' | 'webgpu' })}
            >
              <option value="webgl">WebGL</option>
              <option value="webgpu">WebGPU tier</option>
            </select>
          </label>
          <label className="field">
            <span>Default physics Hz</span>
            <input
              type="number"
              min={30}
              max={120}
              value={proj.defaultPhysicsHz}
              onChange={(e) => update({ defaultPhysicsHz: parseInt(e.target.value, 10) || 60 })}
            />
          </label>
          <label className="field">
            <span>Default material backend</span>
            <select
              value={proj.defaultMaterialBackend}
              onChange={(e) => update({ defaultMaterialBackend: e.target.value as 'glsl' | 'tsl' })}
            >
              <option value="glsl">GLSL</option>
              <option value="tsl">TSL</option>
            </select>
          </label>
          <label className="field check">
            <span>SSGI default (WebGPU)</span>
            <input type="checkbox" checked={proj.defaultPostSsgi} onChange={(e) => update({ defaultPostSsgi: e.target.checked })} />
          </label>
          <label className="field check">
            <span>Lotus branding on export</span>
            <input
              type="checkbox"
              checked={proj.showLotusBranding}
              onChange={(e) => update({ showLotusBranding: e.target.checked })}
            />
          </label>
          <label className="field">
            <span>Autoload actor names</span>
            <input
              placeholder="GameManager, AudioBus (comma-separated)"
              value={proj.autoloadActorNames.join(', ')}
              onChange={(e) =>
                update({
                  autoloadActorNames: e.target.value
                    .split(',')
                    .map((n) => n.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label className="field">
            <span>Main scene key (export entry)</span>
            <input
              placeholder="main or linked level key (e.g. dungeon)"
              value={proj.mainSceneKey}
              onChange={(e) => update({ mainSceneKey: e.target.value.trim() })}
            />
          </label>
          <div className="panel-empty" style={{ padding: '2px 0' }}>
            Autoload names persist across <code>api.loadLevel</code> / <code>api.changeScene</code>. Main scene key sets{' '}
            <code>window.__LOTUS_MAIN__</code> in exported playables.
          </div>
          <button onClick={() => update({ ...DEFAULT_PROJECT })}>Reset to defaults</button>
        </div>
      </div>
    </div>
  )
}