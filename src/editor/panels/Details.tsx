import { useRef } from 'react'
import * as THREE from 'three'
import type { Actor } from '../../engine/Actor'
import { applyMaterialProps, rebuildLabel3D, rebuildRayCastVisual } from '../../engine/factory'
import { rebuildPath3DVisual } from '../../engine/path3d'
import { syncWidget3D } from '../../engine/widget3d'
import {
  applyActorMaterial,
  getEffectiveMaterialGraph,
  getMaterial,
  saveMaterialFromProps,
} from '../../engine/materialAssets'
import { applyLightProps, world } from '../../engine/World'
import { listMetaSounds } from '../../engine/metaSoundAssets'
import type {
  Behavior,
  CameraProps,
  IKChain,
  IKTarget,
  Label3DProps,
  LookAtTarget,
  MaterialProps,
  Mobility,
  PathFollowProps,
  PostProcessProps,
  RayCastProps,
  Area3DProps,
  ReverbPreset,
  SoundEmitterProps,
  TimerProps,
  TransformSnapshot,
  TriggerProps,
  Widget3DProps,
} from '../../engine/types'
import { AttenuationFields } from './AttenuationFields'
import { DEFAULT_MATERIAL } from '../../engine/types'
import { PropertyCommand, RevertPrefabOverrideCommand, TransformCommand, runCommand } from '../commands'
import { patchMaterialOverrides, revertMaterialOverride } from '../materialCommands'
import {
  getPrefabDefaultValue,
  getPrefabInstanceRoot,
  getPrefabOverrideDiff,
  isPrefabInstanceActor,
  listPrefabSubtree,
  revertAllPrefabOverrides,
  runPrefabAwareCommand,
  summarizePrefabOverrides,
} from '../prefabs'
import { buildFoliageMesh } from '../../engine/factory'
import {
  ATLAS_PALETTE,
  AUTOTILE_ATLAS_SIZE,
  DEFAULT_ATLAS_COLS,
  DEFAULT_ATLAS_ROWS,
  atlasUvRect,
} from '../../engine/autotileAtlas'
import {
  getTileMap,
  importAtlasSheet,
  listAtlasSheets,
  setTileMapSlot,
} from '../../engine/autotileSheetImport'
import {
  activeGridLayerIndex,
  getLayerCellCount,
  isGridLayerVisible,
  setGridLayerVisible,
  syncGridInstancesFromLayers,
} from '../../engine/gridMap'
import {
  getLayerCollisionGroup,
  maskFromRapierGroup,
  membershipFromRapierGroup,
  rapierGroupsFromLayerMask,
  rebuildFoliageColliders,
  setLayerCollisionGroup,
} from '../../engine/gridCollisionLayers'
import {
  getNavmeshLayerMask,
  isLayerInNavmeshMask,
  setNavmeshLayerMask,
} from '../../engine/gridNavmeshBake'
import { buildLandscapeMesh, syncLandscapeColors, syncLandscapeHeights } from '../../engine/landscape'
import { buildWaterMesh } from '../../engine/water'
import { regeneratePCG } from '../../engine/pcg'
import { collectAnimParams } from '../../engine/animStateMachine'
import { getChainBoneLabels, hasActorSkeleton } from '../../engine/ik'
import { getActorActiveEffects, getActorAttributes, listAbilities, listAttributeSets } from '../../engine/gameplayAbilities'
import { mpConnected, mpEnabled, mpIsHost, mpKnownPeerIds, mpLocalId, mpNotifyOwnership } from '../../engine/multiplayer'
import { clampExportRange, parseExports } from '../../engine/scripting'
import { savePrefab } from '../prefabs'
import { useEditor } from '../store'
import { WorldSettings } from './WorldSettings'

/**
 * Number field with commit-on-blur undo semantics: edits apply live for
 * immediate viewport feedback, but only one undo entry lands per edit session.
 */
function Num({
  label,
  value,
  step = 0.1,
  min,
  max,
  onLive,
  onCommit,
  defaultValue,
  prefabRevert,
  onRevert,
}: {
  label: string
  value: number
  step?: number
  min?: number
  max?: number
  onLive: (v: number) => void
  onCommit: (before: number, after: number) => void
  defaultValue?: number
  prefabRevert?: { actorId: string; fieldPath: string }
  onRevert?: () => void
}) {
  const before = useRef(value)
  const modified = defaultValue !== undefined && Math.abs(value - defaultValue) > 1e-6
  const revert = () => {
    if (onRevert) {
      onRevert()
      return
    }
    if (prefabRevert) {
      runCommand(new RevertPrefabOverrideCommand(prefabRevert.actorId, prefabRevert.fieldPath))
      return
    }
    onLive(defaultValue!)
    onCommit(value, defaultValue!)
  }
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={Number.isFinite(value) ? Number(value.toFixed(4)) : 0}
        onFocus={() => (before.current = value)}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (Number.isFinite(v)) onLive(v)
        }}
        onBlur={(e) => {
          const v = parseFloat(e.target.value)
          if (Number.isFinite(v) && v !== before.current) onCommit(before.current, v)
        }}
      />
      {modified && (
        <button className="reset-default" title={prefabRevert ? 'Revert prefab override' : `Reset to ${defaultValue}`} onClick={(e) => { e.preventDefault(); revert() }}>
          ⟲
        </button>
      )}
    </label>
  )
}

function ColorField({
  label,
  value,
  onLive,
  onCommit,
  defaultValue,
  prefabRevert,
  onRevert,
}: {
  label: string
  value: string
  onLive: (v: string) => void
  onCommit: (before: string, after: string) => void
  defaultValue?: string
  prefabRevert?: { actorId: string; fieldPath: string }
  onRevert?: () => void
}) {
  const before = useRef(value)
  const modified = defaultValue !== undefined && value.toLowerCase() !== defaultValue.toLowerCase()
  const revert = () => {
    if (onRevert) {
      onRevert()
      return
    }
    if (prefabRevert) {
      runCommand(new RevertPrefabOverrideCommand(prefabRevert.actorId, prefabRevert.fieldPath))
      return
    }
    onLive(defaultValue!)
    onCommit(value, defaultValue!)
  }
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="color"
        value={value}
        onFocus={() => (before.current = value)}
        onChange={(e) => onLive(e.target.value)}
        onBlur={(e) => {
          if (e.target.value !== before.current) onCommit(before.current, e.target.value)
        }}
      />
      {modified && (
        <button className="reset-default" title={prefabRevert ? 'Revert prefab override' : `Reset to ${defaultValue}`} onClick={(e) => { e.preventDefault(); revert() }}>
          ⟲
        </button>
      )}
    </label>
  )
}

function Check({
  label,
  value,
  onToggle,
  defaultValue,
  prefabRevert,
  onRevert,
}: {
  label: string
  value: boolean
  onToggle: (v: boolean) => void
  defaultValue?: boolean
  prefabRevert?: { actorId: string; fieldPath: string }
  onRevert?: () => void
}) {
  const modified = defaultValue !== undefined && value !== defaultValue
  return (
    <label className="field check">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onToggle(e.target.checked)} />
      {modified && (onRevert || prefabRevert) && (
        <button
          className="reset-default"
          title={prefabRevert ? 'Revert prefab override' : 'Revert to default'}
          onClick={(e) => {
            e.preventDefault()
            if (onRevert) onRevert()
            else if (prefabRevert) runCommand(new RevertPrefabOverrideCommand(prefabRevert.actorId, prefabRevert.fieldPath))
          }}
        >
          ⟲
        </button>
      )}
    </label>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details open className="details-section">
      <summary>{title}</summary>
      <div className="details-grid">{children}</div>
    </details>
  )
}

function MobilitySection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  return (
    <Section title="Mobility">
      <label className="field">
        <span>Type</span>
        <select
          value={actor.mobility}
          onChange={(e) => {
            const prev = actor.mobility
            const next = e.target.value as Mobility
            runCommand(
              new PropertyCommand(
                `Mobility: ${next}`,
                () => (actor.mobility = next),
                () => (actor.mobility = prev),
              ),
            )
            touch()
          }}
        >
          <option value="static">Static</option>
          <option value="stationary">Stationary</option>
          <option value="movable">Movable</option>
        </select>
      </label>
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        {actor.mobility === 'static' && 'Cannot move at runtime. Behaviors that transform are disabled during Play.'}
        {actor.mobility === 'stationary' && 'Lights may change params at runtime; transform behaviors are disabled.'}
        {actor.mobility === 'movable' && 'Full runtime transform. Required for dynamic physics.'}
      </div>
    </Section>
  )
}

const IK_CHAINS: IKChain[] = ['leftLeg', 'rightLeg', 'leftArm', 'rightArm']

function cloneIkTargets(targets: IKTarget[] | undefined): IKTarget[] | undefined {
  if (!targets?.length) return undefined
  return targets.map((t) => ({
    chain: t.chain,
    targetActorId: t.targetActorId,
    targetPosition: t.targetPosition ? ([...t.targetPosition] as [number, number, number]) : undefined,
  }))
}

function cloneLookAtTarget(target: LookAtTarget | undefined): LookAtTarget | undefined {
  if (!target) return undefined
  return {
    targetActorId: target.targetActorId,
    targetPosition: target.targetPosition ? ([...target.targetPosition] as [number, number, number]) : undefined,
  }
}

function IkSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  if (!hasActorSkeleton(actor)) return null

  const targets = actor.ikTargets ?? []
  const actorOptions = [...world.actors.values()]
    .filter((a) => a.id !== actor.id)
    .sort((a, b) => a.name.localeCompare(b.name))

  const setIkTargets = (next: IKTarget[] | undefined, prev: IKTarget[] | undefined, label: string) => {
    runCommand(
      new PropertyCommand(
        label,
        () => (actor.ikTargets = next),
        () => (actor.ikTargets = prev),
      ),
    )
    touch()
  }

  const setLookAt = (next: LookAtTarget | undefined, prev: LookAtTarget | undefined, label: string) => {
    runCommand(
      new PropertyCommand(
        label,
        () => (actor.lookAtTarget = next),
        () => (actor.lookAtTarget = prev),
      ),
    )
    touch()
  }

  const addChain = () => {
    const prev = cloneIkTargets(actor.ikTargets)
    const used = new Set((actor.ikTargets ?? []).map((t) => t.chain))
    const chain = IK_CHAINS.find((c) => !used.has(c)) ?? 'leftLeg'
    const next = [...(actor.ikTargets ?? []), { chain }]
    setIkTargets(next, prev, 'Add IK chain')
  }

  const removeChain = (index: number) => {
    const prev = cloneIkTargets(actor.ikTargets)
    const next = (actor.ikTargets ?? []).filter((_, i) => i !== index)
    setIkTargets(next.length ? next : undefined, prev, 'Remove IK chain')
  }

  const updateChain = (index: number, patch: Partial<IKTarget>) => {
    const prev = cloneIkTargets(actor.ikTargets)
    const next = (actor.ikTargets ?? []).map((t, i) => (i === index ? { ...t, ...patch } : t))
    setIkTargets(next, prev, 'Edit IK chain')
  }

  const lookAt = actor.lookAtTarget
  const lookAtMode = lookAt?.targetActorId ? 'actor' : lookAt?.targetPosition ? 'world' : 'none'

  return (
    <Section title="IK">
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        Two-bone IK on glTF bones (Hips / Mixamo). Targets resolve at Play time.
      </div>
      {targets.map((t, index) => {
        const bones = getChainBoneLabels(t.chain)
        const mode = t.targetActorId ? 'actor' : t.targetPosition ? 'world' : 'none'
        return (
          <div key={`${t.chain}-${index}`} className="details-subblock">
            <div className="details-subblock-head">
              <strong>Chain {index + 1}</strong>
              <button type="button" onClick={() => removeChain(index)}>
                Remove
              </button>
            </div>
            <label className="field">
              <span>Limb</span>
              <select
                value={t.chain}
                onChange={(e) => updateChain(index, { chain: e.target.value as IKChain })}
              >
                {IK_CHAINS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <div className="panel-empty" style={{ padding: '2px 0', fontSize: '0.85em' }}>
              {bones.hip} → {bones.knee} → {bones.ankle}
            </div>
            <label className="field">
              <span>Target</span>
              <select
                value={mode}
                onChange={(e) => {
                  const m = e.target.value
                  if (m === 'actor') updateChain(index, { targetActorId: actorOptions[0]?.id, targetPosition: undefined })
                  else if (m === 'world') updateChain(index, { targetActorId: undefined, targetPosition: [0, 0, 0] })
                  else updateChain(index, { targetActorId: undefined, targetPosition: undefined })
                }}
              >
                <option value="none">(none)</option>
                <option value="actor">Actor</option>
                <option value="world">World position</option>
              </select>
            </label>
            {mode === 'actor' && (
              <label className="field">
                <span>Target actor</span>
                <select
                  value={t.targetActorId ?? ''}
                  onChange={(e) => updateChain(index, { targetActorId: e.target.value || undefined })}
                >
                  <option value="">(pick actor)</option>
                  {actorOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {mode === 'world' && (
              <>
                <Num
                  label="X"
                  value={t.targetPosition?.[0] ?? 0}
                  step={0.1}
                  onLive={(v) => {
                    const pos: [number, number, number] = [
                      v,
                      t.targetPosition?.[1] ?? 0,
                      t.targetPosition?.[2] ?? 0,
                    ]
                    updateChain(index, { targetPosition: pos, targetActorId: undefined })
                  }}
                  onCommit={() => {}}
                />
                <Num
                  label="Y"
                  value={t.targetPosition?.[1] ?? 0}
                  step={0.1}
                  onLive={(v) => {
                    const pos: [number, number, number] = [
                      t.targetPosition?.[0] ?? 0,
                      v,
                      t.targetPosition?.[2] ?? 0,
                    ]
                    updateChain(index, { targetPosition: pos, targetActorId: undefined })
                  }}
                  onCommit={() => {}}
                />
                <Num
                  label="Z"
                  value={t.targetPosition?.[2] ?? 0}
                  step={0.1}
                  onLive={(v) => {
                    const pos: [number, number, number] = [
                      t.targetPosition?.[0] ?? 0,
                      t.targetPosition?.[1] ?? 0,
                      v,
                    ]
                    updateChain(index, { targetPosition: pos, targetActorId: undefined })
                  }}
                  onCommit={() => {}}
                />
              </>
            )}
          </div>
        )
      })}
      <button type="button" onClick={addChain}>
        + Add IK chain
      </button>

      <div className="details-subblock" style={{ marginTop: 8 }}>
        <strong>Look At (Head)</strong>
        <label className="field">
          <span>Target</span>
          <select
            value={lookAtMode}
            onChange={(e) => {
              const prev = cloneLookAtTarget(actor.lookAtTarget)
              const m = e.target.value
              if (m === 'actor') setLookAt({ targetActorId: actorOptions[0]?.id }, prev, 'Set LookAt actor')
              else if (m === 'world') setLookAt({ targetPosition: [0, 1, 0] }, prev, 'Set LookAt world')
              else setLookAt(undefined, prev, 'Clear LookAt')
            }}
          >
            <option value="none">(none)</option>
            <option value="actor">Actor</option>
            <option value="world">World position</option>
          </select>
        </label>
        {lookAtMode === 'actor' && (
          <label className="field">
            <span>Target actor</span>
            <select
              value={lookAt?.targetActorId ?? ''}
              onChange={(e) => {
                const prev = cloneLookAtTarget(actor.lookAtTarget)
                setLookAt({ targetActorId: e.target.value || undefined }, prev, 'Edit LookAt actor')
              }}
            >
              <option value="">(pick actor)</option>
              {actorOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {lookAtMode === 'world' && (
          <>
            <Num
              label="X"
              value={lookAt?.targetPosition?.[0] ?? 0}
              step={0.1}
              onLive={(v) => {
                const prev = cloneLookAtTarget(actor.lookAtTarget)
                const next: LookAtTarget = {
                  targetPosition: [v, lookAt?.targetPosition?.[1] ?? 0, lookAt?.targetPosition?.[2] ?? 0],
                }
                setLookAt(next, prev, 'Edit LookAt X')
              }}
              onCommit={() => {}}
            />
            <Num
              label="Y"
              value={lookAt?.targetPosition?.[1] ?? 0}
              step={0.1}
              onLive={(v) => {
                const prev = cloneLookAtTarget(actor.lookAtTarget)
                const next: LookAtTarget = {
                  targetPosition: [lookAt?.targetPosition?.[0] ?? 0, v, lookAt?.targetPosition?.[2] ?? 0],
                }
                setLookAt(next, prev, 'Edit LookAt Y')
              }}
              onCommit={() => {}}
            />
            <Num
              label="Z"
              value={lookAt?.targetPosition?.[2] ?? 0}
              step={0.1}
              onLive={(v) => {
                const prev = cloneLookAtTarget(actor.lookAtTarget)
                const next: LookAtTarget = {
                  targetPosition: [lookAt?.targetPosition?.[0] ?? 0, lookAt?.targetPosition?.[1] ?? 0, v],
                }
                setLookAt(next, prev, 'Edit LookAt Z')
              }}
              onCommit={() => {}}
            />
          </>
        )}
      </div>
    </Section>
  )
}

function Widget3DSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  if (!actor.widget3DProps) return null
  const props = actor.widget3DProps
  const hudWidgets = world.hudWidgets
  const set = <K extends keyof Widget3DProps>(key: K, value: Widget3DProps[K]) => {
    const prev = props[key]
    runCommand(
      new PropertyCommand(
        `Widget ${String(key)}`,
        () => {
          props[key] = value
          syncWidget3D(actor, hudWidgets)
        },
        () => {
          props[key] = prev
          syncWidget3D(actor, hudWidgets)
        },
      ),
    )
    touch()
  }
  return (
    <Section title="3D Widget">
      <label className="field">
        <span>HUD Widget</span>
        <select
          value={props.hudWidgetId ?? ''}
          onChange={(e) => set('hudWidgetId', e.target.value || undefined)}
        >
          <option value="">— Custom HTML —</option>
          {hudWidgets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.id} ({w.type})
            </option>
          ))}
        </select>
      </label>
      {!props.hudWidgetId && (
        <label className="field">
          <span>HTML</span>
          <textarea
            rows={6}
            value={props.html}
            onChange={(e) => set('html', e.target.value)}
            spellCheck={false}
            style={{ fontFamily: 'monospace', fontSize: 11 }}
          />
        </label>
      )}
      <Num label="Width" value={props.width} step={0.25} min={0.25} max={16} onLive={(v) => set('width', v)} onCommit={() => {}} />
      <Num label="Height" value={props.height} step={0.25} min={0.25} max={16} onLive={(v) => set('height', v)} onCommit={() => {}} />
      <Num label="Opacity" value={props.opacity} step={0.05} min={0} max={1} onLive={(v) => set('opacity', v)} onCommit={() => {}} />
      <label className="field check">
        <span>Billboard</span>
        <input type="checkbox" checked={props.billboard} onChange={(e) => set('billboard', e.target.checked)} />
      </label>
    </Section>
  )
}

function Label3DSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  if (!actor.label3DProps) return null
  const props = actor.label3DProps
  const set = <K extends keyof Label3DProps>(key: K, value: Label3DProps[K]) => {
    const prev = props[key]
    runCommand(
      new PropertyCommand(
        `Label ${String(key)}`,
        () => {
          props[key] = value
          rebuildLabel3D(actor)
        },
        () => {
          props[key] = prev
          rebuildLabel3D(actor)
        },
      ),
    )
    touch()
  }
  return (
    <Section title="3D Label">
      <label className="field">
        <span>Text</span>
        <input
          type="text"
          value={props.text}
          onChange={(e) => set('text', e.target.value)}
          spellCheck={false}
        />
      </label>
      <Num label="Font Size" value={props.fontSize} step={4} min={12} max={128} onLive={(v) => set('fontSize', v)} onCommit={() => {}} />
      <ColorField label="Text Color" value={props.color} onLive={(v) => set('color', v)} onCommit={() => {}} />
      <ColorField label="Background" value={props.background} onLive={(v) => set('background', v)} onCommit={() => {}} />
      <Num label="Padding" value={props.padding} step={2} min={0} max={48} onLive={(v) => set('padding', v)} onCommit={() => {}} />
      <label className="field check">
        <span>Billboard</span>
        <input type="checkbox" checked={props.billboard} onChange={(e) => set('billboard', e.target.checked)} />
      </label>
    </Section>
  )
}

function AnimationSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const setBottomTab = useEditor((s) => s.setBottomTab)
  const clips = (actor.animations ?? []).map((c) => c.name)
  if (clips.length === 0) return null
  const paramNames = collectAnimParams(actor)
  if (actor.blendSpace1D?.param && !paramNames.includes(actor.blendSpace1D.param)) {
    paramNames.push(actor.blendSpace1D.param)
  }
  if (actor.blendSpace2D?.paramX && !paramNames.includes(actor.blendSpace2D.paramX)) {
    paramNames.push(actor.blendSpace2D.paramX)
  }
  if (actor.blendSpace2D?.paramY && !paramNames.includes(actor.blendSpace2D.paramY)) {
    paramNames.push(actor.blendSpace2D.paramY)
  }
  const hasFsm = (actor.animStateMachine?.states.length ?? 0) > 0
  const hasBlend1d = (actor.blendSpace1D?.samples.length ?? 0) > 0
  const hasBlend2d = (actor.blendSpace2D?.samples.length ?? 0) > 0
  const setAnimParam = (name: string, value: number) => {
    if (!actor.animParams) actor.animParams = {}
    actor.animParams[name] = value
  }
  return (
    <Section title="Animation">
      <button type="button" onClick={() => setBottomTab('anim')}>
        Open Animation Editor
      </button>
      {(hasFsm || hasBlend1d || hasBlend2d) && (
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          {hasFsm && `FSM: ${actor.animStateMachine!.states.length} state(s)`}
          {hasFsm && (hasBlend1d || hasBlend2d) && ' · '}
          {hasBlend1d && `Blend 1D: ${actor.blendSpace1D!.samples.length} sample(s)`}
          {hasBlend1d && hasBlend2d && ' · '}
          {hasBlend2d && `Blend 2D: ${actor.blendSpace2D!.samples.length} sample(s)`}
        </div>
      )}
      <label className="field">
        <span>Auto Play</span>
        <select
          value={actor.autoPlayClip ?? ''}
          onChange={(e) => {
            const prev = actor.autoPlayClip
            const next = e.target.value || undefined
            runCommand(
              new PropertyCommand(
                'Auto play clip',
                () => (actor.autoPlayClip = next),
                () => (actor.autoPlayClip = prev),
              ),
            )
            touch()
          }}
        >
          <option value="">(none)</option>
          {clips.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>
      {paramNames.map((name) => (
        <Num
          key={name}
          label={name}
          value={actor.animParams?.[name] ?? 0}
          step={0.05}
          onLive={(v) => {
            setAnimParam(name, v)
            touch()
          }}
          onCommit={(before, after) => {
            const prev = { ...(actor.animParams ?? {}) }
            const next = { ...prev, [name]: after }
            runCommand(
              new PropertyCommand(
                `Anim param ${name}`,
                () => (actor.animParams = next),
                () => (actor.animParams = Object.keys(prev).length ? prev : undefined),
              ),
            )
            if (before !== after) touch()
          }}
        />
      ))}
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        {clips.length} clip(s). Scripts: api.playAnimation(actor, '{clips[0]}')
      </div>
    </Section>
  )
}

function WaterSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const props = actor.waterProps!
  const rebuild = () => {
    buildWaterMesh(actor)
    touch()
  }
  return (
    <Section title="Water">
      <Num label="Size" value={props.size} step={5} min={5} onLive={(v) => { props.size = v; rebuild() }} onCommit={() => {}} />
      <ColorField label="Color" value={props.color} onLive={(v) => { props.color = v; rebuild() }} onCommit={() => {}} />
      <Num label="Opacity" value={props.opacity} step={0.05} min={0.1} max={1} onLive={(v) => { props.opacity = v; rebuild() }} onCommit={() => {}} />
      <Num label="Wave Height" value={props.waveHeight} step={0.05} min={0} onLive={(v) => { props.waveHeight = v; touch() }} onCommit={() => {}} />
      <Num label="Wave Length" value={props.waveLength} step={0.5} min={1} onLive={(v) => { props.waveLength = v; touch() }} onCommit={() => {}} />
      <Num label="Speed" value={props.speed} step={0.1} min={0} onLive={(v) => { props.speed = v; touch() }} onCommit={() => {}} />
    </Section>
  )
}

function PCGSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const setBottomTab = useEditor((s) => s.setBottomTab)
  const props = actor.pcgProps!
  const regen = () => {
    regeneratePCG(actor, world.actors)
    touch()
  }
  const openPcgEditor = () => setBottomTab('pcg')
  return (
    <Section title="PCG Scatter (sample → filter → spawn)">
      <button type="button" onClick={openPcgEditor}>
        Edit PCG Graph
      </button>
      <label className="field">
        <span>Mesh</span>
        <select value={props.geometry} onChange={(e) => { props.geometry = e.target.value as typeof props.geometry; regen() }}>
          {['cone', 'sphere', 'box', 'cylinder', 'icosahedron', 'capsule'].map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </label>
      <ColorField label="Color" value={props.color} onLive={(v) => { props.color = v; regen() }} onCommit={() => {}} />
      <Num label="Density" value={props.density} step={1} min={1} onLive={(v) => { props.density = v; regen() }} onCommit={() => {}} />
      <Num label="Seed" value={props.seed} step={1} onLive={(v) => { props.seed = Math.round(v); regen() }} onCommit={() => {}} />
      <Num label="Scale Min" value={props.scaleMin} step={0.1} min={0.05} onLive={(v) => { props.scaleMin = v; regen() }} onCommit={() => {}} />
      <Num label="Scale Max" value={props.scaleMax} step={0.1} min={0.05} onLive={(v) => { props.scaleMax = v; regen() }} onCommit={() => {}} />
      <Num label="Max Slope°" value={props.maxSlopeDeg} step={5} min={0} max={89} onLive={(v) => { props.maxSlopeDeg = v; regen() }} onCommit={() => {}} />
      <Check label="Align to Normal" value={props.alignToNormal} onToggle={(v) => { props.alignToNormal = v; regen() }} />
      <button onClick={regen}>🎲 Regenerate</button>
      <div className="panel-empty" style={{ padding: '2px 0' }}>Scatters onto surfaces inside the volume. Scale the volume to set bounds; seed makes it deterministic.</div>
    </Section>
  )
}

function ProbeSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const setStatus = useEditor((s) => s.setStatus)
  const props = actor.probeProps!
  return (
    <Section title="Reflection Probe">
      <Num label="Radius" value={props.radius} step={1} min={1} onLive={(v) => { props.radius = v; touch() }} onCommit={() => {}} />
      <button
        onClick={() => {
          world.probeBakeQueue.push(actor.id)
          setStatus('Bake queued…')
        }}
      >
        🔮 Bake Cubemap
      </button>
      <div className="panel-empty" style={{ padding: '2px 0' }}>Bakes a cubemap here and feeds it to PBR meshes within the radius.</div>
    </Section>
  )
}

function TriggerSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  if (!actor.triggerProps) actor.triggerProps = { reverbPreset: '' }
  const props = actor.triggerProps
  const set = <K extends keyof TriggerProps>(key: K, value: TriggerProps[K]) => {
    const prev = props[key]
    runCommand(
      new PropertyCommand(
        `Trigger ${String(key)}`,
        () => (props[key] = value),
        () => (props[key] = prev),
      ),
    )
    touch()
  }
  return (
    <Section title="Trigger Volume">
      <label className="field">
        <span>Reverb Preset</span>
        <select value={props.reverbPreset ?? ''} onChange={(e) => set('reverbPreset', e.target.value as ReverbPreset)}>
          <option value="">None</option>
          <option value="room">Room</option>
          <option value="hall">Hall</option>
          <option value="cave">Cave</option>
        </select>
      </label>
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        While the pawn is inside, audio routes through a ConvolverNode reverb send. Also emits enter:/exit: signals.
      </div>
    </Section>
  )
}

function SoundEmitterSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  if (!actor.soundEmitterProps) return null
  const props = actor.soundEmitterProps
  const metaSounds = listMetaSounds()
  const set = <K extends keyof SoundEmitterProps>(key: K, value: SoundEmitterProps[K]) => {
    const prev = props[key]
    runCommand(
      new PropertyCommand(
        `Sound ${String(key)}`,
        () => (props[key] = value),
        () => (props[key] = prev),
      ),
    )
    touch()
  }
  return (
    <Section title="Sound Emitter">
      <label className="field">
        <span>MetaSound</span>
        <select value={props.metaSoundName} onChange={(e) => set('metaSoundName', e.target.value)}>
          <option value="">— select —</option>
          {metaSounds.map((m) => (
            <option key={m.id} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <Num label="Volume" value={props.volume} step={0.05} min={0} max={2} onLive={(v) => set('volume', v)} onCommit={() => {}} />
      <label className="field check">
        <span>Auto Play</span>
        <input type="checkbox" checked={props.autoPlay} onChange={(e) => set('autoPlay', e.target.checked)} />
      </label>
      <label className="field check">
        <span>Loop</span>
        <input type="checkbox" checked={props.loop} onChange={(e) => set('loop', e.target.checked)} />
      </label>
      <label className="field check">
        <span>Spatial (3D)</span>
        <input type="checkbox" checked={props.spatial} onChange={(e) => set('spatial', e.target.checked)} />
      </label>
      {props.spatial && (
        <AttenuationFields
          value={props}
          onChange={(patch) => {
            const prev = { ...props }
            runCommand(
              new PropertyCommand(
                'Sound attenuation',
                () => Object.assign(props, patch),
                () => Object.assign(props, prev),
              ),
            )
            touch()
          }}
        />
      )}
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        Plays api.playMetaSound at this actor&apos;s position during Play when Auto Play is on.
      </div>
    </Section>
  )
}

const SYNC_BUILTIN = ['position', 'rotation', 'visible'] as const

function NetworkSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const playing = useEditor((s) => s.playing)
  if (!mpEnabled()) return null

  const synced = new Set(actor.syncProperties ?? [])
  const scriptExports = parseExports(actor.script ?? '').map((e) => e.name)
  const options = [...SYNC_BUILTIN, ...scriptExports.filter((n) => !SYNC_BUILTIN.includes(n as (typeof SYNC_BUILTIN)[number]))]
  const localId = mpLocalId()
  const ownerValue = !actor.netOwnerId
    ? ''
    : actor.netOwnerId === '__local__' || actor.netOwnerId === localId
      ? localId || '__local__'
      : actor.netOwnerId
  const peerIds = mpConnected() ? mpKnownPeerIds() : []
  const ownerLocked = playing && mpConnected() && !mpIsHost()

  const toggleProp = (name: string, on: boolean) => {
    const prev = actor.syncProperties ? [...actor.syncProperties] : undefined
    const next = new Set(synced)
    if (on) next.add(name)
    else next.delete(name)
    const arr = [...next]
    runCommand(
      new PropertyCommand(
        on ? `Sync ${name}` : `Unsync ${name}`,
        () => (actor.syncProperties = arr.length ? arr : undefined),
        () => (actor.syncProperties = prev),
      ),
    )
    touch()
  }

  const setOwner = (nextOwner: string) => {
    const prev = actor.netOwnerId
    const resolved = nextOwner === '__local__' ? '__local__' : nextOwner || undefined
    runCommand(
      new PropertyCommand(
        'Set network owner',
        () => {
          actor.netOwnerId = resolved
          if (playing && mpConnected() && mpIsHost()) {
            mpNotifyOwnership(actor.id, resolved === '__local__' ? localId : resolved)
          }
        },
        () => {
          actor.netOwnerId = prev
          if (playing && mpConnected() && mpIsHost()) {
            mpNotifyOwnership(actor.id, prev === '__local__' ? localId : prev)
          }
        },
      ),
    )
    touch()
  }

  return (
    <Section title="Network (MultiplayerSynchronizer)">
      <label className="field">
        <span>Owner</span>
        <select
          value={ownerValue}
          disabled={ownerLocked}
          onChange={(e) => setOwner(e.target.value)}
        >
          <option value="">Host</option>
          <option value={localId || '__local__'}>Local{localId ? ` (${localId})` : ''}</option>
          {peerIds.map((pid) => (
            <option key={pid} value={pid}>
              Peer {pid}
            </option>
          ))}
        </select>
      </label>
      <Check
        label="Client Predicted"
        value={!!actor.clientPredicted}
        onToggle={(v) => {
          const prev = actor.clientPredicted
          runCommand(
            new PropertyCommand(
              v ? 'Enable client prediction' : 'Disable client prediction',
              () => (actor.clientPredicted = v || undefined),
              () => (actor.clientPredicted = prev),
            ),
          )
          touch()
        }}
      />
      <Check
        label="Sync Spawn"
        value={actor.syncSpawn}
        onToggle={(v) => {
          const prev = actor.syncSpawn
          runCommand(
            new PropertyCommand(
              v ? 'Enable sync spawn' : 'Disable sync spawn',
              () => (actor.syncSpawn = v),
              () => (actor.syncSpawn = prev),
            ),
          )
          touch()
        }}
      />
      {actor.attributeSetId && (
        <Check
          label="Replicate GAS"
          value={!!actor.replicateGAS}
          onToggle={(v) => {
            const prev = actor.replicateGAS
            runCommand(
              new PropertyCommand(
                v ? 'Enable GAS replication' : 'Disable GAS replication',
                () => (actor.replicateGAS = v || undefined),
                () => (actor.replicateGAS = prev),
              ),
            )
            touch()
          }}
        />
      )}
      {options.map((name) => (
        <Check key={name} label={name} value={synced.has(name)} onToggle={(v) => toggleProp(name, v)} />
      ))}
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        Host broadcasts checked properties at 10 Hz. Non-owned actors interpolate; locally-owned + Client Predicted
        actors apply input immediately and reconcile on sync (snap if error &gt; 0.5 m / 0.35 rad).
        {playing && mpConnected() ? ` This session: ${mpIsHost() ? 'host (authority)' : 'client'}.` : ''}
        {ownerLocked ? ' Only the host can reassign ownership during Play.' : ''}
      </div>
    </Section>
  )
}

function StreamingSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const grid = world.streaming.gridSize
  const autoCell =
    world.streaming.enabled && grid > 0
      ? `[${Math.floor(actor.root.position.x / grid)}, ${Math.floor(actor.root.position.z / grid)}]`
      : '—'
  return (
    <Section title="Streaming">
      <label className="field">
        <span>Stream Cell</span>
        <input
          value={actor.streamCell ? `${actor.streamCell[0]}, ${actor.streamCell[1]}` : ''}
          placeholder={`auto ${autoCell}`}
          spellCheck={false}
          onChange={(e) => {
            const parts = e.target.value.split(/[,\s]+/).map((p) => parseInt(p.trim(), 10))
            if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
              actor.streamCell = [parts[0], parts[1]]
            } else if (!e.target.value.trim()) {
              actor.streamCell = undefined
            }
            touch()
          }}
        />
      </label>
      <Num
        label="Cull Distance"
        value={actor.cullDistance}
        step={5}
        min={0}
        onLive={(v) => {
          actor.cullDistance = v
          touch()
        }}
        onCommit={() => {}}
      />
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        Cell auto-assigned on save from position. 0 cull distance = no per-actor distance cull.
      </div>
    </Section>
  )
}

function AbilitiesSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const playing = useEditor((s) => s.playing)
  const sets = listAttributeSets()
  const abilities = listAbilities()
  const liveAttrs = playing ? getActorAttributes(actor) : null
  const liveEffects = playing ? getActorActiveEffects(actor) : null

  const setAttrSet = (id: string) => {
    const prev = actor.attributeSetId
    runCommand(
      new PropertyCommand(
        'Attribute set',
        () => (actor.attributeSetId = id || undefined),
        () => (actor.attributeSetId = prev),
      ),
    )
    touch()
  }

  const toggleAbility = (id: string) => {
    const prev = [...actor.abilityIds]
    const has = actor.abilityIds.includes(id)
    const next = has ? actor.abilityIds.filter((x) => x !== id) : [...actor.abilityIds, id]
    runCommand(
      new PropertyCommand(
        'Abilities',
        () => (actor.abilityIds = next),
        () => (actor.abilityIds = prev),
      ),
    )
    touch()
  }

  return (
    <Section title="Gameplay Abilities">
      <label className="field">
        <span>Attribute Set</span>
        <select
          value={actor.attributeSetId ?? ''}
          onChange={(e) => setAttrSet(e.target.value)}
        >
          <option value="">(none)</option>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      {abilities.length > 0 && (
        <div className="details-grid">
          {abilities.map((a) => (
            <label className="field check" key={a.id}>
              <span>{a.name}</span>
              <input
                type="checkbox"
                checked={actor.abilityIds.includes(a.id)}
                onChange={() => toggleAbility(a.id)}
              />
            </label>
          ))}
        </div>
      )}
      {liveAttrs && (
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          Live: {Object.entries(liveAttrs).map(([k, v]) => `${k}=${v.toFixed(1)}`).join(' · ')}
        </div>
      )}
      {liveEffects && liveEffects.length > 0 && (
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          Active effects: {liveEffects.map((e) => `${e.name} (${e.remaining.toFixed(1)}s)`).join(' · ')}
        </div>
      )}
      {playing && liveEffects && liveEffects.length === 0 && actor.attributeSetId && (
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          Active effects: (none)
        </div>
      )}
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        Scripts: api.activateAbility('{abilities[0]?.name ?? 'AbilityName'}') · api.applyEffect('Poison')
      </div>
    </Section>
  )
}

function TimerSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  if (!actor.timerProps) actor.timerProps = { wait: 1, oneShot: true, autostart: false, paused: false }
  const props = actor.timerProps
  const set = <K extends keyof TimerProps>(key: K, value: TimerProps[K]) => {
    const prev = props[key]
    runCommand(
      new PropertyCommand(
        `Timer ${String(key)}`,
        () => (props[key] = value),
        () => (props[key] = prev),
      ),
    )
    touch()
  }
  return (
    <Section title="Timer">
      <Num label="Wait (s)" value={props.wait} step={0.1} min={0.01} onLive={(v) => { props.wait = v; touch() }} onCommit={() => {}} />
      <Check label="One Shot" value={props.oneShot} onToggle={(v) => set('oneShot', v)} />
      <Check label="Autostart" value={props.autostart} onToggle={(v) => set('autostart', v)} />
      <Check label="Paused" value={props.paused} onToggle={(v) => set('paused', v)} />
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        Emits <code>timeout:{actor.name}</code> during Play. Loop when One Shot is off.
      </div>
    </Section>
  )
}

function RayCastSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  if (!actor.rayCastProps) actor.rayCastProps = { enabled: true, length: 10, localDirection: [0, 0, -1], excludeSelf: true }
  const props = actor.rayCastProps
  const set = <K extends keyof RayCastProps>(key: K, value: RayCastProps[K]) => {
    const prev = props[key]
    runCommand(
      new PropertyCommand(
        `RayCast ${String(key)}`,
        () => {
          props[key] = value
          if (key === 'length' || key === 'localDirection') rebuildRayCastVisual(actor)
        },
        () => {
          props[key] = prev
          rebuildRayCastVisual(actor)
        },
      ),
    )
    touch()
  }
  return (
    <Section title="RayCast3D">
      <Check label="Enabled" value={props.enabled} onToggle={(v) => set('enabled', v)} />
      <Num label="Length" value={props.length} step={0.5} min={0.1} onLive={(v) => { props.length = v; rebuildRayCastVisual(actor); touch() }} onCommit={() => {}} />
      {(['x', 'y', 'z'] as const).map((axis, i) => (
        <Num
          key={axis}
          label={`Dir ${axis.toUpperCase()}`}
          value={props.localDirection[i]}
          step={0.1}
          onLive={(v) => {
            props.localDirection[i] = v
            rebuildRayCastVisual(actor)
            touch()
          }}
          onCommit={() => {}}
        />
      ))}
      <Check label="Exclude Self" value={props.excludeSelf} onToggle={(v) => set('excludeSelf', v)} />
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        Emits <code>hit:{actor.name}</code> / <code>clear:{actor.name}</code> when collision changes.
      </div>
    </Section>
  )
}

function Path3DSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  if (!actor.path3DProps) actor.path3DProps = { waypoints: [[0, 0, 0], [2, 0, 0]], closed: false }
  const props = actor.path3DProps
  const setClosed = (v: boolean) => {
    const prev = props.closed
    runCommand(
      new PropertyCommand(
        'Path closed',
        () => {
          props.closed = v
          rebuildPath3DVisual(actor)
        },
        () => {
          props.closed = prev
          rebuildPath3DVisual(actor)
        },
      ),
    )
    touch()
  }
  return (
    <Section title="Path3D">
      <Check label="Closed Loop" value={props.closed} onToggle={setClosed} />
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        {props.waypoints.length} waypoints — edit transform to reposition path root; PathFollow actors reference <code>{actor.name}</code>.
      </div>
      <button
        type="button"
        onClick={() => {
          const last = props.waypoints[props.waypoints.length - 1] ?? [0, 0, 0]
          const next: [number, number, number] = [last[0] + 1, last[1], last[2]]
          runCommand(
            new PropertyCommand(
              'Add waypoint',
              () => {
                props.waypoints.push(next)
                rebuildPath3DVisual(actor)
              },
              () => {
                props.waypoints.pop()
                rebuildPath3DVisual(actor)
              },
            ),
          )
          touch()
        }}
      >
        + Add Waypoint
      </button>
    </Section>
  )
}

function PathFollowSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  if (!actor.pathFollowProps) {
    actor.pathFollowProps = { pathActorName: '', progress: 0, speed: 2, loop: false, autoplay: false, rotateToPath: true }
  }
  const props = actor.pathFollowProps
  const pathNames = [...world.actors.values()].filter((a) => a.type === 'Path3D').map((a) => a.name)
  const set = <K extends keyof PathFollowProps>(key: K, value: PathFollowProps[K]) => {
    const prev = props[key]
    runCommand(
      new PropertyCommand(
        `PathFollow ${String(key)}`,
        () => (props[key] = value),
        () => (props[key] = prev),
      ),
    )
    touch()
  }
  return (
    <Section title="PathFollow3D">
      <label className="field">
        <span>Path Actor</span>
        <select value={props.pathActorName} onChange={(e) => set('pathActorName', e.target.value)}>
          <option value="">— select —</option>
          {pathNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <Num label="Progress" value={props.progress} step={0.01} min={0} max={1} onLive={(v) => { props.progress = v; touch() }} onCommit={() => {}} />
      <Num label="Speed" value={props.speed} step={0.1} min={0} onLive={(v) => { props.speed = v; touch() }} onCommit={() => {}} />
      <Check label="Loop" value={props.loop} onToggle={(v) => set('loop', v)} />
      <Check label="Autoplay" value={props.autoplay} onToggle={(v) => set('autoplay', v)} />
      <Check label="Rotate To Path" value={props.rotateToPath} onToggle={(v) => set('rotateToPath', v)} />
    </Section>
  )
}

function Area3DSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  if (!actor.area3DProps) actor.area3DProps = { enabled: true, monitorGroups: [] }
  const props = actor.area3DProps
  const set = <K extends keyof Area3DProps>(key: K, value: Area3DProps[K]) => {
    const prev = props[key]
    runCommand(
      new PropertyCommand(
        `Area3D ${String(key)}`,
        () => (props[key] = value),
        () => (props[key] = prev),
      ),
    )
    touch()
  }
  const raw = props.monitorGroups.join(', ')
  return (
    <Section title="Area3D">
      <Check label="Enabled" value={props.enabled} onToggle={(v) => set('enabled', v)} />
      <label className="field">
        <span>Monitor Groups</span>
        <input
          type="text"
          placeholder="empty = all actors"
          defaultValue={raw}
          onBlur={(e) => {
            const next = e.target.value
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
            if (next.join(',') === props.monitorGroups.join(',')) return
            set('monitorGroups', next)
          }}
        />
      </label>
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        Emits <code>body_entered:{actor.name}</code> / <code>body_exited:{actor.name}</code> for overlapping actors.
      </div>
    </Section>
  )
}

function PrefabSubtreeSection({ actor }: { actor: Actor }) {
  const select = useEditor((s) => s.select)
  if (!actor.prefabSource) return null
  const subtree = listPrefabSubtree(actor.id)
  return (
    <Section title="Prefab Subtree">
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        Source: {actor.prefabSource} · {subtree.length} editable child(ren) in-place
      </div>
      {subtree.map((entry) => (
        <button
          key={entry.actorId}
          type="button"
          className="prefab-subtree-row"
          style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: 12, marginBottom: 2 }}
          onClick={() => select(entry.actorId)}
        >
          {entry.overrideCount > 0 ? '≠ ' : ''}
          {entry.actorName} <span style={{ opacity: 0.65 }}>({entry.type})</span>
          {entry.overrideCount > 0 ? ` · ${entry.overrideCount} override(s)` : ''}
        </button>
      ))}
    </Section>
  )
}

function PrefabOverridesSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  if (!actor.prefabSource) return null
  const summary = summarizePrefabOverrides(actor.id)
  if (summary.length === 0) {
    return (
      <Section title="Prefab Instance">
        <div className="panel-empty">Source: {actor.prefabSource} — no property overrides.</div>
      </Section>
    )
  }
  return (
    <Section title="Prefab Instance">
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        Source: {actor.prefabSource} · {summary.length} actor(s) with overrides
      </div>
      {summary.map((s) => (
        <div key={s.prefabActorId} className="panel-empty" style={{ padding: '2px 0', fontSize: 12 }}>
          {s.actorName}: {s.keys.join(', ')}
        </div>
      ))}
      <button type="button" onClick={() => { revertAllPrefabOverrides(actor.id); touch() }}>
        Revert All Overrides
      </button>
    </Section>
  )
}

function PrefabOverrideDiffSection({ actor }: { actor: Actor }) {
  if (!actor.prefabActorId) return null
  const diff = getPrefabOverrideDiff(actor.id)
  if (diff.length === 0) return null
  return (
    <Section title="Override Diff">
      {diff.map((d) => (
        <div key={d.fieldPath} className="panel-empty" style={{ padding: '2px 0', fontSize: 12 }}>
          <span title="Differs from prefab source">≠</span> {d.fieldPath}: {String(d.current)} ← {String(d.source)}
        </div>
      ))}
    </Section>
  )
}

function GroupsSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const raw = actor.groups.join(', ')
  return (
    <Section title="Groups">
      <label className="field">
        <span>Groups</span>
        <input
          type="text"
          placeholder="enemies, interactables"
          defaultValue={raw}
          onBlur={(e) => {
            const next = e.target.value
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
            const prev = [...actor.groups]
            if (next.join(',') === prev.join(',')) return
            runCommand(
              new PropertyCommand(
                'Edit groups',
                () => (actor.groups = next),
                () => (actor.groups = prev),
              ),
            )
            touch()
          }}
        />
      </label>
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        Query in scripts: <code>api.getActorsInGroup('enemies')</code>
      </div>
    </Section>
  )
}

function TagsSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const raw = actor.tags.join(', ')
  return (
    <Section title="Actor Tags">
      <label className="field">
        <span>Tags</span>
        <input
          type="text"
          placeholder="Gameplay, Interactable, Enemy"
          defaultValue={raw}
          onBlur={(e) => {
            const next = e.target.value
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
            const prev = [...actor.tags]
            if (next.join(',') === prev.join(',')) return
            runCommand(
              new PropertyCommand(
                'Edit tags',
                () => (actor.tags = next),
                () => (actor.tags = prev),
              ),
            )
            touch()
          }}
        />
      </label>
    </Section>
  )
}

function PostProcessSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const props = actor.postProcessProps!
  const set = <K extends keyof PostProcessProps>(key: K, value: PostProcessProps[K]) => {
    const prev = props[key]
    runCommand(
      new PropertyCommand(
        `Post ${String(key)}`,
        () => (props[key] = value),
        () => (props[key] = prev),
      ),
    )
    touch()
  }
  return (
    <Section title="Post Process">
      <Check label="Enabled" value={props.enabled} onToggle={(v) => set('enabled', v)} />
      <Check label="Infinite Extent" value={props.infiniteExtent} onToggle={(v) => set('infiniteExtent', v)} />
      <Num label="Priority" value={props.priority} step={1} onLive={(v) => { props.priority = v; touch() }} onCommit={() => {}} />
      <Num label="Blend Radius" value={props.blendRadius} step={1} min={0} onLive={(v) => { props.blendRadius = v; touch() }} onCommit={() => {}} />
      <Num label="Exposure" value={props.exposure ?? 0.85} step={0.05} min={0.2} max={2} onLive={(v) => { props.exposure = v; touch() }} onCommit={() => {}} />
      <Num label="Bloom Strength" value={props.bloomStrength ?? 0.35} step={0.05} min={0} max={2} onLive={(v) => { props.bloomStrength = v; touch() }} onCommit={() => {}} />
      <Num label="Bloom Threshold" value={props.bloomThreshold ?? 1.5} step={0.05} min={0} max={3} onLive={(v) => { props.bloomThreshold = v; touch() }} onCommit={() => {}} />
      <div className="panel-empty" style={{ padding: '2px 0' }}>Scale the volume to set its bounds. Camera inside blends these overrides.</div>
    </Section>
  )
}

function ActorSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const nameBefore = useRef(actor.name)
  const prefab = isPrefabInstanceActor(actor.id)
  const nameDefault = prefab ? (getPrefabDefaultValue(actor.id, 'name') as string | undefined) : undefined
  const visibleDefault = prefab ? (getPrefabDefaultValue(actor.id, 'visible') as boolean | undefined) : undefined
  return (
    <Section title="Actor">
      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={actor.name}
          onFocus={() => (nameBefore.current = actor.name)}
          onChange={(e) => {
            actor.name = e.target.value
            actor.root.name = e.target.value
            touch()
          }}
          onBlur={(e) => {
            const next = e.target.value.trim()
            if (!next || next === nameBefore.current) return
            const prev = nameBefore.current
            if (prefab) {
              runPrefabAwareCommand(
                actor.id,
                'name',
                `Rename to ${next}`,
                () => {
                  actor.name = next
                  actor.root.name = next
                },
                () => {
                  actor.name = prev
                  actor.root.name = prev
                },
              )
            } else {
              runCommand(
                new PropertyCommand(
                  `Rename to ${next}`,
                  () => {
                    actor.name = next
                    actor.root.name = next
                  },
                  () => {
                    actor.name = prev
                    actor.root.name = prev
                  },
                ),
              )
            }
            touch()
          }}
        />
        {prefab && nameDefault !== undefined && actor.name !== nameDefault && (
          <button
            className="reset-default"
            title="Revert prefab override"
            onClick={(e) => {
              e.preventDefault()
              runCommand(new RevertPrefabOverrideCommand(actor.id, 'name'))
            }}
          >
            ⟲
          </button>
        )}
      </label>
      <Check
        label="Visible"
        value={actor.visible}
        defaultValue={visibleDefault}
        prefabRevert={prefab ? { actorId: actor.id, fieldPath: 'visible' } : undefined}
        onToggle={(v) => {
          const prev = actor.visible
          if (prefab) {
            runPrefabAwareCommand(
              actor.id,
              'visible',
              v ? 'Show actor' : 'Hide actor',
              () => actor.setVisible(v),
              () => actor.setVisible(prev),
            )
          } else {
            runCommand(
              new PropertyCommand(
                v ? 'Show actor' : 'Hide actor',
                () => actor.setVisible(v),
                () => actor.setVisible(prev),
              ),
            )
          }
          touch()
        }}
      />
      {actor.prefabActorId && !actor.prefabSource && (
        <div className="panel-empty" style={{ padding: '2px 0' }}>
          Prefab child · root: {getPrefabInstanceRoot(actor.id)?.name ?? '—'}
        </div>
      )}
    </Section>
  )
}

function TransformSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const t = actor.transform
  const prefab = isPrefabInstanceActor(actor.id)

  const live = (mut: (tr: TransformSnapshot) => void) => {
    const next = actor.transform
    mut(next)
    actor.setTransform(next)
    touch()
  }
  const commit = (beforeVal: number, mutBefore: (tr: TransformSnapshot, v: number) => void) => {
    const after = { ...actor.transform, position: [...actor.transform.position], rotation: [...actor.transform.rotation], scale: [...actor.transform.scale] } as TransformSnapshot
    const before = { ...actor.transform, position: [...actor.transform.position], rotation: [...actor.transform.rotation], scale: [...actor.transform.scale] } as TransformSnapshot
    mutBefore(before, beforeVal)
    runCommand(new TransformCommand(actor.id, before, after))
  }

  const axes: Array<{ key: 0 | 1 | 2; name: 'X' | 'Y' | 'Z' }> = [
    { key: 0, name: 'X' },
    { key: 1, name: 'Y' },
    { key: 2, name: 'Z' },
  ]

  const prefabNum = (fieldPath: string, label: string, value: number, step: number, onLive: (v: number) => void, onCommit: (b: number) => void) => {
    const def = prefab ? (getPrefabDefaultValue(actor.id, fieldPath) as number | undefined) : undefined
    return (
      <Num
        label={label}
        value={value}
        step={step}
        defaultValue={def}
        prefabRevert={prefab ? { actorId: actor.id, fieldPath } : undefined}
        onLive={onLive}
        onCommit={onCommit}
      />
    )
  }

  return (
    <Section title="Transform">
      <div className="vec-label">Location</div>
      <div className="vec-row">
        {axes.map(({ key, name }) =>
          prefabNum(
            `transform.position.${key}`,
            name,
            t.position[key],
            0.1,
            (v) => live((tr) => (tr.position[key] = v)),
            (b) => commit(b, (tr, v) => (tr.position[key] = v)),
          ),
        )}
      </div>
      <div className="vec-label">Rotation°</div>
      <div className="vec-row">
        {axes.map(({ key, name }) =>
          prefabNum(
            `transform.rotation.${key}`,
            name,
            THREE.MathUtils.radToDeg(t.rotation[key]),
            1,
            (v) => live((tr) => (tr.rotation[key] = THREE.MathUtils.degToRad(v))),
            (b) => commit(THREE.MathUtils.degToRad(b), (tr, v) => (tr.rotation[key] = v)),
          ),
        )}
      </div>
      <div className="vec-label">Scale</div>
      <div className="vec-row">
        {axes.map(({ key, name }) =>
          prefabNum(
            `transform.scale.${key}`,
            name,
            t.scale[key],
            0.1,
            (v) => live((tr) => (tr.scale[key] = v)),
            (b) => commit(b, (tr, v) => (tr.scale[key] = v)),
          ),
        )}
      </div>
    </Section>
  )
}

function saveActorAsMaterialAsset(actor: Actor) {
  const name = prompt('Material asset name', `${actor.name}_Material`)
  if (!name?.trim()) return
  const graph = getEffectiveMaterialGraph(actor)
  const asset = saveMaterialFromProps(name.trim(), actor.materialProps!, graph)
  useEditor.getState().setStatus(`Saved material asset: ${asset.name}`)
  useEditor.getState().touch()
}

function MaterialSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const props = actor.materialProps!
  const mat = actor.mesh!.material as THREE.MeshStandardMaterial
  const prefab = isPrefabInstanceActor(actor.id)

  const liveSet = <K extends keyof typeof props>(key: K, v: (typeof props)[K]) => {
    props[key] = v
    applyMaterialProps(mat, props)
    touch()
  }
  const commitSet = <K extends keyof typeof props>(key: K, before: (typeof props)[K], after: (typeof props)[K]) => {
    const fieldPath = `material.${String(key)}`
    if (prefab) {
      runPrefabAwareCommand(
        actor.id,
        fieldPath,
        `Edit ${String(key)}`,
        () => {
          props[key] = after
          applyMaterialProps(mat, props)
        },
        () => {
          props[key] = before
          applyMaterialProps(mat, props)
        },
      )
    } else {
      runCommand(
        new PropertyCommand(
          `Edit ${String(key)}`,
          () => {
            props[key] = after
            applyMaterialProps(mat, props)
          },
          () => {
            props[key] = before
            applyMaterialProps(mat, props)
          },
        ),
      )
    }
  }

  const matDefault = <K extends keyof typeof props>(key: K) =>
    prefab ? (getPrefabDefaultValue(actor.id, `material.${String(key)}`) as (typeof props)[K] | undefined) : DEFAULT_MATERIAL[key as keyof typeof DEFAULT_MATERIAL]
  const matRevert = (key: keyof typeof props) => (prefab ? { actorId: actor.id, fieldPath: `material.${String(key)}` } : undefined)

  return (
    <Section title="Material">
      <ColorField label="Base Color" value={props.color} defaultValue={matDefault('color') as string} prefabRevert={matRevert('color')} onLive={(v) => liveSet('color', v)} onCommit={(b, a) => commitSet('color', b, a)} />
      <Num label="Roughness" value={props.roughness} defaultValue={matDefault('roughness') as number} prefabRevert={matRevert('roughness')} step={0.05} min={0} max={1} onLive={(v) => liveSet('roughness', v)} onCommit={(b, a) => commitSet('roughness', b, a)} />
      <Num label="Metalness" value={props.metalness} defaultValue={matDefault('metalness') as number} prefabRevert={matRevert('metalness')} step={0.05} min={0} max={1} onLive={(v) => liveSet('metalness', v)} onCommit={(b, a) => commitSet('metalness', b, a)} />
      <ColorField label="Emissive" value={props.emissive} defaultValue={matDefault('emissive') as string} prefabRevert={matRevert('emissive')} onLive={(v) => liveSet('emissive', v)} onCommit={(b, a) => commitSet('emissive', b, a)} />
      <Num label="Emissive ×" value={props.emissiveIntensity} defaultValue={matDefault('emissiveIntensity') as number} prefabRevert={matRevert('emissiveIntensity')} step={0.1} min={0} onLive={(v) => liveSet('emissiveIntensity', v)} onCommit={(b, a) => commitSet('emissiveIntensity', b, a)} />
      <Num label="Opacity" value={props.opacity} defaultValue={matDefault('opacity') as number} prefabRevert={matRevert('opacity')} step={0.05} min={0} max={1} onLive={(v) => liveSet('opacity', v)} onCommit={(b, a) => commitSet('opacity', b, a)} />
      <Check label="Wireframe" value={props.wireframe} defaultValue={matDefault('wireframe') as boolean} prefabRevert={matRevert('wireframe')} onToggle={(v) => commitSet('wireframe', props.wireframe, v)} />
      <button onClick={() => saveActorAsMaterialAsset(actor)}>💾 Save as Material Asset</button>
      <Check
        label="Cast Shadow"
        value={actor.mesh!.castShadow}
        onToggle={(v) => {
          actor.mesh!.castShadow = v
          touch()
        }}
      />
      <Check
        label="Receive Shadow"
        value={actor.mesh!.receiveShadow}
        onToggle={(v) => {
          actor.mesh!.receiveShadow = v
          touch()
        }}
      />
    </Section>
  )
}

function MaterialInstanceSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const asset = getMaterial(actor.materialAssetId!)
  const base = asset?.material ?? DEFAULT_MATERIAL
  const props = actor.materialProps!

  const liveSet = <K extends keyof MaterialProps>(key: K, v: MaterialProps[K]) => {
    actor.materialOverrides = { ...(actor.materialOverrides ?? {}), [key]: v }
    applyActorMaterial(actor)
    touch()
  }
  const commitSet = <K extends keyof MaterialProps>(key: K, _before: MaterialProps[K], after: MaterialProps[K]) => {
    if (after === base[key]) revertMaterialOverride(actor, key)
    else patchMaterialOverrides(actor, (o) => ({ ...o, [key]: after }), `Override ${String(key)}`)
  }
  const revertKey = (key: keyof MaterialProps) => () => revertMaterialOverride(actor, key)

  return (
    <Section title="Material Instance">
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        Parent: {asset?.name ?? `(missing: ${actor.materialAssetId})`}
      </div>
      <ColorField
        label="Base Color"
        value={props.color}
        defaultValue={base.color}
        onRevert={revertKey('color')}
        onLive={(v) => liveSet('color', v)}
        onCommit={(b, a) => commitSet('color', b, a)}
      />
      <Num
        label="Roughness"
        value={props.roughness}
        defaultValue={base.roughness}
        onRevert={revertKey('roughness')}
        step={0.05}
        min={0}
        max={1}
        onLive={(v) => liveSet('roughness', v)}
        onCommit={(b, a) => commitSet('roughness', b, a)}
      />
      <Num
        label="Metalness"
        value={props.metalness}
        defaultValue={base.metalness}
        onRevert={revertKey('metalness')}
        step={0.05}
        min={0}
        max={1}
        onLive={(v) => liveSet('metalness', v)}
        onCommit={(b, a) => commitSet('metalness', b, a)}
      />
      <ColorField
        label="Emissive"
        value={props.emissive}
        defaultValue={base.emissive}
        onRevert={revertKey('emissive')}
        onLive={(v) => liveSet('emissive', v)}
        onCommit={(b, a) => commitSet('emissive', b, a)}
      />
      <Num
        label="Emissive ×"
        value={props.emissiveIntensity}
        defaultValue={base.emissiveIntensity}
        onRevert={revertKey('emissiveIntensity')}
        step={0.1}
        min={0}
        onLive={(v) => liveSet('emissiveIntensity', v)}
        onCommit={(b, a) => commitSet('emissiveIntensity', b, a)}
      />
      <Num
        label="Opacity"
        value={props.opacity}
        defaultValue={base.opacity}
        onRevert={revertKey('opacity')}
        step={0.05}
        min={0}
        max={1}
        onLive={(v) => liveSet('opacity', v)}
        onCommit={(b, a) => commitSet('opacity', b, a)}
      />
      <Check
        label="Wireframe"
        value={props.wireframe}
        defaultValue={base.wireframe}
        onRevert={revertKey('wireframe')}
        onToggle={(v) => {
          if (v === base.wireframe) revertMaterialOverride(actor, 'wireframe')
          else patchMaterialOverrides(actor, (o) => ({ ...o, wireframe: v }), 'Override wireframe')
        }}
      />
      <button onClick={() => saveActorAsMaterialAsset(actor)}>💾 Save as Material Asset</button>
      <Check
        label="Cast Shadow"
        value={actor.mesh!.castShadow}
        onToggle={(v) => {
          actor.mesh!.castShadow = v
          touch()
        }}
      />
      <Check
        label="Receive Shadow"
        value={actor.mesh!.receiveShadow}
        onToggle={(v) => {
          actor.mesh!.receiveShadow = v
          touch()
        }}
      />
    </Section>
  )
}

function LightSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const props = actor.lightProps!

  const liveSet = <K extends keyof typeof props>(key: K, v: (typeof props)[K]) => {
    props[key] = v
    applyLightProps(actor, props)
    touch()
  }
  const commitSet = <K extends keyof typeof props>(key: K, before: (typeof props)[K], after: (typeof props)[K]) => {
    runCommand(
      new PropertyCommand(
        `Edit light ${String(key)}`,
        () => {
          props[key] = after
          applyLightProps(actor, props)
        },
        () => {
          props[key] = before
          applyLightProps(actor, props)
        },
      ),
    )
  }

  const isPointOrSpot = actor.type === 'PointLight' || actor.type === 'SpotLight'
  return (
    <Section title="Light">
      <ColorField label="Color" value={props.color} onLive={(v) => liveSet('color', v)} onCommit={(b, a) => commitSet('color', b, a)} />
      <Num label="Intensity" value={props.intensity} step={0.5} min={0} onLive={(v) => liveSet('intensity', v)} onCommit={(b, a) => commitSet('intensity', b, a)} />
      {isPointOrSpot && (
        <>
          <Num label="Distance" value={props.distance ?? 0} step={1} min={0} onLive={(v) => liveSet('distance', v)} onCommit={(b, a) => commitSet('distance', b, a)} />
          <Num label="Decay" value={props.decay ?? 2} step={0.1} min={0} onLive={(v) => liveSet('decay', v)} onCommit={(b, a) => commitSet('decay', b, a)} />
        </>
      )}
      {actor.type === 'SpotLight' && (
        <>
          <Num label="Angle" value={props.angle ?? 0.5} step={0.05} min={0} max={Math.PI / 2} onLive={(v) => liveSet('angle', v)} onCommit={(b, a) => commitSet('angle', b, a)} />
          <Num label="Penumbra" value={props.penumbra ?? 0} step={0.05} min={0} max={1} onLive={(v) => liveSet('penumbra', v)} onCommit={(b, a) => commitSet('penumbra', b, a)} />
        </>
      )}
      {actor.type !== 'AmbientLight' && (
        <Check label="Cast Shadow" value={!!props.castShadow} onToggle={(v) => commitSet('castShadow', props.castShadow, v)} />
      )}
    </Section>
  )
}

function CameraSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const props = actor.cameraProps!
  const apply = () => {
    actor.camera!.fov = props.fov
    actor.camera!.near = props.near
    actor.camera!.far = props.far
    actor.camera!.updateProjectionMatrix()
    touch()
  }
  const setCam = <K extends keyof CameraProps>(key: K, value: CameraProps[K]) => {
    props[key] = value
    touch()
  }
  return (
    <Section title="Camera">
      <Num label="FOV" value={props.fov} step={1} min={1} max={170} onLive={(v) => { props.fov = v; apply() }} onCommit={() => {}} />
      <Num label="Near" value={props.near} step={0.05} min={0.01} onLive={(v) => { props.near = v; apply() }} onCommit={() => {}} />
      <Num label="Far" value={props.far} step={10} min={1} onLive={(v) => { props.far = v; apply() }} onCommit={() => {}} />
      <Check
        label="DOF Override (CineCamera)"
        value={!!props.dofOverride}
        onToggle={(v) => setCam('dofOverride', v)}
      />
      {props.dofOverride && (
        <>
          <Num
            label="Focus Distance"
            value={props.dofFocusDistance ?? 5}
            step={0.5}
            min={0.5}
            onLive={(v) => setCam('dofFocusDistance', v)}
            onCommit={() => {}}
          />
          <Num
            label="Focal Length"
            value={props.dofFocalLength ?? 2}
            step={0.1}
            min={0.1}
            onLive={(v) => setCam('dofFocalLength', v)}
            onCommit={() => {}}
          />
          <Num
            label="Bokeh Scale"
            value={props.dofBokehScale ?? 1.2}
            step={0.1}
            min={0.1}
            onLive={(v) => setCam('dofBokehScale', v)}
            onCommit={() => {}}
          />
          <Check
            label="Focus Pull (on Play)"
            value={!!props.dofFocusPull}
            onToggle={(v) => setCam('dofFocusPull', v)}
          />
          {props.dofFocusPull && (
            <>
              <Num
                label="Pull From"
                value={props.dofFocusPullFrom ?? 8}
                step={0.5}
                min={0.5}
                onLive={(v) => setCam('dofFocusPullFrom', v)}
                onCommit={() => {}}
              />
              <Num
                label="Pull To"
                value={props.dofFocusPullTo ?? 2}
                step={0.5}
                min={0.5}
                onLive={(v) => setCam('dofFocusPullTo', v)}
                onCommit={() => {}}
              />
              <Num
                label="Pull Duration"
                value={props.dofFocusPullDuration ?? 2}
                step={0.1}
                min={0.1}
                onLive={(v) => setCam('dofFocusPullDuration', v)}
                onCommit={() => {}}
              />
            </>
          )}
        </>
      )}
    </Section>
  )
}

function PawnSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  return (
    <Section title="Pawn">
      <label className="field">
        <span>Mode</span>
        <select
          value={actor.pawnMode ?? 'fly'}
          onChange={(e) => {
            const prev = actor.pawnMode
            const next = e.target.value as Actor['pawnMode']
            runCommand(
              new PropertyCommand(
                `Pawn mode: ${next}`,
                () => (actor.pawnMode = next),
                () => (actor.pawnMode = prev),
              ),
            )
            touch()
          }}
        >
          <option value="fly">Fly (spectator)</option>
          <option value="firstperson">First Person</option>
          <option value="thirdperson">Third Person</option>
          <option value="vehicle">Vehicle (arcade car)</option>
        </select>
      </label>
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        WASD move · mouse look · Space jump · Shift sprint
      </div>
    </Section>
  )
}

function PhysicsSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const props = actor.physicsProps!
  const setMode = (mode: typeof props.mode) => {
    const prev = props.mode
    const prevMobility = actor.mobility
    runCommand(
      new PropertyCommand(
        `Physics: ${mode}`,
        () => {
          props.mode = mode
          if (mode === 'dynamic') actor.mobility = 'movable' // dynamic requires Movable
        },
        () => {
          props.mode = prev
          actor.mobility = prevMobility
        },
      ),
    )
  }
  return (
    <Section title="Physics">
      <label className="field">
        <span>Body Type</span>
        <select value={props.mode} onChange={(e) => setMode(e.target.value as typeof props.mode)}>
          <option value="none">None</option>
          <option value="static">Static (collides)</option>
          <option value="dynamic" disabled={!actor.canMoveAtRuntime()}>
            Dynamic (simulated){!actor.canMoveAtRuntime() ? ' — needs Movable' : ''}
          </option>
        </select>
      </label>
      {props.mode === 'dynamic' && (
        <Num label="Mass" value={props.mass} step={0.5} min={0.01} onLive={(v) => { props.mass = v; touch() }} onCommit={() => {}} />
      )}
      {props.mode !== 'none' && (
        <>
          <Num label="Friction" value={props.friction} step={0.05} min={0} max={2} onLive={(v) => { props.friction = v; touch() }} onCommit={() => {}} />
          <Num label="Bounciness" value={props.restitution} step={0.05} min={0} max={1} onLive={(v) => { props.restitution = v; touch() }} onCommit={() => {}} />
        </>
      )}
      {props.mode !== 'none' && (
        <>
          <label className="field">
            <span>Layer</span>
            <select
              value={props.layer ?? 0}
              onChange={(e) => {
                props.layer = parseInt(e.target.value)
                touch()
              }}
            >
              {[0, 1, 2, 3, 4, 5, 6, 7].map((l) => (
                <option key={l} value={l}>Layer {l}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Collides</span>
            <span className="layer-mask">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((l) => {
                const mask = props.collidesWith ?? 0xffff
                const on = (mask & (1 << l)) !== 0
                return (
                  <button
                    key={l}
                    className={on ? 'active' : ''}
                    title={`Collides with layer ${l}`}
                    onClick={(e) => {
                      e.preventDefault()
                      props.collidesWith = on ? mask & ~(1 << l) : mask | (1 << l)
                      touch()
                    }}
                  >
                    {l}
                  </button>
                )
              })}
            </span>
          </label>
        </>
      )}
      {props.mode === 'dynamic' && (
        <>
          <Check label="Breakable" value={!!props.breakable} onToggle={(v) => { props.breakable = v; touch() }} />
          {props.breakable && (
            <>
              <Num label="Break Force" value={props.breakThreshold ?? 6} step={0.5} min={1} onLive={(v) => { props.breakThreshold = v; touch() }} onCommit={() => {}} />
              <Num label="Fracture Strain" value={props.fractureStrain ?? 1} step={0.1} min={0.1} max={4} onLive={(v) => { props.fractureStrain = v; touch() }} onCommit={() => {}} />
            </>
          )}
        </>
      )}
      <div className="panel-empty" style={{ padding: '2px 0' }}>Simulates during Play.</div>
    </Section>
  )
}

function ColorGradient4({
  colors,
  onChange,
}: {
  colors: [string, string, string, string]
  onChange: (c: [string, string, string, string]) => void
}) {
  return (
    <div className="color-gradient-4">
      <div className="color-gradient-bar" style={{ background: `linear-gradient(90deg, ${colors.join(', ')})` }} />
      <div className="color-gradient-stops">
        {colors.map((c, i) => (
          <input
            key={i}
            type="color"
            title={`Stop ${i + 1}`}
            value={c}
            onChange={(e) => {
              const next = [...colors] as [string, string, string, string]
              next[i] = e.target.value
              onChange(next)
            }}
          />
        ))}
      </div>
    </div>
  )
}

function SizeCurve4({
  values,
  max = 1,
  onChange,
}: {
  values: [number, number, number, number]
  max?: number
  onChange: (v: [number, number, number, number]) => void
}) {
  const w = 200
  const h = 48
  const pad = 4
  const innerH = h - pad * 2
  const toY = (v: number) => pad + innerH - (v / max) * innerH
  const xs = [0, w * 0.33, w * 0.66, w]
  const path = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xs[i].toFixed(1)} ${toY(v).toFixed(1)}`)
    .join(' ')
  const fillPath = `${path} L ${w} ${h - pad} L 0 ${h - pad} Z`
  return (
    <div className="size-curve-4">
      <svg className="size-curve-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <path d={fillPath} className="size-curve-fill" />
        <path d={path} className="size-curve-line" fill="none" />
        {values.map((v, i) => (
          <circle key={i} cx={xs[i]} cy={toY(v)} r={3} className="size-curve-dot" />
        ))}
      </svg>
      <div className="size-curve-stops">
        {values.map((v, i) => (
          <label key={i} className="size-curve-stop" title={`Stop ${i + 1} (${Math.round((i / 3) * 100)}%)`}>
            <input
              type="range"
              min={0}
              max={max}
              step={0.01}
              value={v}
              onChange={(e) => {
                const next = [...values] as [number, number, number, number]
                next[i] = parseFloat(e.target.value)
                onChange(next)
              }}
            />
            <span>{v.toFixed(2)}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

function ParticlesSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const props = actor.particleProps!
  const sys = actor.particleSystem!
  const setNum = (key: keyof typeof props, v: number) => {
    ;(props as unknown as Record<string, number>)[key as string] = v
    touch()
  }
  const moduleOff = (m: string) => props.modulesOff?.includes(m) ?? false
  const toggleModule = (m: string) => {
    props.modulesOff = props.modulesOff ?? []
    props.modulesOff = moduleOff(m) ? props.modulesOff.filter((x) => x !== m) : [...props.modulesOff, m]
    touch()
  }
  const Module = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
    <div className={`px-module ${moduleOff(id) ? 'off' : ''}`}>
      <div className="px-module-head">
        <input type="checkbox" checked={!moduleOff(id)} onChange={() => toggleModule(id)} title="Enable module" />
        <span>{title}</span>
      </div>
      {!moduleOff(id) && <div className="details-grid">{children}</div>}
    </div>
  )
  return (
    <Section title="Particle Emitter (module stack)">
      <Module id="spawn" title="Spawn">
        <Num label="Rate /s" value={props.rate} step={5} min={0} onLive={(v) => setNum('rate', v)} onCommit={() => {}} />
        <Num label="Burst" value={props.burst} step={10} min={0} onLive={(v) => setNum('burst', v)} onCommit={() => {}} />
        <Num label="Lifetime" value={props.lifetime} step={0.1} min={0.05} onLive={(v) => setNum('lifetime', v)} onCommit={() => {}} />
      </Module>
      <Module id="shape" title="Shape Location">
        <label className="field">
          <span>Shape</span>
          <select value={props.shape} onChange={(e) => { props.shape = e.target.value as typeof props.shape; touch() }}>
            <option value="point">Point</option>
            <option value="sphere">Sphere</option>
            <option value="cone">Cone</option>
            <option value="box">Box</option>
          </select>
        </label>
        <Num label="Size" value={props.shapeRadius} step={0.05} min={0} onLive={(v) => setNum('shapeRadius', v)} onCommit={() => {}} />
      </Module>
      <Module id="velocity" title="Add Velocity">
        <Num label="Speed" value={props.speed} step={0.2} min={0} onLive={(v) => setNum('speed', v)} onCommit={() => {}} />
        {props.shape === 'cone' && (
          <Num label="Spread°" value={props.spreadDeg} step={1} min={0} max={90} onLive={(v) => setNum('spreadDeg', v)} onCommit={() => {}} />
        )}
      </Module>
      <Module id="forces" title="Forces (Gravity + Drag)">
        <Num label="Gravity" value={props.gravity} step={0.2} onLive={(v) => setNum('gravity', v)} onCommit={() => {}} />
        <Num label="Drag" value={props.drag} step={0.1} min={0} onLive={(v) => setNum('drag', v)} onCommit={() => {}} />
        <Check label="Ground Bounce" value={props.groundBounce ?? false} onToggle={(v) => { props.groundBounce = v; touch() }} />
        {(props.groundBounce ?? false) && (
          <Num label="Bounce Factor" value={props.bounceFactor ?? 0.45} step={0.05} min={0} max={1} onLive={(v) => setNum('bounceFactor', v)} onCommit={() => {}} />
        )}
      </Module>
      <Module id="colorOverLife" title="Color Over Life">
        <ColorField label="Start" value={props.colorStart} onLive={(v) => { props.colorStart = v; touch() }} onCommit={() => {}} />
        <ColorField label="End" value={props.colorEnd} onLive={(v) => { props.colorEnd = v; touch() }} onCommit={() => {}} />
        <label className="field span-2">
          <span>4-Point Gradient</span>
          <ColorGradient4
            colors={props.colorGradient ?? [props.colorStart, props.colorStart, props.colorEnd, props.colorEnd]}
            onChange={(c) => {
              props.colorGradient = c
              props.colorStart = c[0]
              props.colorEnd = c[3]
              touch()
            }}
          />
        </label>
      </Module>
      <Module id="sizeOverLife" title="Size Over Life">
        <Num label="Start" value={props.sizeStart} step={0.02} min={0.01} onLive={(v) => setNum('sizeStart', v)} onCommit={() => {}} />
        <Num label="End" value={props.sizeEnd} step={0.02} min={0} onLive={(v) => setNum('sizeEnd', v)} onCommit={() => {}} />
        <label className="field span-2">
          <span>4-Point Size Curve</span>
          <SizeCurve4
            values={props.sizeCurve ?? [props.sizeStart, props.sizeStart, props.sizeEnd, props.sizeEnd]}
            max={Math.max(0.5, props.sizeStart, props.sizeEnd, ...(props.sizeCurve ?? []))}
            onChange={(v) => {
              props.sizeCurve = v
              props.sizeStart = v[0]
              props.sizeEnd = v[3]
              touch()
            }}
          />
        </label>
      </Module>
      <Module id="wind" title="Wind Force">
        <Num label="Wind X" value={props.windX ?? 0.6} step={0.1} onLive={(v) => setNum('windX', v)} onCommit={() => {}} />
        <Num label="Wind Y" value={props.windY ?? 0} step={0.1} onLive={(v) => setNum('windY', v)} onCommit={() => {}} />
        <Num label="Wind Z" value={props.windZ ?? 0} step={0.1} onLive={(v) => setNum('windZ', v)} onCommit={() => {}} />
      </Module>
      <Module id="rotation" title="Rotation Over Life">
        <Num label="Spin °/s" value={props.rotationSpeed ?? 45} step={5} onLive={(v) => setNum('rotationSpeed', v)} onCommit={() => {}} />
      </Module>
      <Module id="collision" title="Collision (Sphere)">
        <Num label="Radius" value={props.collisionRadius ?? 0.35} step={0.05} min={0} onLive={(v) => setNum('collisionRadius', v)} onCommit={() => {}} />
        <Num label="Bounce" value={props.collisionBounce ?? 0.55} step={0.05} min={0} max={1} onLive={(v) => setNum('collisionBounce', v)} onCommit={() => {}} />
      </Module>
      <Module id="subEmitter" title="Sub-Emitter (Events)">
        <Check
          label="Enabled"
          value={props.subEmitter?.enabled ?? false}
          onToggle={(v) => {
            props.subEmitter = { ...(props.subEmitter ?? { onDeath: true, onCollision: false, count: 8, speed: 1.5, lifetime: 0.4, enabled: false }), enabled: v }
            touch()
          }}
        />
        {(props.subEmitter?.enabled ?? false) && (
          <>
            <Check
              label="On Death"
              value={props.subEmitter?.onDeath ?? true}
              onToggle={(v) => {
                props.subEmitter = { ...props.subEmitter!, onDeath: v }
                touch()
              }}
            />
            <Check
              label="On Collision"
              value={props.subEmitter?.onCollision ?? false}
              onToggle={(v) => {
                props.subEmitter = { ...props.subEmitter!, onCollision: v }
                touch()
              }}
            />
            <Num
              label="Burst Count"
              value={props.subEmitter?.count ?? 8}
              step={1}
              min={1}
              max={64}
              onLive={(v) => {
                props.subEmitter = { ...props.subEmitter!, count: v }
                touch()
              }}
              onCommit={() => {}}
            />
            <Num
              label="Burst Speed"
              value={props.subEmitter?.speed ?? 1.5}
              step={0.1}
              min={0}
              onLive={(v) => {
                props.subEmitter = { ...props.subEmitter!, speed: v }
                touch()
              }}
              onCommit={() => {}}
            />
            <Num
              label="Child Lifetime"
              value={props.subEmitter?.lifetime ?? 0.4}
              step={0.05}
              min={0.05}
              onLive={(v) => {
                props.subEmitter = { ...props.subEmitter!, lifetime: v }
                touch()
              }}
              onCommit={() => {}}
            />
          </>
        )}
      </Module>
      <Module id="renderer" title="Renderer">
        <label className="field">
          <span>Render Mode</span>
          <select
            value={props.renderMode ?? 'points'}
            onChange={(e) => {
              props.renderMode = e.target.value as typeof props.renderMode
              sys.refresh()
              touch()
            }}
          >
            <option value="points">Points (sprites)</option>
            <option value="ribbon">Ribbon (trail strip)</option>
            <option value="mesh">Mesh (instanced)</option>
          </select>
        </label>
        {(props.renderMode ?? 'points') === 'mesh' && (
          <label className="field">
            <span>Mesh Shape</span>
            <select
              value={props.meshShape ?? 'box'}
              onChange={(e) => {
                props.meshShape = e.target.value as typeof props.meshShape
                sys.refresh()
                touch()
              }}
            >
              <option value="box">Box</option>
              <option value="sphere">Sphere</option>
            </select>
          </label>
        )}
        {(props.renderMode ?? 'points') === 'ribbon' && (
          <>
            <Num label="Ribbon Width" value={props.ribbonWidth ?? 0.08} step={0.01} min={0.01} onLive={(v) => { setNum('ribbonWidth', v); sys.refresh() }} onCommit={() => {}} />
            <Num label="Trail Segments" value={props.ribbonSegments ?? 8} step={1} min={3} max={32} onLive={(v) => { setNum('ribbonSegments', v); sys.refresh() }} onCommit={() => {}} />
          </>
        )}
        <Check label="Additive Glow" value={props.additive} onToggle={(v) => { props.additive = v; sys.refresh(); touch() }} />
        <Num label="Max Particles" value={props.maxParticles} step={50} min={10} onLive={(v) => setNum('maxParticles', v)} onCommit={() => {}} />
      </Module>
      <div className="panel-empty" style={{ padding: '2px 0' }}>Uncheck a module to disable it — Niagara-style stack.</div>
    </Section>
  )
}
function FoliageSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const foliagePaint = useEditor((s) => s.foliagePaint)
  const setFoliagePaint = useEditor((s) => s.setFoliagePaint)
  const props = actor.foliageProps!
  const gridMode = !!props.snap
  const activeLayer = activeGridLayerIndex(props)
  const rebuild = () => {
    buildFoliageMesh(actor)
    touch()
  }
  return (
    <Section title={gridMode ? 'GridMap' : 'Foliage'}>
      <label className="field">
        <span>{gridMode ? 'Tile' : 'Mesh'}</span>
        <select
          value={props.geometry}
          onChange={(e) => {
            props.geometry = e.target.value as typeof props.geometry
            rebuild()
          }}
        >
          {(gridMode ? ['box', 'sphere', 'plane'] : ['cone', 'sphere', 'cylinder', 'box', 'icosahedron', 'capsule']).map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </label>
      <ColorField label="Color" value={props.color} onLive={(v) => { props.color = v; rebuild() }} onCommit={() => {}} />
      {!gridMode && (
        <>
          <Num label="Density" value={props.density} step={1} min={1} max={40} onLive={(v) => { props.density = v; touch() }} onCommit={() => {}} />
          <Num label="Brush Size" value={props.brushRadius} step={0.25} min={0.25} onLive={(v) => { props.brushRadius = v; touch() }} onCommit={() => {}} />
          <Num label="Scale Min" value={props.scaleMin} step={0.1} min={0.05} onLive={(v) => { props.scaleMin = v; touch() }} onCommit={() => {}} />
          <Num label="Scale Max" value={props.scaleMax} step={0.1} min={0.05} onLive={(v) => { props.scaleMax = v; touch() }} onCommit={() => {}} />
        </>
      )}
      {gridMode && (
        <>
          <label className="field">
            <span>Layer</span>
            <div className="paint-layers">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`paint-layer ${activeLayer === i ? 'active' : ''}`}
                  onClick={() => {
                    props.activeGridLayer = i
                    touch()
                  }}
                >
                  {i}
                </span>
              ))}
            </div>
          </label>
          <label className="field check">
            <span>Autotile</span>
            <input
              type="checkbox"
              checked={!!props.gridAutotile}
              onChange={(e) => {
                props.gridAutotile = e.target.checked
                touch()
              }}
            />
          </label>
          <label className="field check">
            <span>Autotile rules</span>
            <input
              type="checkbox"
              checked={!!props.gridAutotileRules}
              onChange={(e) => {
                props.gridAutotileRules = e.target.checked
                buildFoliageMesh(actor)
                touch()
              }}
            />
          </label>
          <label className="field check">
            <span>Autotile preview</span>
            <input
              type="checkbox"
              checked={!!props.gridAutotilePreview}
              onChange={(e) => {
                props.gridAutotilePreview = e.target.checked
                touch()
              }}
            />
          </label>
          <label className="field check">
            <span>Autotile atlas UV</span>
            <input
              type="checkbox"
              checked={!!props.gridAutotileAtlas}
              onChange={(e) => {
                props.gridAutotileAtlas = e.target.checked
                buildFoliageMesh(actor)
                touch()
              }}
            />
          </label>
          {props.gridAutotileAtlas && (
            <div className="panel-empty" style={{ padding: '4px 0' }}>
              <div style={{ fontSize: 11, marginBottom: 4 }}>
                Atlas {props.gridAtlasCols ?? DEFAULT_ATLAS_COLS}×{props.gridAtlasRows ?? DEFAULT_ATLAS_ROWS} ·{' '}
                {AUTOTILE_ATLAS_SIZE} tiles
              </div>
              <label className="field">
                <span>Custom sheet</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    type="file"
                    accept="image/png"
                    style={{ maxWidth: '100%' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      const reader = new FileReader()
                      reader.onload = () => {
                        const dataUrl = String(reader.result ?? '')
                        if (!dataUrl.startsWith('data:image')) return
                        const sheet = importAtlasSheet(dataUrl, f.name.replace(/\.png$/i, ''))
                        props.gridAtlasSheetId = sheet.id
                        buildFoliageMesh(actor)
                        touch()
                        useEditor.getState().setStatus(`Autotile sheet: ${sheet.name}`)
                      }
                      reader.readAsDataURL(f)
                      e.target.value = ''
                    }}
                  />
                  <select
                    value={props.gridAtlasSheetId ?? ''}
                    onChange={(e) => {
                      props.gridAtlasSheetId = e.target.value || undefined
                      buildFoliageMesh(actor)
                      touch()
                    }}
                  >
                    <option value="">Debug palette</option>
                    {listAtlasSheets().map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
              <div style={{ fontSize: 10, margin: '6px 0 4px', color: '#8a9bb5' }}>
                Tile map — assign mask index per atlas slot (click cycles 0–15)
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${props.gridAtlasCols ?? DEFAULT_ATLAS_COLS}, 1fr)`,
                  gap: 2,
                  maxWidth: 200,
                }}
              >
                {Array.from({ length: AUTOTILE_ATLAS_SIZE }, (_, slot) => {
                  const tileMap = getTileMap(props)
                  const mask = tileMap[slot] ?? slot
                  const sheet = props.gridAtlasSheetId
                    ? listAtlasSheets().find((s) => s.id === props.gridAtlasSheetId)
                    : undefined
                  const rect = atlasUvRect(slot, props.gridAtlasCols ?? DEFAULT_ATLAS_COLS, props.gridAtlasRows ?? DEFAULT_ATLAS_ROWS)
                  return (
                    <button
                      key={slot}
                      type="button"
                      title={`Slot ${slot} → mask ${mask} · u=${rect.u.toFixed(2)} v=${rect.v.toFixed(2)}`}
                      onClick={() => {
                        const next = (mask + 1) % AUTOTILE_ATLAS_SIZE
                        setTileMapSlot(props, slot, next)
                        rebuild()
                      }}
                      style={{
                        background: sheet
                          ? `url(${sheet.dataUrl}) ${-rect.u * 100}% ${-(1 - rect.v - rect.h) * 100}% / ${(props.gridAtlasCols ?? DEFAULT_ATLAS_COLS) * 100}% ${(props.gridAtlasRows ?? DEFAULT_ATLAS_ROWS) * 100}% no-repeat`
                          : ATLAS_PALETTE[slot % ATLAS_PALETTE.length],
                        border: '1px solid #1a1d24',
                        borderRadius: 2,
                        color: '#e8eaed',
                        fontSize: 8,
                        fontWeight: 600,
                        lineHeight: '22px',
                        textAlign: 'center',
                        padding: 0,
                        cursor: 'pointer',
                        textShadow: '0 0 2px #000',
                      }}
                    >
                      {slot}→{mask}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <label className="field">
            <span>Layer visibility</span>
            <div className="paint-layers">
              {[0, 1, 2, 3].map((i) => (
                <label key={i} className="paint-layer" title={`Layer ${i} visible in viewport`}>
                  <input
                    type="checkbox"
                    checked={isGridLayerVisible(props, i)}
                    onChange={(e) => {
                      setGridLayerVisible(props, i, e.target.checked)
                      rebuild()
                    }}
                  />
                  {i}
                </label>
              ))}
            </div>
          </label>
          <label className="field">
            <span>Collision group</span>
            <div className="paint-layers">
              {[0, 1, 2, 3].map((i) => (
                <label key={i} className="paint-layer" title={`Grid layer ${i} physics membership`}>
                  <span style={{ fontSize: 9, marginRight: 2 }}>{i}</span>
                  <select
                    value={membershipFromRapierGroup(getLayerCollisionGroup(props, i))}
                    onChange={(e) => {
                      const membership = parseInt(e.target.value, 10)
                      const mask = maskFromRapierGroup(getLayerCollisionGroup(props, i))
                      setLayerCollisionGroup(props, i, rapierGroupsFromLayerMask(membership, mask))
                      rebuildFoliageColliders(actor)
                      touch()
                    }}
                  >
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((l) => (
                      <option key={l} value={l}>
                        L{l}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </label>
          <label className="field">
            <span>Navmesh walkable</span>
            <div className="paint-layers">
              {[0, 1, 2, 3].map((i) => (
                <label key={i} className="paint-layer" title={`Layer ${i} included in navmesh bake`}>
                  <input
                    type="checkbox"
                    checked={isLayerInNavmeshMask(getNavmeshLayerMask(props), i)}
                    onChange={(e) => {
                      const cur = getNavmeshLayerMask(props)
                      const bit = 1 << i
                      setNavmeshLayerMask(props, e.target.checked ? cur | bit : cur & ~bit)
                      touch()
                    }}
                  />
                  {i}
                </label>
              ))}
            </div>
          </label>
          <Num
            label="Grid Brush"
            value={props.gridBrushSize ?? 0}
            step={1}
            min={0}
            max={8}
            onLive={(v) => {
              props.gridBrushSize = Math.max(0, Math.floor(v))
              touch()
            }}
            onCommit={() => {}}
          />
        </>
      )}
      <label className="field check">
        <span>Paint Mode</span>
        <input type="checkbox" checked={foliagePaint} onChange={(e) => setFoliagePaint(e.target.checked)} />
      </label>
      <button
        onClick={() => {
          if (gridMode) {
            if (props.gridLayers) props.gridLayers[activeLayer] = []
            else props.instances = []
            syncGridInstancesFromLayers(props)
          } else {
            props.instances = []
          }
          rebuild()
        }}
      >
        Clear (
        {gridMode ? getLayerCellCount(props, activeLayer) : props.instances.length}{' '}
        {gridMode ? `layer ${activeLayer} tiles` : 'instances'})
      </button>
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        {gridMode
          ? 'Click-drag paints active layer · Shift erases · autotile rules match neighbor tile kinds + corners.'
          : 'Click-drag paints onto surfaces · Shift erases.'}
      </div>
    </Section>
  )
}

function PaintLayerPicker({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const paintLayer = useEditor((s) => s.paintLayer)
  const setPaintLayer = useEditor((s) => s.setPaintLayer)
  const props = actor.landscapeProps!
  const layers = props.layerColors ?? ['#46553f', '#6e6e72', '#6e5239', '#dfe7ec']
  return (
    <div className="paint-layers">
      {layers.map((c, i) => (
        <span key={i} className={`paint-layer ${paintLayer === i ? 'active' : ''}`} onClick={() => setPaintLayer(i)}>
          <input
            type="color"
            value={c}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              layers[i] = e.target.value
              props.layerColors = layers as [string, string, string, string]
              syncLandscapeColors(actor)
              touch()
            }}
          />
        </span>
      ))}
    </div>
  )
}

function LandscapeSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const sculptActive = useEditor((s) => s.sculptActive)
  const setSculptActive = useEditor((s) => s.setSculptActive)
  const sculptTool = useEditor((s) => s.sculptTool)
  const setSculptTool = useEditor((s) => s.setSculptTool)
  const sculptRadius = useEditor((s) => s.sculptRadius)
  const setSculptRadius = useEditor((s) => s.setSculptRadius)
  const sculptStrength = useEditor((s) => s.sculptStrength)
  const setSculptStrength = useEditor((s) => s.setSculptStrength)
  const props = actor.landscapeProps!
  return (
    <Section title="Landscape">
      <label className="field check">
        <span>Splat texture paint (Wave 11)</span>
        <input
          type="checkbox"
          checked={!!props.useSplatMap}
          onChange={(e) => {
            props.useSplatMap = e.target.checked
            buildLandscapeMesh(actor)
            touch()
          }}
        />
      </label>
      <label className="field check">
        <span>Sculpt Mode</span>
        <input type="checkbox" checked={sculptActive} onChange={(e) => setSculptActive(e.target.checked)} />
      </label>
      <label className="field">
        <span>Tool</span>
        <select value={sculptTool} onChange={(e) => setSculptTool(e.target.value as typeof sculptTool)}>
          <option value="raise">Raise (Shift lowers)</option>
          <option value="lower">Lower</option>
          <option value="smooth">Smooth</option>
          <option value="flatten">Flatten</option>
          <option value="paint">Paint Layer</option>
        </select>
      </label>
      {sculptTool === 'paint' && <PaintLayerPicker actor={actor} />}
      <Num label="Brush Size" value={sculptRadius} step={0.5} min={0.5} max={30} onLive={setSculptRadius} onCommit={() => {}} />
      <Num label="Strength" value={sculptStrength} step={0.05} min={0.01} max={2} onLive={setSculptStrength} onCommit={() => {}} />
      <ColorField
        label="Color"
        value={props.color}
        onLive={(v) => {
          props.color = v
          ;(actor.mesh!.material as THREE.MeshStandardMaterial).color.set(v)
          touch()
        }}
        onCommit={() => {}}
      />
      <button
        onClick={() => {
          props.heights.fill(0)
          syncLandscapeHeights(actor)
          touch()
        }}
      >
        Flatten All
      </button>
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        {props.resolution}×{props.resolution} · {props.size}m · click-drag to sculpt
      </div>
    </Section>
  )
}

function ScriptVarsSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const exports = parseExports(actor.script ?? '')
  if (exports.length === 0) return null
  return (
    <Section title="Script Variables">
      {exports.map((ev) => {
        const current = actor.scriptVars?.[ev.name] ?? ev.value
        const setVar = (v: unknown) => {
          actor.scriptVars = { ...(actor.scriptVars ?? {}), [ev.name]: v }
          touch()
        }
        if (ev.kind === 'range') {
          const num = clampExportRange(ev, Number(current))
          return (
            <Num
              key={ev.name}
              label={ev.name}
              value={num}
              step={ev.step ?? 0.1}
              min={ev.min}
              max={ev.max}
              onLive={(v) => setVar(clampExportRange(ev, v))}
              onCommit={() => {}}
            />
          )
        }
        if (ev.kind === 'enum' && ev.options?.length) {
          return (
            <label className="field" key={ev.name}>
              <span>{ev.name}</span>
              <select value={String(current)} onChange={(e) => setVar(e.target.value)}>
                {ev.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          )
        }
        if (typeof ev.value === 'boolean') {
          return <Check key={ev.name} label={ev.name} value={Boolean(current)} onToggle={setVar} />
        }
        if (typeof ev.value === 'number') {
          return <Num key={ev.name} label={ev.name} value={Number(current)} onLive={setVar} onCommit={() => {}} />
        }
        if (typeof ev.value === 'string' && /^#[0-9a-f]{6}$/i.test(ev.value)) {
          return <ColorField key={ev.name} label={ev.name} value={String(current)} onLive={setVar} onCommit={() => {}} />
        }
        return (
          <label className="field" key={ev.name}>
            <span>{ev.name}</span>
            <input
              defaultValue={typeof current === 'string' ? current : JSON.stringify(current)}
              onBlur={(e) => {
                try {
                  setVar(JSON.parse(e.target.value))
                } catch {
                  setVar(e.target.value)
                }
              }}
            />
          </label>
        )
      })}
      <div className="panel-empty" style={{ padding: '2px 0' }}>
        From // @export, @export_range, @export_enum — available as vars.name in the script.
      </div>
    </Section>
  )
}

const BEHAVIOR_TEMPLATES: Record<string, Behavior> = {
  rotator: { type: 'rotator', speedX: 0, speedY: 1, speedZ: 0 },
  bobber: { type: 'bobber', amplitude: 0.5, frequency: 0.5 },
  orbiter: { type: 'orbiter', radius: 4, speed: 0.5 },
}

function BehaviorsSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  return (
    <Section title="Behaviors (tick scripts)">
      <div className="behavior-add">
        <select
          value=""
          onChange={(e) => {
            const tpl = BEHAVIOR_TEMPLATES[e.target.value]
            if (!tpl) return
            const next = { ...tpl }
            runCommand(
              new PropertyCommand(
                `Add ${next.type}`,
                () => actor.behaviors.push(next),
                () => actor.behaviors.splice(actor.behaviors.indexOf(next), 1),
              ),
            )
          }}
        >
          <option value="">+ Add Behavior…</option>
          <option value="rotator">Rotator</option>
          <option value="bobber">Bobber</option>
          <option value="orbiter">Orbiter</option>
        </select>
      </div>
      {actor.behaviors.map((b, i) => (
        <div className="behavior" key={`${b.type}_${i}`}>
          <div className="behavior-head">
            <span>{b.type}</span>
            <button
              onClick={() => {
                const removed = actor.behaviors[i]
                runCommand(
                  new PropertyCommand(
                    `Remove ${removed.type}`,
                    () => actor.behaviors.splice(actor.behaviors.indexOf(removed), 1),
                    () => actor.behaviors.splice(i, 0, removed),
                  ),
                )
              }}
            >
              ✕
            </button>
          </div>
          {Object.entries(b)
            .filter(([k]) => k !== 'type')
            .map(([k, v]) => (
              <Num
                key={k}
                label={k}
                value={v as number}
                onLive={(nv) => {
                  ;(b as unknown as Record<string, number>)[k] = nv
                  touch()
                }}
                onCommit={() => {}}
              />
            ))}
        </div>
      ))}
      {actor.behaviors.length === 0 && <div className="panel-empty">No behaviors. They run during Play.</div>}
    </Section>
  )
}

export function Details() {
  const playing = useEditor((s) => s.playing)
  useEditor((s) => (playing ? s.liveVersion : s.sceneVersion))
  const selectedId = useEditor((s) => s.selectedId)
  const actor = selectedId ? world.actors.get(selectedId) : null

  if (!actor) {
    return (
      <div className="panel details">
        <div className="panel-header">
          <span>Details</span>
        </div>
        <div className="panel-body">
          <div className="panel-empty">Select an actor to edit its properties.</div>
          <WorldSettings />
        </div>
      </div>
    )
  }

  return (
    <div className="panel details">
      <div className="panel-header">
        <span>Details</span>
        <span className="panel-meta">
          {playing && <span className="details-live-badge" title="Live values from running simulation">LIVE</span>}
          <button className="prefab-save" title="Save this actor (and children) as a reusable prefab" onClick={() => savePrefab(actor.id)}>
            🧩 Prefab
          </button>
          {actor.name}
        </span>
      </div>
      <div className="outliner-search">
        <input
          type="search"
          placeholder="Search Details"
          onChange={(e) => {
            // UE Search Details: hide non-matching sections/rows
            const q = e.target.value.toLowerCase()
            const body = (e.target as HTMLElement).closest('.details')?.querySelector('.panel-body')
            body?.querySelectorAll<HTMLElement>('.details-section').forEach((sec) => {
              if (!q) {
                sec.style.display = ''
                return
              }
              const match = sec.textContent?.toLowerCase().includes(q)
              sec.style.display = match ? '' : 'none'
            })
          }}
        />
      </div>
      <div className="panel-body">
        <ActorSection actor={actor} />
        <TransformSection actor={actor} />
        <MobilitySection actor={actor} />
        <TagsSection actor={actor} />
        <GroupsSection actor={actor} />
        <AbilitiesSection actor={actor} />
        {actor.type === 'PostProcessVolume' && actor.postProcessProps && <PostProcessSection actor={actor} />}
        {actor.type === 'TriggerVolume' && <TriggerSection actor={actor} />}
        {actor.type === 'Timer' && <TimerSection actor={actor} />}
        {actor.type === 'RayCast3D' && <RayCastSection actor={actor} />}
        {actor.type === 'Path3D' && <Path3DSection actor={actor} />}
        {actor.type === 'PathFollow3D' && <PathFollowSection actor={actor} />}
        {actor.type === 'Area3D' && <Area3DSection actor={actor} />}
        {actor.prefabSource && <PrefabSubtreeSection actor={actor} />}
        {actor.prefabSource && <PrefabOverridesSection actor={actor} />}
        <PrefabOverrideDiffSection actor={actor} />
        {actor.type === 'SoundEmitter' && <SoundEmitterSection actor={actor} />}
        {actor.type === 'Label3D' && <Label3DSection actor={actor} />}
        {actor.type === 'Widget3D' && <Widget3DSection actor={actor} />}
        {actor.type === 'PlayerStart' && <PawnSection actor={actor} />}
        {actor.mesh && actor.materialProps && actor.materialAssetId && <MaterialInstanceSection actor={actor} />}
        {actor.mesh && actor.materialProps && !actor.materialAssetId && <MaterialSection actor={actor} />}
        {actor.light && actor.lightProps && <LightSection actor={actor} />}
        {actor.camera && actor.cameraProps && <CameraSection actor={actor} />}
        {actor.script && <ScriptVarsSection actor={actor} />}
        <NetworkSection actor={actor} />
        <StreamingSection actor={actor} />
        {actor.probeProps && <ProbeSection actor={actor} />}
        {actor.waterProps && <WaterSection actor={actor} />}
        {actor.pcgProps && <PCGSection actor={actor} />}
        {hasActorSkeleton(actor) && <IkSection actor={actor} />}
        {(actor.animations?.length ?? 0) > 0 && <AnimationSection actor={actor} />}
        {actor.physicsProps && actor.type !== 'ParticleEmitter' && <PhysicsSection actor={actor} />}
        {actor.particleProps && actor.particleSystem && <ParticlesSection actor={actor} />}
        {actor.foliageProps && <FoliageSection actor={actor} />}
        {actor.landscapeProps && <LandscapeSection actor={actor} />}
        <BehaviorsSection actor={actor} />
        <WorldSettings />
      </div>
    </div>
  )
}
