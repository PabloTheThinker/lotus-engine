import { useEffect, useRef, useState } from 'react'
import { world } from '../../engine/World'
import { DEFAULT_SCRIPT } from '../../engine/scripting'
import { PropertyCommand, runCommand } from '../commands'
import { useEditor } from '../store'

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
        <button onClick={() => { setDraft(DEFAULT_SCRIPT); setDirty(true) }}>Template</button>
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
