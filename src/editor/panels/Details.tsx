import { useRef } from 'react'
import * as THREE from 'three'
import type { Actor } from '../../engine/Actor'
import { applyMaterialProps } from '../../engine/factory'
import { applyLightProps, world } from '../../engine/World'
import type { Behavior, Mobility, PostProcessProps, TransformSnapshot } from '../../engine/types'
import { DEFAULT_MATERIAL } from '../../engine/types'
import { PropertyCommand, TransformCommand, runCommand } from '../commands'
import { buildFoliageMesh } from '../../engine/factory'
import { syncLandscapeColors, syncLandscapeHeights } from '../../engine/landscape'
import { buildWaterMesh } from '../../engine/water'
import { regeneratePCG } from '../../engine/pcg'
import { parseExports } from '../../engine/scripting'
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
}: {
  label: string
  value: number
  step?: number
  min?: number
  max?: number
  onLive: (v: number) => void
  onCommit: (before: number, after: number) => void
  defaultValue?: number
}) {
  const before = useRef(value)
  const modified = defaultValue !== undefined && Math.abs(value - defaultValue) > 1e-6
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
        <button className="reset-default" title={`Reset to ${defaultValue}`} onClick={(e) => { e.preventDefault(); onLive(defaultValue!); onCommit(value, defaultValue!) }}>
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
}: {
  label: string
  value: string
  onLive: (v: string) => void
  onCommit: (before: string, after: string) => void
  defaultValue?: string
}) {
  const before = useRef(value)
  const modified = defaultValue !== undefined && value.toLowerCase() !== defaultValue.toLowerCase()
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
        <button className="reset-default" title={`Reset to ${defaultValue}`} onClick={(e) => { e.preventDefault(); onLive(defaultValue!); onCommit(value, defaultValue!) }}>
          ⟲
        </button>
      )}
    </label>
  )
}

function Check({ label, value, onToggle }: { label: string; value: boolean; onToggle: (v: boolean) => void }) {
  return (
    <label className="field check">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onToggle(e.target.checked)} />
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

function AnimationSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const clips = (actor.animations ?? []).map((c) => c.name)
  if (clips.length === 0) return null
  return (
    <Section title="Animation">
      <label className="field">
        <span>Auto Play</span>
        <select
          value={actor.autoPlayClip ?? ''}
          onChange={(e) => {
            actor.autoPlayClip = e.target.value || undefined
            touch()
          }}
        >
          <option value="">(none)</option>
          {clips.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>
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
  const props = actor.pcgProps!
  const regen = () => {
    regeneratePCG(actor, world.actors)
    touch()
  }
  return (
    <Section title="PCG Scatter (sample → filter → spawn)">
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

function StreamingSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  return (
    <Section title="Streaming">
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
      <div className="panel-empty" style={{ padding: '2px 0' }}>0 = always visible. Hidden beyond this range from the camera.</div>
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

function TransformSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const t = actor.transform

  const live = (mut: (tr: TransformSnapshot) => void) => {
    const next = actor.transform
    mut(next)
    actor.setTransform(next)
    touch()
  }
  const commit = (beforeVal: number, mutBefore: (tr: TransformSnapshot, v: number) => void) => {
    const after = actor.transform
    const before = actor.transform
    mutBefore(before, beforeVal)
    runCommand(new TransformCommand(actor.id, before, after))
  }

  const axes: Array<{ key: 0 | 1 | 2; name: 'X' | 'Y' | 'Z' }> = [
    { key: 0, name: 'X' },
    { key: 1, name: 'Y' },
    { key: 2, name: 'Z' },
  ]

  return (
    <Section title="Transform">
      <div className="vec-label">Location</div>
      <div className="vec-row">
        {axes.map(({ key, name }) => (
          <Num
            key={`p${name}`}
            label={name}
            value={t.position[key]}
            onLive={(v) => live((tr) => (tr.position[key] = v))}
            onCommit={(b) => commit(b, (tr, v) => (tr.position[key] = v))}
          />
        ))}
      </div>
      <div className="vec-label">Rotation°</div>
      <div className="vec-row">
        {axes.map(({ key, name }) => (
          <Num
            key={`r${name}`}
            label={name}
            step={1}
            value={THREE.MathUtils.radToDeg(t.rotation[key])}
            onLive={(v) => live((tr) => (tr.rotation[key] = THREE.MathUtils.degToRad(v)))}
            onCommit={(b) => commit(THREE.MathUtils.degToRad(b), (tr, v) => (tr.rotation[key] = v))}
          />
        ))}
      </div>
      <div className="vec-label">Scale</div>
      <div className="vec-row">
        {axes.map(({ key, name }) => (
          <Num
            key={`s${name}`}
            label={name}
            value={t.scale[key]}
            onLive={(v) => live((tr) => (tr.scale[key] = v))}
            onCommit={(b) => commit(b, (tr, v) => (tr.scale[key] = v))}
          />
        ))}
      </div>
    </Section>
  )
}

function MaterialSection({ actor }: { actor: Actor }) {
  const touch = useEditor((s) => s.touch)
  const props = actor.materialProps!
  const mat = actor.mesh!.material as THREE.MeshStandardMaterial

  const liveSet = <K extends keyof typeof props>(key: K, v: (typeof props)[K]) => {
    props[key] = v
    applyMaterialProps(mat, props)
    touch()
  }
  const commitSet = <K extends keyof typeof props>(key: K, before: (typeof props)[K], after: (typeof props)[K]) => {
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

  return (
    <Section title="Material">
      <ColorField label="Base Color" value={props.color} defaultValue={DEFAULT_MATERIAL.color} onLive={(v) => liveSet('color', v)} onCommit={(b, a) => commitSet('color', b, a)} />
      <Num label="Roughness" value={props.roughness} defaultValue={DEFAULT_MATERIAL.roughness} step={0.05} min={0} max={1} onLive={(v) => liveSet('roughness', v)} onCommit={(b, a) => commitSet('roughness', b, a)} />
      <Num label="Metalness" value={props.metalness} defaultValue={DEFAULT_MATERIAL.metalness} step={0.05} min={0} max={1} onLive={(v) => liveSet('metalness', v)} onCommit={(b, a) => commitSet('metalness', b, a)} />
      <ColorField label="Emissive" value={props.emissive} onLive={(v) => liveSet('emissive', v)} onCommit={(b, a) => commitSet('emissive', b, a)} />
      <Num label="Emissive ×" value={props.emissiveIntensity} step={0.1} min={0} onLive={(v) => liveSet('emissiveIntensity', v)} onCommit={(b, a) => commitSet('emissiveIntensity', b, a)} />
      <Num label="Opacity" value={props.opacity} step={0.05} min={0} max={1} onLive={(v) => liveSet('opacity', v)} onCommit={(b, a) => commitSet('opacity', b, a)} />
      <Check label="Wireframe" value={props.wireframe} onToggle={(v) => commitSet('wireframe', props.wireframe, v)} />
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
  return (
    <Section title="Camera">
      <Num label="FOV" value={props.fov} step={1} min={1} max={170} onLive={(v) => { props.fov = v; apply() }} onCommit={() => {}} />
      <Num label="Near" value={props.near} step={0.05} min={0.01} onLive={(v) => { props.near = v; apply() }} onCommit={() => {}} />
      <Num label="Far" value={props.far} step={10} min={1} onLive={(v) => { props.far = v; apply() }} onCommit={() => {}} />
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
            <Num label="Break Force" value={props.breakThreshold ?? 6} step={0.5} min={1} onLive={(v) => { props.breakThreshold = v; touch() }} onCommit={() => {}} />
          )}
        </>
      )}
      <div className="panel-empty" style={{ padding: '2px 0' }}>Simulates during Play.</div>
    </Section>
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
      </Module>
      <Module id="colorOverLife" title="Color Over Life">
        <ColorField label="Start" value={props.colorStart} onLive={(v) => { props.colorStart = v; touch() }} onCommit={() => {}} />
        <ColorField label="End" value={props.colorEnd} onLive={(v) => { props.colorEnd = v; touch() }} onCommit={() => {}} />
      </Module>
      <Module id="sizeOverLife" title="Size Over Life">
        <Num label="Start" value={props.sizeStart} step={0.02} min={0.01} onLive={(v) => setNum('sizeStart', v)} onCommit={() => {}} />
        <Num label="End" value={props.sizeEnd} step={0.02} min={0} onLive={(v) => setNum('sizeEnd', v)} onCommit={() => {}} />
      </Module>
      <Module id="renderer" title="Sprite Renderer">
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
  const rebuild = () => {
    buildFoliageMesh(actor)
    touch()
  }
  return (
    <Section title="Foliage">
      <label className="field">
        <span>Mesh</span>
        <select
          value={props.geometry}
          onChange={(e) => {
            props.geometry = e.target.value as typeof props.geometry
            rebuild()
          }}
        >
          {['cone', 'sphere', 'cylinder', 'box', 'icosahedron', 'capsule'].map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </label>
      <ColorField label="Color" value={props.color} onLive={(v) => { props.color = v; rebuild() }} onCommit={() => {}} />
      <Num label="Density" value={props.density} step={1} min={1} max={40} onLive={(v) => { props.density = v; touch() }} onCommit={() => {}} />
      <Num label="Brush Size" value={props.brushRadius} step={0.25} min={0.25} onLive={(v) => { props.brushRadius = v; touch() }} onCommit={() => {}} />
      <Num label="Scale Min" value={props.scaleMin} step={0.1} min={0.05} onLive={(v) => { props.scaleMin = v; touch() }} onCommit={() => {}} />
      <Num label="Scale Max" value={props.scaleMax} step={0.1} min={0.05} onLive={(v) => { props.scaleMax = v; touch() }} onCommit={() => {}} />
      <label className="field check">
        <span>Paint Mode</span>
        <input type="checkbox" checked={foliagePaint} onChange={(e) => setFoliagePaint(e.target.checked)} />
      </label>
      <button
        onClick={() => {
          props.instances = []
          rebuild()
        }}
      >
        Clear ({props.instances.length} instances)
      </button>
      <div className="panel-empty" style={{ padding: '2px 0' }}>Click-drag paints onto surfaces · Shift erases.</div>
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
      <div className="panel-empty" style={{ padding: '2px 0' }}>From // @export lines — available as vars.name in the script.</div>
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
  useEditor((s) => s.sceneVersion)
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
        <TransformSection actor={actor} />
        <MobilitySection actor={actor} />
        <TagsSection actor={actor} />
        {actor.type === 'PostProcessVolume' && actor.postProcessProps && <PostProcessSection actor={actor} />}
        {actor.type === 'PlayerStart' && <PawnSection actor={actor} />}
        {actor.mesh && actor.materialProps && <MaterialSection actor={actor} />}
        {actor.light && actor.lightProps && <LightSection actor={actor} />}
        {actor.camera && actor.cameraProps && <CameraSection actor={actor} />}
        {actor.script && <ScriptVarsSection actor={actor} />}
        <StreamingSection actor={actor} />
        {actor.probeProps && <ProbeSection actor={actor} />}
        {actor.waterProps && <WaterSection actor={actor} />}
        {actor.pcgProps && <PCGSection actor={actor} />}
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
