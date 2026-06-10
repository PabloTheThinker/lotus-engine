import { nextActorId } from '../engine/Actor'
import { world } from '../engine/World'
import type { SerializedActor } from '../engine/types'
import { AddActorCommand, runCommand, type Command } from './commands'
import { useEditor } from './store'

/**
 * Prefabs — Godot-style scene instancing: save an actor subtree as a named
 * asset, instance it anywhere. Stored in localStorage; ids remap on spawn.
 */

const KEY = 'vektra-engine.prefabs'

export interface Prefab {
  name: string
  actors: SerializedActor[] // [0] is the root of the subtree
}

export function listPrefabs(): Prefab[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Prefab[]
  } catch {
    return []
  }
}

function persist(prefabs: Prefab[]) {
  localStorage.setItem(KEY, JSON.stringify(prefabs))
}

export function savePrefab(rootActorId: string): Prefab | null {
  const root = world.actors.get(rootActorId)
  if (!root) return null
  const collect = (id: string): SerializedActor[] => {
    const a = world.actors.get(id)
    if (!a) return []
    return [a.serialize(), ...world.childrenOf(id).flatMap((c) => collect(c.id))]
  }
  const actors = collect(rootActorId)
  actors[0] = { ...actors[0], parentId: null }
  const prefab: Prefab = { name: root.name, actors }
  const prefabs = listPrefabs().filter((p) => p.name !== prefab.name)
  prefabs.push(prefab)
  persist(prefabs)
  useEditor.getState().setStatus(`Saved prefab: ${prefab.name}`)
  useEditor.getState().touch()
  return prefab
}

export function deletePrefab(name: string) {
  persist(listPrefabs().filter((p) => p.name !== name))
  useEditor.getState().touch()
}

/** Instance a prefab at a position — ids remapped, hierarchy preserved. */
export function instantiatePrefab(prefab: Prefab, position: [number, number, number]) {
  const idMap = new Map<string, string>()
  for (const sa of prefab.actors) idMap.set(sa.id, nextActorId())
  const remapped = prefab.actors.map((sa) => ({
    ...sa,
    id: idMap.get(sa.id)!,
    parentId: sa.parentId ? (idMap.get(sa.parentId) ?? null) : null,
  }))
  remapped[0] = { ...remapped[0], transform: { ...remapped[0].transform, position } }

  // one undoable command for the whole subtree
  const cmds: Command[] = remapped.map((sa) => new AddActorCommand(sa))
  runCommand({
    label: `Instance ${prefab.name}`,
    execute() {
      for (const c of cmds) c.execute()
      useEditor.getState().select(remapped[0].id)
    },
    undo() {
      for (const c of [...cmds].reverse()) c.undo()
    },
  })
}
