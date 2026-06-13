import { useState } from 'react'
import { bakeNavMesh, isRecastNavReady, lastBakeError, navMeshBaking, navMeshReady } from '../../engine/nav'
import { world } from '../../engine/World'
import { consoleState } from '../consoleCommands'
import { loadInputMap, saveInputMap, type InputAction } from '../../engine/inputActions'
import { setBusVolume } from '../../engine/audio'
import { loadMPSettings, saveMPSettings } from '../../engine/multiplayer'
import { useEditor } from '../store'

function HudDesignerSection() {
  const touch = useEditor((s) => s.touch)
  useEditor((s) => s.sceneVersion)
  const widgets = world.hudWidgets
  return (
    <details className="details-section">
      <summary>HUD Widgets (UMG)</summary>
      <div className="details-grid">
        {widgets.map((w, i) => (
          <div className="hud-widget-row" key={w.id}>
            <select value={w.type} onChange={(e) => { w.type = e.target.value as typeof w.type; touch() }}>
              <option value="text">Text</option>
              <option value="bar">Bar</option>
              <option value="button">Button</option>
            </select>
            <input value={w.text} placeholder="label" onChange={(e) => { w.text = e.target.value; touch() }} />
            <select value={w.anchor} onChange={(e) => { w.anchor = e.target.value as typeof w.anchor; touch() }}>
              {['tl', 'tr', 'bl', 'br', 'center'].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            {w.type === 'button' && (
              <input value={w.signal ?? ''} placeholder="signal" title="Signal emitted on click — api.on(signal, fn)" onChange={(e) => { w.signal = e.target.value; touch() }} />
            )}
            <input type="color" value={w.color} onChange={(e) => { w.color = e.target.value; touch() }} />
            <button onClick={() => { widgets.splice(i, 1); touch() }}>✕</button>
          </div>
        ))}
        <button
          onClick={() => {
            widgets.push({ id: `w${Date.now().toString(36)}`, type: 'text', text: 'New Widget', anchor: 'tl', x: 16, y: 16, size: 16, color: '#ffffff' })
            touch()
          }}
        >
          + Add Widget
        </button>
        <div className="panel-empty" style={{ padding: '2px 0' }}>Rendered during Play. Buttons emit their signal; scripts update via api.hud with the same ids.</div>
      </div>
    </details>
  )
}

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

function NavigationSection() {
  const touch = useEditor((s) => s.touch)
  const [status, setStatus] = useState(() => (navMeshReady ? 'NavMesh ready' : 'No navmesh baked'))

  return (
    <details className="details-section">
      <summary>Navigation</summary>
      <div className="details-grid">
        <label className="field check">
          <span>Show NavMesh</span>
          <input
            type="checkbox"
            checked={consoleState.showNavMesh}
            onChange={(e) => {
              consoleState.showNavMesh = e.target.checked
              touch()
            }}
          />
        </label>
        <button
          disabled={navMeshBaking}
          onClick={async () => {
            setStatus('Baking navmesh…')
            const ok = await bakeNavMesh(world.actors)
            setStatus(
              ok
                ? 'NavMesh baked (Recast polygon pathfinding active)'
                : `Bake failed: ${lastBakeError ?? 'unknown error'}`,
            )
            touch()
          }}
        >
          {navMeshBaking ? 'Baking NavMesh…' : 'Bake NavMesh'}
        </button>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          {status}
          {isRecastNavReady() ? '' : ' · Console: show navmesh'}
        </div>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          Bakes static + landscape geometry. Scripts use api.findPath when a bake is available.
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
      <NavigationSection />
      <InputMapSection />
      <DataAssetsSection />
      <AudioSection />
      <MultiplayerSection />
      <HudDesignerSection />
    </details>
  )
}
