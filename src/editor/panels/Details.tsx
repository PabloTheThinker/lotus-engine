import { useRef } from 'react'
import * as THREE from 'three'
import type { Actor } from '../../engine/Actor'
import { applyMaterialProps } from '../../engine/factory'
import { applyLightProps, world } from '../../engine/World'
import type { Behavior, Mobility, PostProcessProps, TransformSnapshot } from '../../engine/types'
import { PropertyCommand, TransformCommand, runCommand } from '../commands'
import { buildFoliageMesh } from '../../engine/factory'
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
}: {
  label: string
  value: number
  step?: number
  min?: number
  max?: number
  onLive: (v: number) => void
  onCommit: (before: number, after: number) => void
}) {
  const before = useRef(value)
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
    </label>
  )
}

function ColorField({
  label,
  value,
  onLive,
  onCommit,
}: {
  label: string
  value: string
  onLive: (v: string) => void
  onCommit: (before: string, after: string) => void
}) {
  const before = useRef(value)
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
      <ColorField label="Base Color" value={props.color} onLive={(v) => liveSet('color', v)} onCommit={(b, a) => commitSet('color', b, a)} />
      <Num label="Roughness" value={props.roughness} step={0.05} min={0} max={1} onLive={(v) => liveSet('roughness', v)} onCommit={(b, a) => commitSet('roughness', b, a)} />
      <Num label="Metalness" value={props.metalness} step={0.05} min={0} max={1} onLive={(v) => liveSet('metalness', v)} onCommit={(b, a) => commitSet('metalness', b, a)} />
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
    runCommand(
      new PropertyCommand(
        `Physics: ${mode}`,
        () => (props.mode = mode),
        () => (props.mode = prev),
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
  return (
    <Section title="Particle Emitter">
      <Num label="Rate /s" value={props.rate} step={5} min={0} onLive={(v) => setNum('rate', v)} onCommit={() => {}} />
      <Num label="Burst" value={props.burst} step={10} min={0} onLive={(v) => setNum('burst', v)} onCommit={() => {}} />
      <Num label="Lifetime" value={props.lifetime} step={0.1} min={0.05} onLive={(v) => setNum('lifetime', v)} onCommit={() => {}} />
      <label className="field">
        <span>Shape</span>
        <select
          value={props.shape}
          onChange={(e) => {
            props.shape = e.target.value as typeof props.shape
            touch()
          }}
        >
          <option value="point">Point</option>
          <option value="sphere">Sphere</option>
          <option value="cone">Cone</option>
          <option value="box">Box</option>
        </select>
      </label>
      <Num label="Shape Size" value={props.shapeRadius} step={0.05} min={0} onLive={(v) => setNum('shapeRadius', v)} onCommit={() => {}} />
      <Num label="Speed" value={props.speed} step={0.2} min={0} onLive={(v) => setNum('speed', v)} onCommit={() => {}} />
      {props.shape === 'cone' && (
        <Num label="Spread°" value={props.spreadDeg} step={1} min={0} max={90} onLive={(v) => setNum('spreadDeg', v)} onCommit={() => {}} />
      )}
      <Num label="Gravity" value={props.gravity} step={0.2} onLive={(v) => setNum('gravity', v)} onCommit={() => {}} />
      <Num label="Drag" value={props.drag} step={0.1} min={0} onLive={(v) => setNum('drag', v)} onCommit={() => {}} />
      <ColorField label="Color Start" value={props.colorStart} onLive={(v) => { props.colorStart = v; touch() }} onCommit={() => {}} />
      <ColorField label="Color End" value={props.colorEnd} onLive={(v) => { props.colorEnd = v; touch() }} onCommit={() => {}} />
      <Num label="Size Start" value={props.sizeStart} step={0.02} min={0.01} onLive={(v) => setNum('sizeStart', v)} onCommit={() => {}} />
      <Num label="Size End" value={props.sizeEnd} step={0.02} min={0} onLive={(v) => setNum('sizeEnd', v)} onCommit={() => {}} />
      <Check
        label="Additive Glow"
        value={props.additive}
        onToggle={(v) => {
          props.additive = v
          sys.refresh()
          touch()
        }}
      />
      <div className="panel-empty" style={{ padding: '2px 0' }}>Previews live; Burst fires at Play start.</div>
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
      <div className="panel-body">
        <TransformSection actor={actor} />
        <MobilitySection actor={actor} />
        <TagsSection actor={actor} />
        {actor.type === 'PostProcessVolume' && actor.postProcessProps && <PostProcessSection actor={actor} />}
        {actor.type === 'PlayerStart' && <PawnSection actor={actor} />}
        {actor.mesh && actor.materialProps && <MaterialSection actor={actor} />}
        {actor.light && actor.lightProps && <LightSection actor={actor} />}
        {actor.camera && actor.cameraProps && <CameraSection actor={actor} />}
        {actor.physicsProps && actor.type !== 'ParticleEmitter' && <PhysicsSection actor={actor} />}
        {actor.particleProps && actor.particleSystem && <ParticlesSection actor={actor} />}
        {actor.foliageProps && <FoliageSection actor={actor} />}
        <BehaviorsSection actor={actor} />
        <WorldSettings />
      </div>
    </div>
  )
}
