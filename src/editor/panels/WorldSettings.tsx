import { useState } from 'react'
import { world } from '../../engine/World'
import { loadInputMap, saveInputMap, type InputAction } from '../../engine/inputActions'
import { setBusVolume } from '../../engine/audio'
import { loadMPSettings, saveMPSettings } from '../../engine/multiplayer'
import { useEditor } from '../store'

function MultiplayerSection() {
  const [cfg, setCfg] = useState(() => loadMPSettings())
  const update = (patch: Partial<typeof cfg>) => {
    const next = { ...cfg, ...patch }
    setCfg(next)
    saveMPSettings(next)
  }
  return (
    <details className="details-section">
      <summary>Multiplayer</summary>
      <div className="details-grid">
        <label className="field check">
          <span>Enabled</span>
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
        </label>
        <label className="field">
          <span>Relay URL</span>
          <input value={cfg.url} onChange={(e) => update({ url: e.target.value })} spellCheck={false} />
        </label>
        <label className="field">
          <span>Room</span>
          <input value={cfg.room} onChange={(e) => update({ room: e.target.value })} spellCheck={false} />
        </label>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          Run the relay: node scripts/relay.mjs — peers in the same room see each other as ghost pawns during Play.
        </div>
      </div>
    </details>
  )
}

function AudioSection() {
  return (
    <details className="details-section">
      <summary>Audio Buses</summary>
      <div className="details-grid">
        {(['master', 'sfx', 'music'] as const).map((bus) => (
          <label className="field" key={bus}>
            <span>{bus}</span>
            <input type="range" min={0} max={1.5} step={0.05} defaultValue={1} onChange={(e) => setBusVolume(bus, parseFloat(e.target.value))} />
          </label>
        ))}
        <div className="panel-empty" style={{ padding: '2px 0' }}>Import sounds in the Content Browser; scripts call api.playSound(name).</div>
      </div>
    </details>
  )
}

function DataAssetsSection() {
  const touch = useEditor((s) => s.touch)
  useEditor((s) => s.sceneVersion)
  const names = Object.keys(world.dataTables)
  return (
    <details className="details-section">
      <summary>Data Assets</summary>
      <div className="details-grid">
        {names.map((n) => (
          <label className="field" key={n} style={{ gridTemplateColumns: '70px 1fr 20px', display: 'grid' }}>
            <span>{n}</span>
            <input
              defaultValue={JSON.stringify(world.dataTables[n])}
              spellCheck={false}
              onBlur={(e) => {
                try {
                  world.dataTables[n] = JSON.parse(e.target.value)
                  touch()
                } catch { /* keep prior on bad JSON */ }
              }}
            />
            <button
              onClick={() => {
                delete world.dataTables[n]
                touch()
              }}
            >
              ✕
            </button>
          </label>
        ))}
        <button
          onClick={() => {
            const n = prompt('Data asset name?')
            if (n) {
              world.dataTables[n] = []
              touch()
            }
          }}
        >
          + Add Data Asset
        </button>
        <div className="panel-empty" style={{ padding: '2px 0' }}>JSON tables — scripts read api.getData('name').</div>
      </div>
    </details>
  )
}

function InputMapSection() {
  const [actions, setActions] = useState<InputAction[]>(() => loadInputMap().map((a) => ({ ...a, keys: [...a.keys] })))
  const commit = (next: InputAction[]) => {
    setActions(next)
    saveInputMap(next.map((a) => ({ ...a, keys: [...a.keys] })))
  }
  return (
    <details className="details-section">
      <summary>Input Map</summary>
      <div className="details-grid">
        {actions.map((a, i) => (
          <label className="field" key={i}>
            <span>{a.name}</span>
            <input
              value={a.keys.join(', ')}
              spellCheck={false}
              onKeyDown={(e) => {
                // press a key to bind it
                if (e.key === 'Tab' || e.key === 'Escape') return
                e.preventDefault()
                e.stopPropagation()
                const next = actions.map((x, j) => (j === i ? { ...x, keys: [e.code] } : x))
                commit(next)
              }}
              onChange={() => {}}
              title="Focus and press a key to rebind"
            />
          </label>
        ))}
        <button
          onClick={() => {
            const name = prompt('Action name?')
            if (name) commit([...actions, { name, keys: [] }])
          }}
        >
          + Add Action
        </button>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          Scripts: api.isAction('Jump') · api.actionJustPressed('Fire')
        </div>
      </div>
    </details>
  )
}

/** World Settings — environment + post stack (UE World Settings analog). */
export function WorldSettings() {
  const touch = useEditor((s) => s.touch)
  useEditor((s) => s.sceneVersion)
  const env = world.environment

  const set = <K extends keyof typeof env>(key: K, value: (typeof env)[K]) => {
    env[key] = value
    world.applyEnvironment()
    touch()
  }

  return (
    <details className="details-section world-settings">
      <summary>World Settings</summary>
      <div className="details-grid">
        <label className="field check">
          <span>Sky Atmosphere</span>
          <input type="checkbox" checked={env.skyEnabled} onChange={(e) => set('skyEnabled', e.target.checked)} />
        </label>
        {env.skyEnabled ? (
          <>
            <label className="field">
              <span>Sun Elevation</span>
              <input
                type="range"
                min={-5}
                max={90}
                step={1}
                value={env.sunElevation}
                onChange={(e) => set('sunElevation', parseFloat(e.target.value))}
              />
            </label>
            <label className="field">
              <span>Sun Azimuth</span>
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={env.sunAzimuth}
                onChange={(e) => set('sunAzimuth', parseFloat(e.target.value))}
              />
            </label>
          </>
        ) : (
          <label className="field">
            <span>Background</span>
            <input type="color" value={env.background} onChange={(e) => set('background', e.target.value)} />
          </label>
        )}
        <label className="field check">
          <span>Fog</span>
          <input type="checkbox" checked={env.fogEnabled} onChange={(e) => set('fogEnabled', e.target.checked)} />
        </label>
        {env.fogEnabled && (
          <>
            <label className="field">
              <span>Fog Color</span>
              <input type="color" value={env.fogColor} onChange={(e) => set('fogColor', e.target.value)} />
            </label>
            <label className="field">
              <span>Fog Density</span>
              <input
                type="range"
                min={0.001}
                max={0.15}
                step={0.001}
                value={env.fogDensity}
                onChange={(e) => set('fogDensity', parseFloat(e.target.value))}
              />
            </label>
          </>
        )}
        <label className="field">
          <span>Exposure</span>
          <input
            type="range"
            min={0.2}
            max={2}
            step={0.05}
            value={env.exposure ?? 0.75}
            onChange={(e) => set('exposure', parseFloat(e.target.value))}
          />
        </label>
        <label className="field check">
          <span>Bloom</span>
          <input type="checkbox" checked={env.bloomEnabled} onChange={(e) => set('bloomEnabled', e.target.checked)} />
        </label>
        {env.bloomEnabled && (
          <>
            <label className="field">
              <span>Strength</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={env.bloomStrength}
                onChange={(e) => set('bloomStrength', parseFloat(e.target.value))}
              />
            </label>
            <label className="field">
              <span>Threshold</span>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={env.bloomThreshold}
                onChange={(e) => set('bloomThreshold', parseFloat(e.target.value))}
              />
            </label>
          </>
        )}
      </div>
      <InputMapSection />
      <DataAssetsSection />
      <AudioSection />
      <MultiplayerSection />
    </details>
  )
}
