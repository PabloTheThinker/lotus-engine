/**
 * Resource (.tres) lite — Godot-style shared JSON assets by UUID.
 * Stored in localStorage; referenced by id from scripts, materials, curves.
 */

const KEY = 'lotus-engine.resources'

export type ResourceKind =
  | 'material'
  | 'curve'
  | 'shape'
  | 'recipe'
  | 'loot_table'
  | 'config'
  | 'scene_preset'

export interface LotusResource<T = Record<string, unknown>> {
  id: string
  name: string
  kind: ResourceKind
  data: T
}

let resourceCounter = 0

export function nextResourceId(): string {
  resourceCounter += 1
  return `res_${Date.now().toString(36)}_${resourceCounter}`
}

export function listResources(kind?: ResourceKind): LotusResource[] {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '[]') as LotusResource[]
    return kind ? all.filter((r) => r.kind === kind) : all
  } catch {
    return []
  }
}

function persist(resources: LotusResource[]) {
  localStorage.setItem(KEY, JSON.stringify(resources))
}

export function getResource(id: string): LotusResource | undefined {
  return listResources().find((r) => r.id === id)
}

export function saveResource(resource: LotusResource): LotusResource {
  const resources = listResources()
  const idx = resources.findIndex((r) => r.id === resource.id)
  if (idx >= 0) resources[idx] = resource
  else resources.push(resource)
  persist(resources)
  return resource
}

export function deleteResource(id: string) {
  persist(listResources().filter((r) => r.id !== id))
}

/** Create a new .tres-like resource with a fresh UUID. */
export function createResource(
  name: string,
  kind: ResourceKind,
  data: Record<string, unknown> = {},
): LotusResource {
  return saveResource({ id: nextResourceId(), name, kind, data })
}

export function findResourceByName(name: string, kind?: ResourceKind): LotusResource | undefined {
  const q = String(name ?? '').trim().toLowerCase()
  if (!q) return undefined
  return listResources(kind).find((r) => r.name.toLowerCase() === q)
}

/** Upsert a named engine resource (config / scene preset). */
export function registerNamedResource(
  name: string,
  kind: ResourceKind,
  data: Record<string, unknown>,
): LotusResource {
  const existing = findResourceByName(name, kind)
  if (existing) return saveResource({ ...existing, data: { ...data } })
  return createResource(name, kind, data)
}

export function duplicateResource(id: string, newName?: string): LotusResource | null {
  const src = getResource(id)
  if (!src) return null
  return createResource(newName?.trim() || `${src.name}_copy`, src.kind, { ...src.data })
}