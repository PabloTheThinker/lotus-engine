import { useState } from 'react'
import {
  deleteAbility,
  deleteAttributeSet,
  deleteEffect,
  listAbilities,
  listAttributeSets,
  listEffects,
  nextAbilityId,
  nextAttributeSetId,
  nextEffectId,
  saveAbility,
  saveAttributeSet,
  saveEffect,
  type Ability,
  type AttributeSet,
  type EffectModifierOp,
  type GameplayEffect,
} from '../../engine/gameplayAbilities'
import {
  aoBakeProgress,
  aoBaking,
  aoMapBakeProgress,
  aoMapBaking,
  bakeAO,
  bakeAOMapUV2,
  lastAOBakeError,
  lastAOMapBakeError,
} from '../../engine/lightmapBake'
import { bakeNavMesh, isRecastNavReady, lastBakeError, navMeshBaking, navMeshReady } from '../../engine/nav'
import { exportCloudSaveManifest } from '../../engine/cloudSaveSync'
import { setSaveContext } from '../../engine/saveSystem'
import { sanitizeLevelKey, world } from '../../engine/World'
import { COLOR_GRADING_PRESET_IDS, COLOR_GRADING_PRESET_THUMBNAILS } from '../../engine/postStackColorGrading'
import {
  decodeGradingLUTFile,
  decodePngLUTAtlas,
  persistDecodedLUTToEnvironment,
} from '../../engine/postColorGradingLut'
import type { SerializedLevel } from '../../engine/types'
import { consoleState } from '../consoleCommands'
import { loadInputMap, saveInputMap, type InputAction } from '../../engine/inputActions'
import {
  GAMEPAD_ACTIONS,
  getBindings,
  resetBindings,
  setGamepadButton,
  setTouchSlot,
  TOUCH_ACTIONS,
  TOUCH_SLOT_IDS,
  type TouchAction,
} from '../../engine/inputBindings'
import {
  applyInputProfile,
  getActiveInputProfile,
  hapticPresetForProfile,
  listInputProfiles,
  saveInputProfile,
} from '../../engine/inputProfiles'
import { applyTouchLayoutPreset } from '../../engine/touchLayoutPresets'
import { setBusVolume, setSoundAttenuationDefaults } from '../../engine/audio'
import { AttenuationFields } from './AttenuationFields'
import { createMetaSound, deleteMetaSound, listMetaSounds } from '../../engine/metaSoundAssets'
import { loadMPSettings, saveMPSettings } from '../../engine/multiplayer'
import { TOUCH_LAYOUT_PRESET_IDS, TOUCH_LAYOUT_PRESET_LABELS } from '../../engine/touchLayoutPresets'
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
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          Rendered during Play. Buttons emit their signal; scripts update via api.hud with the same ids.
          Animate widgets in Sequencer: add a Button, then + HUD Track → pick the button → opacity — key 0 at 0s and 1 at 1s for a fade-in (enable Auto Play or scrub the timeline).
        </div>
      </div>
    </details>
  )
}

function MultiplayerSection() {
  const touch = useEditor((s) => s.touch)
  const [cfg, setCfg] = useState(() => loadMPSettings())
  const update = (patch: Partial<typeof cfg>) => {
    const next = { ...cfg, ...patch }
    setCfg(next)
    saveMPSettings(next)
    touch()
  }
  return (
    <details className="details-section">
      <summary>Multiplayer</summary>
      <div className="details-grid">
        <label className="field check">
          <span>Enabled</span>
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
        </label>
        <label className="field check">
          <span>Dedicated server mode</span>
          <input
            type="checkbox"
            checked={!!cfg.dedicatedServer}
            onChange={(e) => update({ dedicatedServer: e.target.checked })}
          />
        </label>
        <label className="field check">
          <span>Spectator mode</span>
          <input
            type="checkbox"
            checked={!!cfg.spectator}
            onChange={(e) => update({ spectator: e.target.checked })}
          />
        </label>
        <label className="field">
          <span>Lag compensation (ms)</span>
          <input
            type="number"
            min={0}
            max={500}
            value={cfg.lagCompensationMs ?? 120}
            onChange={(e) => update({ lagCompensationMs: parseInt(e.target.value, 10) || 0 })}
          />
        </label>
        <label className="field">
          <span>Interest radius (m)</span>
          <input
            type="number"
            min={0}
            max={500}
            value={cfg.interestRadius ?? 80}
            onChange={(e) => update({ interestRadius: parseFloat(e.target.value) || 0 })}
          />
        </label>
        <label className="field check">
          <span>Delta compression</span>
          <input
            type="checkbox"
            checked={cfg.deltaCompression !== false}
            onChange={(e) => update({ deltaCompression: e.target.checked })}
          />
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
          Run the relay: <code>node scripts/relay.mjs</code> — same room + Play shows ghost pawns.
          Enable Network on actors (Details) for property sync @ 10 Hz and spawner replication.
        </div>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          <strong>Dedicated server (LAN):</strong> on the host machine run <code>npm run dedicated</code>{' '}
          (optional <code>-- --port 24690 --room lan-party</code>). Clients set Relay URL to{' '}
          <code>ws://&lt;host-ip&gt;:24690</code> (Dedicated server URL), same room, leave{' '}
          <em>Dedicated server mode</em> off. Headless host id <code>000000</code> holds authority — no pawn uplink,
          client prediction disabled.
        </div>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          <strong>Ownership:</strong> empty owner = host authority. Assign a peer id (or Local) so that client
          may predict movement when <em>Client Predicted</em> is on; host still syncs @ 10 Hz and clients snap on large error.
        </div>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          Protocol: <code>join</code> · <code>pose</code>/<code>input</code> · <code>sync</code> · <code>spawn</code> · <code>despawn</code> · <code>own</code> · <code>lobby_join</code> · <code>lobby_ready</code> · <code>lobby_start</code> · <code>spectator_join</code> · <code>list_rooms</code> · <code>ping</code>/<code>pong</code> · <code>leave</code>
        </div>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          <strong>Lobby:</strong> <code>/mplobby</code> spawns a room browser + ready-up HUD; host relays <code>lobby_start</code> when all peers are ready (deathmatch spawns after).
        </div>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          <strong>Spectator (Wave 68):</strong> enable <em>Spectator mode</em> + <code>/mpspectator</code> — relays{' '}
          <code>spectator_join</code>, no pawn spawn or input uplink; orbit host (F) or free fly (WASD).
        </div>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          <strong>Matchmaking:</strong> relay broadcasts <code>room_registry</code>; <code>indie.mp.matchmaking.listRooms()</code> · <code>pingMs()</code> · <code>refreshRooms()</code> — lobby HUD shows public rooms + ping.
        </div>
      </div>
    </details>
  )
}

function AudioSection() {
  const touch = useEditor((s) => s.touch)
  useEditor((s) => s.sceneVersion)
  const setEditing = useEditor((s) => s.setEditingMetaSound)
  const metaSounds = listMetaSounds()
  const importedSounds = Object.keys(world.sounds)
  const setSoundAttenuation = (name: string, patch: Partial<import('../../engine/types').AttenuationSettings>) => {
    world.soundAttenuation[name] = { ...world.soundAttenuation[name], ...patch }
    setSoundAttenuationDefaults(world.soundAttenuation)
    touch()
  }
  return (
    <details className="details-section">
      <summary>Audio</summary>
      <div className="details-grid">
        {(['master', 'sfx', 'music'] as const).map((bus) => (
          <label className="field" key={bus}>
            <span>{bus}</span>
            <input type="range" min={0} max={1.5} step={0.05} defaultValue={1} onChange={(e) => setBusVolume(bus, parseFloat(e.target.value))} />
          </label>
        ))}
        <div className="panel-empty" style={{ padding: '2px 0' }}>Imported clips: api.playSound(name). Procedural graphs: api.playMetaSound(name).</div>
        {importedSounds.map((name) => (
          <details className="details-section" key={name} style={{ gridColumn: '1 / -1' }}>
            <summary>♫ {name} — attenuation</summary>
            <div className="details-grid">
              <AttenuationFields
                value={world.soundAttenuation[name] ?? {}}
                onChange={(patch) => setSoundAttenuation(name, patch)}
              />
            </div>
          </details>
        ))}
        {metaSounds.map((m) => (
          <label className="field" key={m.id} style={{ gridTemplateColumns: '1fr auto auto', display: 'grid', gap: 4 }}>
            <span>♪ {m.name}</span>
            <button onClick={() => setEditing(m.id)}>Edit</button>
            <button
              onClick={() => {
                deleteMetaSound(m.id)
                touch()
              }}
            >
              ✕
            </button>
          </label>
        ))}
        <button
          onClick={() => {
            const name = prompt('MetaSound name?')
            if (!name) return
            const asset = createMetaSound(name)
            setEditing(asset.id)
            touch()
          }}
        >
          + New MetaSound
        </button>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          Trigger volumes with a Reverb Preset apply ConvolverNode sends while the pawn is inside.
        </div>
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

function InputBindingsSection() {
  const touch = useEditor((s) => s.touch)
  const [, bump] = useState(0)
  const refresh = () => bump((n) => n + 1)
  const bindings = getBindings()
  const profiles = listInputProfiles()
  const activeProfile = getActiveInputProfile()
  const linkedHaptics = hapticPresetForProfile(activeProfile)
  const applyProfile = (name: string) => {
    const applied = applyInputProfile(name)
    if (!applied) return
    const hud = document.getElementById('lotus-touch-hud')
    if (hud) applyTouchLayoutPreset(hud, applied.touchLayoutPreset)
    refresh()
    touch()
  }
  return (
    <details className="details-section">
      <summary>Input Bindings (Gamepad + Touch)</summary>
      <div className="details-grid">
        <label className="field">
          <span>Input profile</span>
          <select value={activeProfile} onChange={(e) => applyProfile(e.target.value)}>
            {profiles.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        {linkedHaptics && (
          <div className="panel-empty" style={{ gridColumn: '1 / -1' }} data-lotus-linked-haptics>
            Linked haptics ({activeProfile}): {Math.round(linkedHaptics.hapticIntensity * 100)}% intensity
            {linkedHaptics.hapticBatterySaver ? ', battery saver on' : ', battery saver off'}
          </div>
        )}
        <div className="hud-widget-row" style={{ gridColumn: '1 / -1' }}>
          <button
            type="button"
            onClick={() => {
              const name = prompt('Save profile as…', 'my-profile')
              if (!name?.trim()) return
              if (saveInputProfile(name.trim())) {
                refresh()
                touch()
              } else {
                useEditor.getState().setStatus('Cannot save bundled profile names — pick a custom name')
              }
            }}
          >
            Save Profile
          </button>
          <button type="button" onClick={() => applyProfile(activeProfile)}>
            Load Profile
          </button>
        </div>
        <strong style={{ fontSize: 11, gridColumn: '1 / -1' }}>Gamepad face buttons</strong>
        {GAMEPAD_ACTIONS.map((action) => (
          <label className="field" key={action}>
            <span>{action}</span>
            <select
              value={bindings.gamepad[action]}
              onChange={(e) => {
                setGamepadButton(action, parseInt(e.target.value, 10))
                refresh()
              }}
            >
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i} value={i}>
                  Button {i}
                </option>
              ))}
            </select>
          </label>
        ))}
        <strong style={{ fontSize: 11, gridColumn: '1 / -1' }}>Touch action slots</strong>
        {TOUCH_ACTIONS.map((action) => (
          <label className="field" key={action}>
            <span>{action}</span>
            <select
              value={bindings.touch[action]}
              onChange={(e) => {
                setTouchSlot(action as TouchAction, e.target.value as import('../../engine/inputBindings').TouchSlotId)
                refresh()
              }}
            >
              {TOUCH_SLOT_IDS.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button
          type="button"
          onClick={() => {
            resetBindings()
            refresh()
          }}
        >
          Reset bindings to defaults
        </button>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          Profiles in <code>lotus-engine.inputProfiles</code> bundle bindings + touch layout + haptic preset.
          Bridge: <code>indie.input.applyProfile</code> · <code>saveProfile</code> · <code>loadProfile</code> ·{' '}
          <code>activeProfile</code> · <code>indie.haptics.applyFromProfile</code>
        </div>
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

function StreamingSection() {
  const touch = useEditor((s) => s.touch)
  const s = world.streaming

  const set = <K extends keyof typeof s>(key: K, value: (typeof s)[K]) => {
    world.streaming[key] = value
    touch()
  }

  return (
    <details className="details-section">
      <summary>World Streaming</summary>
      <div className="details-grid">
        <label className="field check">
          <span>Enabled</span>
          <input type="checkbox" checked={s.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        </label>
        <label className="field">
          <span>Grid Size (m)</span>
          <input
            type="number"
            min={8}
            max={512}
            step={8}
            value={s.gridSize}
            onChange={(e) => set('gridSize', Math.max(8, parseFloat(e.target.value) || 64))}
          />
        </label>
        <label className="field">
          <span>Load Radius (cells)</span>
          <input
            type="number"
            min={0}
            max={16}
            step={1}
            value={s.loadRadius}
            onChange={(e) => set('loadRadius', Math.max(0, parseInt(e.target.value, 10) || 0))}
          />
        </label>
        <label className="field check">
          <span>Export By Cell</span>
          <input type="checkbox" checked={s.exportByCell} onChange={(e) => set('exportByCell', e.target.checked)} />
        </label>
        <label className="field check">
          <span>Show Grid Overlay</span>
          <input
            type="checkbox"
            checked={consoleState.showStreaming}
            onChange={(e) => {
              consoleState.showStreaming = e.target.checked
              touch()
            }}
          />
        </label>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          Actors are assigned streamCell on save. Only cells within radius of the camera are visible during edit and play.
          Console: show streaming · Scripts: api.loadCell(cx, cz)
        </div>
      </div>
    </details>
  )
}

function LightingBakeSection() {
  const touch = useEditor((s) => s.touch)
  const [vertexStatus, setVertexStatus] = useState('No baked AO')
  const [mapStatus, setMapStatus] = useState('No AO map baked')
  const [mapSize, setMapSize] = useState(256)
  const [aoMapIntensity, setAoMapIntensity] = useState(1)

  return (
    <details className="details-section">
      <summary>Lighting (approx)</summary>
      <div className="details-grid">
        <button
          disabled={aoBaking || aoMapBaking}
          onClick={async () => {
            setVertexStatus('Baking AO (approx)…')
            const res = await bakeAO(world.actors, {
              samples: 16,
              radius: 1,
              onProgress: (_done, total, label) => {
                setVertexStatus(total > 0 ? label : 'Baking AO (approx)…')
              },
            })
            setVertexStatus(
              res.ok
                ? `Baked AO (approx): ${res.actorsBaked} actors, ${res.verticesProcessed} vertices`
                : `Bake failed: ${lastAOBakeError ?? 'unknown error'}`,
            )
            touch()
          }}
        >
          {aoBaking ? 'Baking AO (approx)…' : 'Bake AO (approx)'}
        </button>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          {vertexStatus}
          {aoBaking && aoBakeProgress.total > 0
            ? ` · ${aoBakeProgress.done}/${aoBakeProgress.total} verts`
            : ''}
        </div>
        <label className="field">
          <span>AO Map Size</span>
          <input
            type="number"
            min={64}
            max={1024}
            step={64}
            value={mapSize}
            onChange={(e) => setMapSize(Math.max(64, Math.min(1024, parseInt(e.target.value, 10) || 256)))}
          />
        </label>
        <label className="field">
          <span>AO Map Intensity</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={aoMapIntensity}
            onChange={(e) => setAoMapIntensity(parseFloat(e.target.value))}
          />
        </label>
        <button
          disabled={aoBaking || aoMapBaking}
          onClick={async () => {
            setMapStatus('AO Map Bake (UV2, approx)…')
            const res = await bakeAOMapUV2(world.actors, {
              samples: 16,
              radius: 1,
              mapSize,
              aoMapIntensity,
              onProgress: (_done, total, label) => {
                setMapStatus(total > 0 ? label : 'AO Map Bake (UV2, approx)…')
              },
            })
            const warn =
              res.warnings?.length && res.ok
                ? ` · ${res.uv2AutoGenerated} uv2 auto-generated`
                : ''
            setMapStatus(
              res.ok
                ? `AO Map Bake (UV2, approx): ${res.meshesBaked} meshes, ${res.verticesProcessed} verts${warn}`
                : `Bake failed: ${lastAOMapBakeError ?? 'unknown error'}`,
            )
            touch()
          }}
        >
          {aoMapBaking ? 'Baking AO Map (UV2)…' : 'Bake AO Map (UV2)'}
        </button>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          {mapStatus}
          {aoMapBaking && aoMapBakeProgress.total > 0
            ? ` · ${aoMapBakeProgress.done}/${aoMapBakeProgress.total} verts`
            : ''}
        </div>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          Vertex bake: hemisphere raycast into vertex colors. UV2 bake: splats AO into aoMap on uv2 (box projection if missing) — not Lightmass.
          Console: build ao · build ao map · vektra.BakeAO() · vektra.BakeAOMapUV2()
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
        <div className="panel-empty" style={{ padding: '2px 0', gridColumn: '1 / -1' }}>
          DetourCrowd avoidance (Wave 11): bake navmesh, then <code>api.crowdSpawn(id, pos, target)</code> during Play.
        </div>
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

function LinkedLevelsSection() {
  const touch = useEditor((s) => s.touch)
  useEditor((s) => s.sceneVersion)
  const links = world.levelLinks

  const importLevel = (index: number) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.vlevel.json,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const level = JSON.parse(await file.text()) as SerializedLevel
        if (level.engine !== 'vektra') throw new Error('Not a Vektra level')
        links[index].level = level
        touch()
      } catch (err) {
        useEditor.getState().setStatus(`Import failed: ${(err as Error).message}`)
      }
    }
    input.click()
  }

  return (
    <details className="details-section">
      <summary>Linked Levels</summary>
      <div className="details-grid">
        {links.map((link, i) => (
          <div className="hud-widget-row" key={`${link.name}-${i}`}>
            <input
              value={link.name}
              placeholder="key (e.g. dungeon)"
              spellCheck={false}
              onChange={(e) => {
                link.name = e.target.value
                touch()
              }}
            />
            <span className="panel-empty" style={{ padding: 0, fontSize: 11 }}>
              {link.level.actors?.length ?? 0} actors · key: {sanitizeLevelKey(link.name) || '…'}
            </span>
            <button type="button" onClick={() => importLevel(i)} title="Import .vlevel.json">
              Import
            </button>
            <button
              type="button"
              onClick={() => {
                links.splice(i, 1)
                touch()
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            const name = prompt('Linked level key? (used by api.loadLevel)', 'dungeon')
            if (!name?.trim()) return
            links.push({
              name: name.trim(),
              level: {
                engine: 'vektra',
                version: 4,
                name: name.trim(),
                environment: { ...world.environment },
                actors: [],
              },
            })
            touch()
          }}
        >
          + Add Linked Level
        </button>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          Bundled into playable export as <code>window.__LOTUS_LEVELS__</code>. Scripts: <code>api.loadLevel('dungeon')</code>.
          Tag actors <code>Autoload</code> to persist across switches.
        </div>
      </div>
    </details>
  )
}

function AbilitiesLibrarySection() {
  const [, bump] = useState(0)
  const refresh = () => bump((n) => n + 1)
  const sets = listAttributeSets()
  const abilities = listAbilities()
  const effects = listEffects()

  const updateSet = (set: AttributeSet) => {
    saveAttributeSet(set)
    refresh()
  }

  const updateAbility = (ability: Ability) => {
    saveAbility(ability)
    refresh()
  }

  const updateEffect = (effect: GameplayEffect) => {
    saveEffect(effect)
    refresh()
  }

  return (
    <details className="details-section">
      <summary>Gameplay Abilities (GAS-lite)</summary>
      <div className="details-grid">
        <div className="panel-empty" style={{ padding: '2px 0' }}>Attribute sets + ability assets (localStorage). Actors assign sets/abilities in Details.</div>
        <strong style={{ fontSize: 11 }}>Attribute Sets</strong>
        {sets.map((set) => (
          <div key={set.id} className="hud-widget-row">
            <input
              value={set.name}
              onChange={(e) => updateSet({ ...set, name: e.target.value })}
              spellCheck={false}
            />
            <input
              value={JSON.stringify(set.attributes)}
              title="JSON attribute defaults"
              spellCheck={false}
              onBlur={(e) => {
                try {
                  updateSet({ ...set, attributes: JSON.parse(e.target.value) as Record<string, number> })
                } catch { /* keep prior */ }
              }}
            />
            {set.id !== 'default' && (
              <button onClick={() => { deleteAttributeSet(set.id); refresh() }}>✕</button>
            )}
          </div>
        ))}
        <button
          onClick={() => {
            const id = nextAttributeSetId()
            updateSet({ id, name: 'New Set', attributes: { Health: 100, Mana: 50, Stamina: 100 } })
          }}
        >
          + Attribute Set
        </button>
        <strong style={{ fontSize: 11 }}>Abilities</strong>
        {abilities.map((abil) => (
          <div key={abil.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
            <div className="hud-widget-row">
              <input
                value={abil.name}
                placeholder="Name"
                onChange={(e) => updateAbility({ ...abil, name: e.target.value })}
                spellCheck={false}
              />
              <input
                type="number"
                step={0.1}
                min={0}
                value={abil.cooldownSeconds}
                title="Cooldown (s)"
                onChange={(e) => updateAbility({ ...abil, cooldownSeconds: parseFloat(e.target.value) || 0 })}
              />
              <button onClick={() => { deleteAbility(abil.id); refresh() }}>✕</button>
            </div>
            <div className="hud-widget-row">
              <input
                value={abil.costAttribute ?? ''}
                placeholder="Cost attr"
                onChange={(e) => updateAbility({ ...abil, costAttribute: e.target.value || undefined })}
                spellCheck={false}
              />
              <input
                type="number"
                step={1}
                min={0}
                value={abil.costAmount ?? 0}
                placeholder="Cost"
                onChange={(e) => updateAbility({ ...abil, costAmount: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <input
              value={(abil.tagsRequired ?? []).join(', ')}
              placeholder="Tags required"
              spellCheck={false}
              onBlur={(e) =>
                updateAbility({
                  ...abil,
                  tagsRequired: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                })
              }
            />
            <input
              value={(abil.tagsBlocked ?? []).join(', ')}
              placeholder="Tags blocked"
              spellCheck={false}
              onBlur={(e) =>
                updateAbility({
                  ...abil,
                  tagsBlocked: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                })
              }
            />
            <textarea
              value={abil.onActivate}
              placeholder="function onActivate(api, actor) { api.log('Fired!') }"
              rows={3}
              spellCheck={false}
              onChange={(e) => updateAbility({ ...abil, onActivate: e.target.value })}
              style={{ fontFamily: 'monospace', fontSize: 11 }}
            />
          </div>
        ))}
        <button
          onClick={() => {
            const id = nextAbilityId()
            updateAbility({
              id,
              name: 'NewAbility',
              cooldownSeconds: 1,
              onActivate: "function onActivate(api, actor) {\n  api.log(actor.name + ' used ability')\n}",
            })
          }}
        >
          + Ability
        </button>
        <strong style={{ fontSize: 11 }}>Gameplay Effects</strong>
        {effects.map((eff) => (
          <div key={eff.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
            <div className="hud-widget-row">
              <input
                value={eff.name}
                placeholder="Name"
                onChange={(e) => updateEffect({ ...eff, name: e.target.value })}
                spellCheck={false}
              />
              <input
                type="number"
                step={0.1}
                min={0}
                value={eff.duration}
                title="Duration (s) — 0 = instant"
                onChange={(e) => updateEffect({ ...eff, duration: parseFloat(e.target.value) || 0 })}
              />
              <button onClick={() => { deleteEffect(eff.id); refresh() }}>✕</button>
            </div>
            <input
              value={JSON.stringify(eff.modifiers)}
              title='[{"attribute":"Health","op":"add","value":-5}]'
              spellCheck={false}
              onBlur={(e) => {
                try {
                  updateEffect({ ...eff, modifiers: JSON.parse(e.target.value) as GameplayEffect['modifiers'] })
                } catch { /* keep prior */ }
              }}
            />
            <input
              value={(eff.tagsGranted ?? []).join(', ')}
              placeholder="Tags granted"
              spellCheck={false}
              onBlur={(e) =>
                updateEffect({
                  ...eff,
                  tagsGranted: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                })
              }
            />
            <input
              value={(eff.tagsRemoved ?? []).join(', ')}
              placeholder="Tags removed"
              spellCheck={false}
              onBlur={(e) =>
                updateEffect({
                  ...eff,
                  tagsRemoved: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                })
              }
            />
            <div className="panel-empty" style={{ padding: 0, fontSize: 10 }}>
              Modifiers: add = per-second delta · multiply = applied on start, reverted on expiry
            </div>
          </div>
        ))}
        <button
          onClick={() => {
            const id = nextEffectId()
            updateEffect({
              id,
              name: 'NewEffect',
              duration: 3,
              modifiers: [{ attribute: 'Health', op: 'add' as EffectModifierOp, value: -1 }],
            })
          }}
        >
          + Effect
        </button>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          Scripts: api.activateAbility('Fireball') · api.applyEffect('Poison') · api.removeEffect('Poison') · api.getAttribute('Health')
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
        <label className="field">
          <span>Niagara backend</span>
          <select
            value={env.particleBackend ?? 'cpu'}
            onChange={(e) => set('particleBackend', e.target.value as 'cpu' | 'gpu')}
          >
            <option value="cpu">CPU (WebGL)</option>
            <option value="gpu">GPU (opt-in WebGPU)</option>
          </select>
        </label>
        <label className="field">
          <span>Material preview backend</span>
          <select
            value={env.materialBackend ?? 'glsl'}
            onChange={(e) => set('materialBackend', e.target.value as 'glsl' | 'tsl')}
          >
            <option value="glsl">GLSL (default)</option>
            <option value="tsl">TSL (preview)</option>
          </select>
        </label>
        <label className="field">
          <span>Physics tick rate (Hz)</span>
          <input
            type="number"
            min={30}
            max={120}
            step={1}
            value={env.fixedPhysicsHz ?? 60}
            onChange={(e) => set('fixedPhysicsHz', parseInt(e.target.value, 10) || 60)}
          />
        </label>
        <label className="field">
          <span>Rendering backend</span>
          <select
            value={env.renderBackend ?? 'webgl'}
            onChange={(e) => set('renderBackend', e.target.value as 'webgl' | 'webgpu')}
          >
            <option value="webgl">WebGL (default)</option>
            <option value="webgpu">WebGPU quality tier</option>
          </select>
        </label>
        <label className="field check">
          <span>Post FXAA</span>
          <input type="checkbox" checked={env.postFxaa !== false} onChange={(e) => set('postFxaa', e.target.checked)} />
        </label>
        <label className="field check">
          <span>Post SSAO</span>
          <input type="checkbox" checked={!!env.postSsao} onChange={(e) => set('postSsao', e.target.checked)} />
        </label>
        <label className="field check">
          <span>Post SSR (approx)</span>
          <input type="checkbox" checked={!!env.postSsr} onChange={(e) => set('postSsr', e.target.checked)} />
        </label>
        {env.postSsr && (
          <label className="field">
            <span>SSR quality preset</span>
            <select
              value={env.postSsrPreset ?? 'medium'}
              onChange={(e) => set('postSsrPreset', e.target.value as 'off' | 'low' | 'medium' | 'high')}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        )}
        {env.postSsr && (
          <label className="field check">
            <span>SSR ground reflector</span>
            <input type="checkbox" checked={!!env.postSsrGround} onChange={(e) => set('postSsrGround', e.target.checked)} />
          </label>
        )}
        <label className="field check">
          <span>Post SSGI (WebGPU opt-in)</span>
          <input type="checkbox" checked={!!env.postSsgi} onChange={(e) => set('postSsgi', e.target.checked)} />
        </label>
        {(env.postSsgi || env.renderBackend === 'webgpu') && (
          <label className="field">
            <span>SSGI quality preset</span>
            <select
              value={env.postSsgiPreset ?? 'off'}
              onChange={(e) => set('postSsgiPreset', e.target.value as 'off' | 'low' | 'medium' | 'high')}
            >
              <option value="off">Off</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        )}
        <label className="field check">
          <span>LightProbeGrid GI (approx)</span>
          <input type="checkbox" checked={!!env.lightProbeGrid} onChange={(e) => set('lightProbeGrid', e.target.checked)} />
        </label>
        <label className="field check">
          <span>Post TAA (WebGPU tier)</span>
          <input type="checkbox" checked={!!env.postTaa} onChange={(e) => set('postTaa', e.target.checked)} />
        </label>
        <label className="field check">
          <span>Post DOF</span>
          <input type="checkbox" checked={!!env.postDof} onChange={(e) => set('postDof', e.target.checked)} />
        </label>
        {env.postDof && (
          <>
            <label className="field">
              <span>DOF focus distance (TSL)</span>
              <input
                type="range"
                min={1}
                max={20}
                step={0.5}
                value={env.postDofFocusDistance ?? 5}
                onChange={(e) => set('postDofFocusDistance', parseFloat(e.target.value))}
              />
              <em>{(env.postDofFocusDistance ?? 5).toFixed(1)}m</em>
            </label>
            <label className="field">
              <span>DOF focal length (TSL)</span>
              <input
                type="range"
                min={0.5}
                max={8}
                step={0.25}
                value={env.postDofFocalLength ?? 2}
                onChange={(e) => set('postDofFocalLength', parseFloat(e.target.value))}
              />
              <em>{(env.postDofFocalLength ?? 2).toFixed(2)}m</em>
            </label>
            <label className="field">
              <span>DOF bokeh scale</span>
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.1}
                value={env.postDofBokehScale ?? 1.2}
                onChange={(e) => set('postDofBokehScale', parseFloat(e.target.value))}
              />
              <em>{(env.postDofBokehScale ?? 1.2).toFixed(1)}</em>
            </label>
            <label className="field">
              <span>DOF vignette focus (WebGL)</span>
              <input
                type="range"
                min={0.1}
                max={0.8}
                step={0.01}
                value={env.postDofFocus ?? 0.45}
                onChange={(e) => set('postDofFocus', parseFloat(e.target.value))}
              />
            </label>
            <label className="field">
              <span>DOF vignette aperture (WebGL)</span>
              <input
                type="range"
                min={0.01}
                max={0.15}
                step={0.005}
                value={env.postDofAperture ?? 0.035}
                onChange={(e) => set('postDofAperture', parseFloat(e.target.value))}
              />
            </label>
          </>
        )}
        <div className="field grading-preset-field">
          <span>Color grading preset</span>
          <div className="grading-preset-grid" role="radiogroup" aria-label="Color grading preset">
            <button
              type="button"
              className={`grading-preset-thumb${(env.postColorGradingPreset ?? 'off') === 'off' ? ' active' : ''}`}
              title="Off — manual lift/gamma/gain sliders"
              onClick={() => set('postColorGradingPreset', 'off')}
            >
              <span className="grading-preset-swatch" style={{ background: 'linear-gradient(135deg, #2a3038, #4a5058)' }} />
              <em>Off</em>
            </button>
            {COLOR_GRADING_PRESET_IDS.map((id) => {
              const meta = COLOR_GRADING_PRESET_THUMBNAILS[id]
              const active = env.postColorGradingPreset === id
              const acesOn = env.postPresetAces?.[id] ?? env.postAces ?? false
              return (
                <div key={id} className={`grading-preset-card${active ? ' active' : ''}`}>
                  <button
                    type="button"
                    className="grading-preset-thumb"
                    title={meta.label}
                    onClick={() => {
                      set('postColorGradingPreset', id)
                      set('postColorGrading', true)
                    }}
                  >
                    <span className="grading-preset-swatch" style={{ background: meta.gradient }} />
                    <em>{meta.label}</em>
                  </button>
                  <label className="grading-preset-aces" title={`ACES tonemap for ${meta.label}`}>
                    <input
                      type="checkbox"
                      checked={acesOn}
                      onChange={(e) => {
                        const next = { ...(env.postPresetAces ?? {}) }
                        next[id] = e.target.checked
                        set('postPresetAces', next)
                      }}
                    />
                    ACES
                  </label>
                </div>
              )
            })}
          </div>
        </div>
        <label className="field check">
          <span>Color grading (lift/gamma/gain)</span>
          <input type="checkbox" checked={!!env.postColorGrading} onChange={(e) => set('postColorGrading', e.target.checked)} />
        </label>
        <label className="field check">
          <span>ACES tonemap global (manual / off preset)</span>
          <input type="checkbox" checked={!!env.postAces} onChange={(e) => set('postAces', e.target.checked)} />
        </label>
        <label className="field">
          <span>Grading LUT (.cube / .3dl / .png)</span>
          <input
            type="file"
            accept=".cube,.3dl,.png,.jpg,.jpeg"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (!f) return
              const lower = f.name.toLowerCase()
              if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
                const img = new Image()
                img.onload = () => {
                  const canvas = document.createElement('canvas')
                  canvas.width = img.width
                  canvas.height = img.height
                  const ctx = canvas.getContext('2d')
                  if (!ctx) return
                  ctx.drawImage(img, 0, 0)
                  const pixels = ctx.getImageData(0, 0, img.width, img.height).data
                  const decoded = decodePngLUTAtlas(pixels, img.width, img.height)
                  if (decoded) {
                    persistDecodedLUTToEnvironment(env, f.name, decoded)
                    touch()
                    useEditor.getState().setStatus(`LUT atlas: ${f.name} (${decoded.size}³, png)`)
                  } else {
                    useEditor.getState().setStatus(`LUT decode failed: ${f.name}`)
                  }
                }
                img.src = URL.createObjectURL(f)
                return
              }
              void f.text().then((text) => {
                const decoded = decodeGradingLUTFile(f.name, text)
                if (decoded) {
                  persistDecodedLUTToEnvironment(env, f.name, decoded)
                  touch()
                  useEditor.getState().setStatus(`LUT decoded: ${f.name} (${decoded.size}³, ${decoded.format})`)
                } else {
                  useEditor.getState().setStatus(`LUT decode failed: ${f.name}`)
                }
              })
            }}
          />
          {env.postGradingLutName && (
            <em>
              {env.postGradingLutName}
              {env.postGradingLutSize ? ` · ${env.postGradingLutSize}³` : ''}
            </em>
          )}
        </label>
        {env.postGradingLutName && (
          <label className="field">
            <span>LUT strength</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={env.postGradingLutStrength ?? 1}
              onChange={(e) => set('postGradingLutStrength', parseFloat(e.target.value))}
            />
            <em>{((env.postGradingLutStrength ?? 1) * 100).toFixed(0)}%</em>
          </label>
        )}
        <div className="field grading-compare-field">
          <span>Preset A/B compare</span>
          <div className="grading-compare-row">
            <select
              value={env.postGradingCompareA ?? env.postColorGradingPreset ?? 'cinematic'}
              onChange={(e) =>
                set('postGradingCompareA', e.target.value as 'neutral' | 'cinematic' | 'highContrast')
              }
            >
              {COLOR_GRADING_PRESET_IDS.map((id) => (
                <option key={id} value={id}>
                  {COLOR_GRADING_PRESET_THUMBNAILS[id].label}
                </option>
              ))}
            </select>
            <select
              value={env.postGradingCompareB ?? 'neutral'}
              onChange={(e) =>
                set('postGradingCompareB', e.target.value as 'neutral' | 'cinematic' | 'highContrast')
              }
            >
              {COLOR_GRADING_PRESET_IDS.map((id) => (
                <option key={id} value={id}>
                  {COLOR_GRADING_PRESET_THUMBNAILS[id].label}
                </option>
              ))}
            </select>
          </div>
          <label className="field">
            <span>Blend A → B</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={env.postGradingCompareT ?? 0}
              onChange={(e) => set('postGradingCompareT', parseFloat(e.target.value))}
            />
            <em>{((env.postGradingCompareT ?? 0) * 100).toFixed(0)}%</em>
          </label>
        </div>
        {env.postColorGrading && (
          <>
            <label className="field">
              <span>Gain R</span>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.05}
                value={env.postGain?.[0] ?? 1}
                onChange={(e) => set('postGain', [parseFloat(e.target.value), env.postGain?.[1] ?? 1, env.postGain?.[2] ?? 1])}
              />
            </label>
            <label className="field">
              <span>Lift R</span>
              <input
                type="range"
                min={-0.2}
                max={0.2}
                step={0.01}
                value={env.postLift?.[0] ?? 0}
                onChange={(e) => set('postLift', [parseFloat(e.target.value), env.postLift?.[1] ?? 0, env.postLift?.[2] ?? 0])}
              />
            </label>
          </>
        )}
        <label className="field check">
          <span>Rapier move_and_slide pawn</span>
          <input
            type="checkbox"
            checked={env.useRapierCharacter !== false}
            onChange={(e) => set('useRapierCharacter', e.target.checked)}
          />
        </label>
        <label className="field check">
          <span>Rapier raycast vehicle</span>
          <input
            type="checkbox"
            checked={!!env.useRaycastVehicle}
            onChange={(e) => set('useRaycastVehicle', e.target.checked)}
          />
        </label>
        <label className="field check" title="On-screen left stick + jump during Play and mobile export (auto on touch devices)">
          <span>Touch controls</span>
          <input
            type="checkbox"
            checked={env.touchControls !== false}
            onChange={(e) => set('touchControls', e.target.checked)}
          />
        </label>
        <label className="field check" title="Short vibration on Fire / Interact / Jump (PWA Vibration API on supported devices)">
          <span>Touch haptics</span>
          <input
            type="checkbox"
            checked={env.touchHaptics !== false}
            onChange={(e) => set('touchHaptics', e.target.checked)}
          />
        </label>
        {env.touchControls !== false && (
          <label className="field" title="Joystick + action button positions for touch HUD (editor PIE + export)">
            <span>Touch layout preset</span>
            <select
              value={env.touchLayoutPreset ?? 'compact'}
              onChange={(e) => set('touchLayoutPreset', e.target.value as 'compact' | 'wide' | 'fps')}
            >
              {TOUCH_LAYOUT_PRESET_IDS.map((id) => (
                <option key={id} value={id}>
                  {TOUCH_LAYOUT_PRESET_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field check" title="Gamepad left stick + A/Y/X face buttons during Play and export (auto when a pad is connected)">
          <span>Gamepad controls</span>
          <input
            type="checkbox"
            checked={env.gamepadControls !== false}
            onChange={(e) => set('gamepadControls', e.target.checked)}
          />
        </label>
        <label className="field check" title="Dual-rumble on Fire / Interact when the pad supports Gamepad Haptic Actuators">
          <span>Gamepad haptics</span>
          <input
            type="checkbox"
            checked={env.gamepadHaptics !== false}
            onChange={(e) => set('gamepadHaptics', e.target.checked)}
          />
        </label>
        <label className="field" title="Master rumble strength for touch + gamepad haptics (Wave 74)">
          <span>Haptic intensity</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round((env.hapticIntensity ?? 1) * 100)}
            onChange={(e) => set('hapticIntensity', parseInt(e.target.value, 10) / 100)}
          />
          <em>{Math.round((env.hapticIntensity ?? 1) * 100)}%</em>
        </label>
        <label
          className="field check"
          title="Halve rumble when navigator.getBattery reports device is not charging"
        >
          <span>Haptic battery saver</span>
          <input
            type="checkbox"
            checked={env.hapticBatterySaver !== false}
            onChange={(e) => set('hapticBatterySaver', e.target.checked)}
          />
        </label>
        <label className="field check">
          <span>Export batch static meshes</span>
          <input
            type="checkbox"
            checked={!!env.exportBatchStatic}
            onChange={(e) => set('exportBatchStatic', e.target.checked)}
          />
        </label>
        <label className="field check" title="localStorage checkpoints in PIE + playable export (__LOTUS_SAVES__)">
          <span>Save slots (localStorage)</span>
          <input
            type="checkbox"
            checked={!!env.saveSlotsEnabled}
            onChange={(e) => set('saveSlotsEnabled', e.target.checked)}
          />
        </label>
        <label
          className="field check"
          title="IndexedDB backup when saving checkpoints (__LOTUS_CLOUD_SAVES__)"
        >
          <span>Cloud save backup (IndexedDB)</span>
          <input
            type="checkbox"
            checked={!!env.cloudSaveBackup}
            onChange={(e) => set('cloudSaveBackup', e.target.checked)}
          />
        </label>
        <label
          className="field check"
          title="Carry save slots across api.changeScene / api.loadLevel (__LOTUS_CROSS_LEVEL_SAVES__)"
        >
          <span>Cross-level saves</span>
          <input
            type="checkbox"
            checked={!!env.crossLevelSaves}
            onChange={(e) => set('crossLevelSaves', e.target.checked)}
            disabled={!env.saveSlotsEnabled}
          />
        </label>
        {env.saveSlotsEnabled && (
          <div className="panel-empty" style={{ padding: '2px 0' }}>
            Scripts: <code>api.saveGame('slot1', data)</code> · <code>api.loadGame('slot1')</code> ·{' '}
            <code>api.listSaveSlots()</code> — keys{' '}
            <code>
              lotus-engine.saves.{env.crossLevelSaves ? '__global__' : '{level}'}.{'{slot}'}
            </code>
            {env.cloudSaveBackup && (
              <>
                {' '}
                · cloud keys <code>lotus-engine.cloud.{'{level}'}.{'{slot}'}</code>
              </>
            )}
          </div>
        )}
        {env.saveSlotsEnabled && env.cloudSaveBackup && (
          <div className="panel-empty" style={{ padding: '2px 0' }} data-lotus-cloud-sync-hint>
            Cross-device cloud sync stub — Escape save menu or copy manifest token for QR / another browser.{' '}
            <button
              type="button"
              onClick={() => {
                setSaveContext({
                  levelName: world.levelName,
                  enabled: true,
                  cloudBackup: true,
                  crossLevelSaves: env.crossLevelSaves === true,
                })
                void exportCloudSaveManifest().then((manifest) => {
                  void navigator.clipboard?.writeText(manifest.crossDeviceHint).catch(() => {})
                  useEditor.getState().setStatus('Cloud save manifest copied (cross-device hint)')
                })
              }}
            >
              Copy cloud save manifest
            </button>
          </div>
        )}
      </div>
      <LinkedLevelsSection />
      <StreamingSection />
      <LightingBakeSection />
      <NavigationSection />
      <InputMapSection />
      <InputBindingsSection />
      <DataAssetsSection />
      <AudioSection />
      <MultiplayerSection />
      <HudDesignerSection />
      <AbilitiesLibrarySection />
    </details>
  )
}
