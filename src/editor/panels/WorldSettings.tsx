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
import { aoBakeProgress, aoBaking, bakeAO, lastAOBakeError } from '../../engine/lightmapBake'
import { bakeNavMesh, isRecastNavReady, lastBakeError, navMeshBaking, navMeshReady } from '../../engine/nav'
import { sanitizeLevelKey, world } from '../../engine/World'
import type { SerializedLevel } from '../../engine/types'
import { consoleState } from '../consoleCommands'
import { loadInputMap, saveInputMap, type InputAction } from '../../engine/inputActions'
import { setBusVolume, setSoundAttenuationDefaults } from '../../engine/audio'
import { AttenuationFields } from './AttenuationFields'
import { createMetaSound, deleteMetaSound, listMetaSounds } from '../../engine/metaSoundAssets'
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
          <strong>Ownership:</strong> empty owner = host authority. Assign a peer id (or Local) so that client
          may predict movement when <em>Client Predicted</em> is on; host still syncs @ 10 Hz and clients snap on large error.
        </div>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          Protocol: <code>join</code> · <code>pose</code>/<code>input</code> · <code>sync</code> · <code>spawn</code> · <code>despawn</code> · <code>own</code> · <code>leave</code>
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
  const [status, setStatus] = useState('No baked AO')

  return (
    <details className="details-section">
      <summary>Lighting (approx)</summary>
      <div className="details-grid">
        <button
          disabled={aoBaking}
          onClick={async () => {
            setStatus('Baking AO (approx)…')
            const res = await bakeAO(world.actors, {
              samples: 16,
              radius: 1,
              onProgress: (_done, total, label) => {
                setStatus(total > 0 ? label : 'Baking AO (approx)…')
              },
            })
            setStatus(
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
          {status}
          {aoBaking && aoBakeProgress.total > 0
            ? ` · ${aoBakeProgress.done}/${aoBakeProgress.total} verts`
            : ''}
        </div>
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          Hemisphere raycast AO into vertex colors on static meshes — not Lightmass. Console: build ao · vektra.BakeAO()
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
          Bundled into playable export as <code>window.__VEKTRA_LEVELS__</code>. Scripts: <code>api.loadLevel('dungeon')</code>.
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
      </div>
      <LinkedLevelsSection />
      <StreamingSection />
      <LightingBakeSection />
      <NavigationSection />
      <InputMapSection />
      <DataAssetsSection />
      <AudioSection />
      <MultiplayerSection />
      <HudDesignerSection />
      <AbilitiesLibrarySection />
    </details>
  )
}
