import { applyMaterialProps } from '../engine/factory'
import { mpConnected, mpIsHost, mpNotifyDespawn, mpNotifySpawn } from '../engine/multiplayer'
import { world } from '../engine/World'
import { runConstructScript } from '../engine/scripting'
import type { SerializedActor, TransformSnapshot } from '../engine/types'
import { recordPrefabOverride, revertPrefabOverride } from './prefabs'
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
  // During Play/Eject/Simulate, apply immediately without polluting the undo stack.
  if (useEditor.getState().playing) {
    useEditor.getState().setStatus(cmd.label)
    useEditor.getState().touch()
    return
  }
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
    const playing = useEditor.getState().playing
    if (playing && this.data.syncSpawn && mpConnected() && !mpIsHost()) {
      useEditor.getState().setStatus('Only the host can spawn syncSpawn actors during Play')
      return
    }
    const actor = world.instantiate(this.data)
    world.addActor(actor, this.data.parentId)
    runConstructScript(actor, world.actors, (lvl, msg) => useEditor.getState().pushConsole(lvl, msg))
    useEditor.getState().select(actor.id)
    if (playing && this.data.syncSpawn) mpNotifySpawn(this.data)
  }
  undo() {
    if (useEditor.getState().playing && this.data.syncSpawn) mpNotifyDespawn(this.data.id)
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
    if (useEditor.getState().playing) {
      for (const snap of this.snapshots) {
        if (snap.syncSpawn) mpNotifyDespawn(snap.id)
      }
    }
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
    recordPrefabOverride(this.actorId, 'transform')
  }
  undo() {
    world.actors.get(this.actorId)?.setTransform(this.before)
    recordPrefabOverride(this.actorId, 'transform')
  }
}

/** Revert a single prefab instance property override to the source prefab value. */
export class RevertPrefabOverrideCommand implements Command {
  label: string
  private actorId: string
  private fieldPath: string
  private savedValue: unknown

  constructor(actorId: string, fieldPath: string) {
    this.actorId = actorId
    this.fieldPath = fieldPath
    const actor = world.actors.get(actorId)
    this.savedValue = actor ? getActorFieldSnapshot(actor, fieldPath) : undefined
    this.label = `Revert ${fieldPath}`
  }

  execute() {
    revertPrefabOverride(this.actorId, this.fieldPath)
  }

  undo() {
    const actor = world.actors.get(this.actorId)
    if (!actor) return
    applyActorFieldSnapshot(actor, this.fieldPath, this.savedValue)
    recordPrefabOverride(this.actorId, this.fieldPath)
  }
}

function getActorFieldSnapshot(actor: import('../engine/Actor').Actor, fieldPath: string): unknown {
  if (fieldPath === 'name') return actor.name
  if (fieldPath === 'visible') return actor.visible
  if (fieldPath === 'transform') return { ...actor.transform }
  if (fieldPath.startsWith('transform.')) {
    const t = actor.transform
    const rest = fieldPath.slice('transform.'.length)
    if (rest === 'position.0') return t.position[0]
    if (rest === 'position.1') return t.position[1]
    if (rest === 'position.2') return t.position[2]
    if (rest === 'rotation.0') return t.rotation[0]
    if (rest === 'rotation.1') return t.rotation[1]
    if (rest === 'rotation.2') return t.rotation[2]
    if (rest === 'scale.0') return t.scale[0]
    if (rest === 'scale.1') return t.scale[1]
    if (rest === 'scale.2') return t.scale[2]
  }
  if (fieldPath.startsWith('material.')) {
    const key = fieldPath.slice('material.'.length) as keyof NonNullable<typeof actor.materialProps>
    return actor.materialProps?.[key]
  }
  return undefined
}

function applyActorFieldSnapshot(
  actor: import('../engine/Actor').Actor,
  fieldPath: string,
  value: unknown,
) {
  if (value === undefined) return
  if (fieldPath === 'name' && typeof value === 'string') {
    actor.name = value
    actor.root.name = value
  } else if (fieldPath === 'visible' && typeof value === 'boolean') {
    actor.setVisible(value)
  } else if (fieldPath === 'transform' && value && typeof value === 'object') {
    actor.setTransform(value as TransformSnapshot)
  } else if (fieldPath.startsWith('transform.')) {
    const t = { ...actor.transform }
    const rest = fieldPath.slice('transform.'.length)
    if (rest.startsWith('position.') && typeof value === 'number') {
      const idx = parseInt(rest.split('.')[1], 10) as 0 | 1 | 2
      t.position = [...t.position] as [number, number, number]
      t.position[idx] = value
    } else if (rest.startsWith('rotation.') && typeof value === 'number') {
      const idx = parseInt(rest.split('.')[1], 10) as 0 | 1 | 2
      t.rotation = [...t.rotation] as [number, number, number]
      t.rotation[idx] = value
    } else if (rest.startsWith('scale.') && typeof value === 'number') {
      const idx = parseInt(rest.split('.')[1], 10) as 0 | 1 | 2
      t.scale = [...t.scale] as [number, number, number]
      t.scale[idx] = value
    }
    actor.setTransform(t)
  } else if (fieldPath.startsWith('material.') && actor.materialProps && actor.mesh) {
    const key = fieldPath.slice('material.'.length) as keyof typeof actor.materialProps
    ;(actor.materialProps as unknown as Record<string, unknown>)[key as string] = value
    applyMaterialProps(actor.mesh.material as import('three').MeshStandardMaterial, actor.materialProps)
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
