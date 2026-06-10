import { useEffect, useRef, useState } from 'react'
import { world } from '../../engine/World'
import { DEFAULT_SCRIPT } from '../../engine/scripting'
import { PropertyCommand, runCommand } from '../commands'
import { useEditor } from '../store'

const TEMPLATES: Record<string, string> = {
  Spinner: `// Constant rotation
function onTick(dt) {
  actor.root.rotation.y += dt * 1.5
}
`,
  Floater: `// Sine-wave hover around the start height
let baseY
function onBeginPlay() {
  baseY = actor.root.position.y
}
function onTick(dt) {
  actor.root.position.y = baseY + Math.sin(api.time() * 2) * 0.5
}
`,
  Pulse: `// Emissive pulse — needs a mesh actor
function onTick(dt) {
  const mat = actor.mesh && actor.mesh.material
  if (!mat) return
  mat.emissive.set('#2f80ed')
  mat.emissiveIntensity = 1 + Math.sin(api.time() * 4) * 0.9
}
`,
  Chaser: `// Walks toward the player pawn
const SPEED = 2.5
function onTick(dt) {
  const target = api.pawnPosition()
  if (!target) return
  const p = actor.root.position
  const dir = new THREE.Vector3(target.x - p.x, 0, target.z - p.z)
  const dist = dir.length()
  if (dist < 1.2) return
  dir.normalize()
  p.x += dir.x * SPEED * dt
  p.z += dir.z * SPEED * dt
  actor.root.rotation.y = Math.atan2(dir.x, dir.z)
}
`,
  Collectible: `// Spin; vanish when the player touches it
let collected = false
function onTick(dt) {
  if (collected) return
  actor.root.rotation.y += dt * 3
  const pawn = api.pawnPosition()
  if (pawn && pawn.distanceTo(actor.root.position) < 1.4) {
    collected = true
    actor.root.visible = false
    api.log('Collected ' + actor.name + '!')
  }
}
`,
  'Input mover': `// Drive this actor with the arrow keys during Play
const SPEED = 4
function onTick(dt) {
  const p = actor.root.position
  if (api.isKeyDown('ArrowUp')) p.z -= SPEED * dt
  if (api.isKeyDown('ArrowDown')) p.z += SPEED * dt
  if (api.isKeyDown('ArrowLeft')) p.x -= SPEED * dt
  if (api.isKeyDown('ArrowRight')) p.x += SPEED * dt
  if (api.keyJustPressed('Enter')) api.log(actor.name + ' at ' + p.x.toFixed(1) + ',' + p.z.toFixed(1))
}
`,
}

/**
 * Script editor — per-actor JavaScript (the GDScript/Blueprint slot).
 * Plain monospace editor; Tab indents; Ctrl+S applies.
 */
export function ScriptEditor() {
  const selectedId = useEditor((s) => s.selectedId)
  useEditor((s) => s.sceneVersion)
  const actor = selectedId ? world.actors.get(selectedId) : null
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const lastActor = useRef<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (actor && actor.id !== lastActor.current) {
      lastActor.current = actor.id
      setDraft(actor.script ?? DEFAULT_SCRIPT)
      setDirty(false)
    }
    if (!actor) lastActor.current = null
  }, [actor])

  if (!actor) {
    return <div className="panel-empty">Select an actor to edit its script. Scripts run during Play — onBeginPlay() and onTick(dt), with actor, api, THREE in scope.</div>
  }

  const apply = () => {
    const before = actor.script
    const after = draft
    runCommand(
      new PropertyCommand(
        `Script ${actor.name}`,
        () => (actor.script = after),
        () => (actor.script = before),
      ),
    )
    setDirty(false)
  }

  return (
    <div className="script-editor">
      <div className="script-toolbar">
        <span className="script-target">
          𝒇 {actor.name}.js {dirty && <em>· unsaved</em>}
        </span>
        <select
          value=""
          title="Insert a script template"
          onChange={(e) => {
            const code = e.target.value === 'blank' ? DEFAULT_SCRIPT : TEMPLATES[e.target.value]
            if (code) {
              setDraft(code)
              setDirty(true)
            }
          }}
        >
          <option value="">Templates…</option>
          <option value="blank">Blank</option>
          {Object.keys(TEMPLATES).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button className="apply" onClick={apply} disabled={!dirty} title="Apply (Ctrl+S)">
          ✓ Apply
        </button>
      </div>
      <textarea
        ref={taRef}
        spellCheck={false}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setDirty(true) }}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault()
            const ta = taRef.current!
            const { selectionStart: a, selectionEnd: b } = ta
            const next = draft.slice(0, a) + '  ' + draft.slice(b)
            setDraft(next)
            setDirty(true)
            requestAnimationFrame(() => ta.setSelectionRange(a + 2, a + 2))
          }
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault()
            apply()
          }
          e.stopPropagation()
        }}
      />
    </div>
  )
}
