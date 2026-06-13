import * as THREE from 'three'
import { nextActorId, type Actor } from '../engine/Actor'
import { applyMaterialProps } from '../engine/factory'
import { world } from '../engine/World'
import type { MaterialProps, SerializedActor, TransformSnapshot } from '../engine/types'
import { AddActorCommand, runCommand, type Command } from './commands'
import { useEditor } from './store'

/**
 * Prefabs — Godot-style scene instancing: save an actor subtree as a named
 * asset, instance it anywhere. Stored in localStorage; ids remap on spawn.
 * Instance roots track per-actor property overrides against the source prefab.
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

export function getPrefabByName(name: string): Prefab | undefined {
  return listPrefabs().find((p) => p.name === name)
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

/** Walk up the hierarchy to the prefab instance root (has prefabSource). */
export function getPrefabInstanceRoot(actorId: string): Actor | null {
  let cur = world.actors.get(actorId) ?? null
  while (cur) {
    if (cur.prefabSource) return cur
    cur = cur.parentId ? (world.actors.get(cur.parentId) ?? null) : null
  }
  return null
}

export function isPrefabInstanceActor(actorId: string): boolean {
  const actor = world.actors.get(actorId)
  if (!actor) return false
  return !!actor.prefabActorId || !!getPrefabInstanceRoot(actorId)
}

function getPrefabSourceActor(prefab: Prefab, prefabActorId: string): SerializedActor | undefined {
  return prefab.actors.find((a) => a.id === prefabActorId)
}

function vec3Equal(a: [number, number, number], b: [number, number, number], eps = 1e-6): boolean {
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps
}

function transformEqual(a: TransformSnapshot, b: TransformSnapshot): boolean {
  return vec3Equal(a.position, b.position) && vec3Equal(a.rotation, b.rotation) && vec3Equal(a.scale, b.scale)
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase()
  return a === b
}

/** Read a dotted field path from serialized actor data. */
export function getSerializedFieldValue(sa: SerializedActor, fieldPath: string): unknown {
  const parts = fieldPath.split('.')
  let cur: unknown = sa
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    if (Array.isArray(cur)) {
      const idx = parseInt(part, 10)
      cur = cur[idx]
    } else {
      cur = (cur as Record<string, unknown>)[part]
    }
  }
  return cur
}

/** Read a dotted field path from a live actor. */
export function getActorFieldValue(actor: Actor, fieldPath: string): unknown {
  if (fieldPath === 'name') return actor.name
  if (fieldPath === 'visible') return actor.visible
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
    if (rest === 'position') return t.position
    if (rest === 'rotation') return t.rotation
    if (rest === 'scale') return t.scale
  }
  if (fieldPath.startsWith('material.')) {
    const key = fieldPath.slice('material.'.length) as keyof MaterialProps
    return actor.materialProps?.[key]
  }
  return undefined
}

/** Apply selected serialized fields onto a live actor. */
function applyFieldsToActor(actor: Actor, data: Partial<SerializedActor>) {
  if (data.name !== undefined) {
    actor.name = data.name
    actor.root.name = data.name
  }
  if (data.visible !== undefined) actor.setVisible(data.visible)
  if (data.transform) actor.setTransform(data.transform)
  if (data.material && actor.materialProps && actor.mesh) {
    Object.assign(actor.materialProps, data.material)
    applyMaterialProps(actor.mesh.material as THREE.MeshStandardMaterial, actor.materialProps)
  }
}

function mergePrefabData(base: SerializedActor, override: Partial<SerializedActor>): Partial<SerializedActor> {
  const merged: Partial<SerializedActor> = { ...override }
  if (override.transform) {
    merged.transform = {
      position: override.transform.position ?? base.transform.position,
      rotation: override.transform.rotation ?? base.transform.rotation,
      scale: override.transform.scale ?? base.transform.scale,
    }
  }
  if (override.material && base.material) {
    merged.material = { ...base.material, ...override.material }
  }
  return merged
}

function collectSubtree(id: string): Actor[] {
  const actor = world.actors.get(id)
  if (!actor) return []
  return [actor, ...world.childrenOf(id).flatMap((c) => collectSubtree(c.id))]
}

/** Re-apply prefab base values plus stored overrides for an instance subtree. */
export function applyPrefabOverrides(instanceRootId: string) {
  const root = world.actors.get(instanceRootId)
  if (!root?.prefabSource) return
  const prefab = getPrefabByName(root.prefabSource)
  if (!prefab) return

  for (const actor of collectSubtree(root.id)) {
    const prefabActorId = actor.prefabActorId
    if (!prefabActorId) continue
    const base = getPrefabSourceActor(prefab, prefabActorId)
    if (!base) continue
    const override = root.prefabOverrides?.[prefabActorId] ?? {}
    applyFieldsToActor(actor, mergePrefabData(base, override))
  }
  useEditor.getState().touch()
}

/** Prefab source value for a field — used as the "default" in Details revert UI. */
export function getPrefabDefaultValue(actorId: string, fieldPath: string): unknown {
  const actor = world.actors.get(actorId)
  if (!actor?.prefabActorId) return undefined
  const root = getPrefabInstanceRoot(actorId)
  if (!root?.prefabSource) return undefined
  const prefab = getPrefabByName(root.prefabSource)
  if (!prefab) return undefined
  const base = getPrefabSourceActor(prefab, actor.prefabActorId)
  if (!base) return undefined
  if (fieldPath.startsWith('transform.rotation.')) {
    const idx = parseInt(fieldPath.split('.').pop() ?? '0', 10)
    return THREE.MathUtils.radToDeg(base.transform.rotation[idx as 0 | 1 | 2])
  }
  return getSerializedFieldValue(base, fieldPath)
}

export function isPrefabFieldOverridden(actorId: string, fieldPath: string): boolean {
  const actor = world.actors.get(actorId)
  if (!actor?.prefabActorId) return false
  const def = getPrefabDefaultValue(actorId, fieldPath)
  if (def === undefined) return false
  const cur = getActorFieldValue(actor, fieldPath)
  return !valuesEqual(cur, def)
}

function syncOverrideEntry(
  root: Actor,
  prefabActorId: string,
  prefab: Prefab,
  actor: Actor,
  fieldPath: string,
) {
  if (!root.prefabOverrides) root.prefabOverrides = {}
  const base = getPrefabSourceActor(prefab, prefabActorId)
  if (!base) return

  const entry = { ...(root.prefabOverrides[prefabActorId] ?? {}) }

  if (fieldPath === 'name') {
    if (actor.name === base.name) delete entry.name
    else entry.name = actor.name
  } else if (fieldPath === 'visible') {
    if (actor.visible === base.visible) delete entry.visible
    else entry.visible = actor.visible
  } else if (fieldPath.startsWith('transform.')) {
    if (transformEqual(actor.transform, base.transform)) delete entry.transform
    else entry.transform = { ...actor.transform }
  } else if (fieldPath.startsWith('material.')) {
    const key = fieldPath.slice('material.'.length) as keyof MaterialProps
    const sourceMat = base.material
    const cur = actor.materialProps?.[key]
    const src = sourceMat?.[key]
    const mat = { ...(entry.material ?? {}) }
    if (sourceMat && valuesEqual(cur, src)) delete mat[key]
    else mat[key] = cur as never
    if (Object.keys(mat).length === 0) delete entry.material
    else entry.material = mat as MaterialProps
  }

  if (Object.keys(entry).length === 0) delete root.prefabOverrides[prefabActorId]
  else root.prefabOverrides[prefabActorId] = entry
}

/** Record (or clear) an override after the user edits an instanced actor property. */
export function recordPrefabOverride(actorId: string, fieldPath: string) {
  const actor = world.actors.get(actorId)
  if (!actor?.prefabActorId) return
  const root = getPrefabInstanceRoot(actorId)
  if (!root?.prefabSource) return
  const prefab = getPrefabByName(root.prefabSource)
  if (!prefab) return
  syncOverrideEntry(root, actor.prefabActorId, prefab, actor, fieldPath)
}

/** Revert a single overridden field back to the prefab source value. */
export function revertPrefabOverride(actorId: string, fieldPath: string) {
  const actor = world.actors.get(actorId)
  if (!actor?.prefabActorId) return
  const root = getPrefabInstanceRoot(actorId)
  if (!root?.prefabSource) return
  const prefab = getPrefabByName(root.prefabSource)
  if (!prefab) return
  const base = getPrefabSourceActor(prefab, actor.prefabActorId)
  if (!base) return

  if (fieldPath === 'name') {
    actor.name = base.name
    actor.root.name = base.name
  } else if (fieldPath === 'visible') {
    actor.setVisible(base.visible)
  } else if (fieldPath.startsWith('transform.')) {
    const rest = fieldPath.slice('transform.'.length)
    const t = { ...actor.transform }
    if (rest.startsWith('position.')) {
      const idx = parseInt(rest.split('.')[1], 10) as 0 | 1 | 2
      t.position = [...t.position] as [number, number, number]
      t.position[idx] = base.transform.position[idx]
    } else if (rest.startsWith('rotation.')) {
      const idx = parseInt(rest.split('.')[1], 10) as 0 | 1 | 2
      t.rotation = [...t.rotation] as [number, number, number]
      t.rotation[idx] = base.transform.rotation[idx]
    } else if (rest.startsWith('scale.')) {
      const idx = parseInt(rest.split('.')[1], 10) as 0 | 1 | 2
      t.scale = [...t.scale] as [number, number, number]
      t.scale[idx] = base.transform.scale[idx]
    } else {
      t.position = [...base.transform.position] as [number, number, number]
      t.rotation = [...base.transform.rotation] as [number, number, number]
      t.scale = [...base.transform.scale] as [number, number, number]
    }
    actor.setTransform(t)
  } else if (fieldPath.startsWith('material.')) {
    const key = fieldPath.slice('material.'.length) as keyof MaterialProps
    if (base.material && actor.materialProps && actor.mesh) {
      actor.materialProps[key] = base.material[key] as never
      applyMaterialProps(actor.mesh.material as THREE.MeshStandardMaterial, actor.materialProps)
    }
  }

  syncOverrideEntry(root, actor.prefabActorId, prefab, actor, fieldPath)
  useEditor.getState().touch()
}

/** Property edit that also tracks prefab overrides (undo-aware). */
export function runPrefabAwareCommand(
  actorId: string,
  fieldPath: string,
  label: string,
  apply: () => void,
  revert: () => void,
) {
  runCommand({
    label,
    execute() {
      apply()
      recordPrefabOverride(actorId, fieldPath)
    },
    undo() {
      revert()
      recordPrefabOverride(actorId, fieldPath)
    },
  })
}

/** Instance a prefab at a position — ids remapped, hierarchy preserved. */
export function instantiatePrefab(prefab: Prefab, position: [number, number, number]) {
  const idMap = new Map<string, string>()
  for (const sa of prefab.actors) idMap.set(sa.id, nextActorId())
  const remapped = prefab.actors.map((sa, i) => ({
    ...sa,
    id: idMap.get(sa.id)!,
    parentId: sa.parentId ? (idMap.get(sa.parentId) ?? null) : null,
    prefabActorId: prefab.actors[i].id,
    ...(i === 0
      ? { prefabSource: prefab.name, prefabOverrides: {} as Record<string, Partial<SerializedActor>> }
      : {}),
  }))
  remapped[0] = { ...remapped[0], transform: { ...remapped[0].transform, position } }

  const cmds: Command[] = remapped.map((sa) => new AddActorCommand(sa))
  runCommand({
    label: `Instance ${prefab.name}`,
    execute() {
      for (const c of cmds) c.execute()
      applyPrefabOverrides(remapped[0].id)
      useEditor.getState().select(remapped[0].id)
    },
    undo() {
      for (const c of [...cmds].reverse()) c.undo()
    },
  })
}