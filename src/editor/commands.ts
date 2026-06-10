import { world } from '../engine/World'
import type { SerializedActor, TransformSnapshot } from '../engine/types'
import { useEditor } from './store'

/**
 * Command-pattern undo/redo stack — the Unreal Transaction system analog.
 * Every world mutation goes through a Command so it can be reversed.
 */
export interface Command {
  label: string
  execute(): void
  undo(): void
}

const undoStack: Command[] = []
const redoStack: Command[] = []
const MAX_HISTORY = 200

function syncHistoryState() {
  const s = useEditor.getState()
  s.setHistoryState(undoStack.length > 0, redoStack.length > 0)
  s.touch()
}

export function runCommand(cmd: Command) {
  cmd.execute()
  undoStack.push(cmd)
  if (undoStack.length > MAX_HISTORY) undoStack.shift()
  redoStack.length = 0
  useEditor.getState().setStatus(cmd.label)
  syncHistoryState()
}

export function undo() {
  const cmd = undoStack.pop()
  if (!cmd) return
  cmd.undo()
  redoStack.push(cmd)
  useEditor.getState().setStatus(`Undo: ${cmd.label}`)
  syncHistoryState()
}

export function redo() {
  const cmd = redoStack.pop()
  if (!cmd) return
  cmd.execute()
  undoStack.push(cmd)
  useEditor.getState().setStatus(`Redo: ${cmd.label}`)
  syncHistoryState()
}

export function clearHistory() {
  undoStack.length = 0
  redoStack.length = 0
  syncHistoryState()
}

// ---- Concrete commands ----

/** Add an actor from its serialized form (so undo→redo round-trips cleanly). */
export class AddActorCommand implements Command {
  label: string
  private data: SerializedActor
  constructor(data: SerializedActor) {
    this.data = data
    this.label = `Add ${data.name}`
  }
  execute() {
    const actor = world.instantiate(this.data)
    world.addActor(actor, this.data.parentId)
    useEditor.getState().select(actor.id)
  }
  undo() {
    world.removeActor(this.data.id)
    const s = useEditor.getState()
    if (s.selectedId === this.data.id) s.select(null)
  }
}

export class DeleteActorCommand implements Command {
  label: string
  private snapshots: SerializedActor[]
  constructor(actorId: string) {
    // capture the actor AND its entire subtree so undo restores everything
    const collect = (id: string): SerializedActor[] => {
      const actor = world.actors.get(id)
      if (!actor) return []
      return [actor.serialize(), ...world.childrenOf(id).flatMap((c) => collect(c.id))]
    }
    this.snapshots = collect(actorId)
    this.label = `Delete ${this.snapshots[0]?.name ?? 'actor'}`
  }
  execute() {
    // delete leaves first so removeActor's reparenting never fires
    for (const snap of [...this.snapshots].reverse()) world.removeActor(snap.id)
    const s = useEditor.getState()
    if (this.snapshots.some((x) => x.id === s.selectedId)) s.select(null)
  }
  undo() {
    for (const snap of this.snapshots) {
      const actor = world.instantiate(snap)
      world.addActor(actor, snap.parentId)
    }
  }
}

export class TransformCommand implements Command {
  label = 'Transform'
  private actorId: string
  private before: TransformSnapshot
  private after: TransformSnapshot
  constructor(actorId: string, before: TransformSnapshot, after: TransformSnapshot) {
    this.actorId = actorId
    this.before = before
    this.after = after
  }
  execute() {
    world.actors.get(this.actorId)?.setTransform(this.after)
  }
  undo() {
    world.actors.get(this.actorId)?.setTransform(this.before)
  }
}

/** Generic property mutation with captured before/after appliers. */
export class PropertyCommand implements Command {
  label: string
  private apply: () => void
  private revert: () => void
  constructor(label: string, apply: () => void, revert: () => void) {
    this.label = label
    this.apply = apply
    this.revert = revert
  }
  execute() {
    this.apply()
  }
  undo() {
    this.revert()
  }
}

export class ReparentCommand implements Command {
  label = 'Reparent'
  private actorId: string
  private newParent: string | null
  private oldParent: string | null
  constructor(actorId: string, newParent: string | null) {
    this.actorId = actorId
    this.newParent = newParent
    this.oldParent = world.actors.get(actorId)?.parentId ?? null
  }
  execute() {
    world.reparent(this.actorId, this.newParent)
  }
  undo() {
    world.reparent(this.actorId, this.oldParent)
  }
}
