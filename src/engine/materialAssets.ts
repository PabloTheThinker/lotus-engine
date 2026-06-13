import * as THREE from 'three'
import type { Actor } from './Actor'
import { applyMaterialProps } from './factory'
import type { MaterialGraph, MaterialGraphMode } from './materialGraph'
import type { MaterialProps } from './types'
import { DEFAULT_MATERIAL } from './types'

/**
 * Material assets — UE Material + Material Instance analog.
 * Base materials live in localStorage; actors reference by id and store per-instance overrides.
 */

const KEY = 'lotus-engine.materials'

export interface MaterialAsset {
  id: string
  name: string
  material: MaterialProps
  materialGraph?: MaterialGraph
  materialGraphMode?: MaterialGraphMode
}

let materialCounter = 0
export function nextMaterialId(): string {
  materialCounter += 1
  return `mat_${Date.now().toString(36)}_${materialCounter}`
}

export function listMaterials(): MaterialAsset[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as MaterialAsset[]
  } catch {
    return []
  }
}

function persist(materials: MaterialAsset[]) {
  localStorage.setItem(KEY, JSON.stringify(materials))
}

export function getMaterial(id: string): MaterialAsset | undefined {
  return listMaterials().find((m) => m.id === id)
}

export function saveMaterial(asset: MaterialAsset): MaterialAsset {
  const materials = listMaterials()
  const idx = materials.findIndex((m) => m.id === asset.id)
  if (idx >= 0) materials[idx] = asset
  else materials.push(asset)
  persist(materials)
  return asset
}

export function deleteMaterial(id: string) {
  persist(listMaterials().filter((m) => m.id !== id))
}

export function renameMaterial(id: string, newName: string): boolean {
  const next = newName.trim()
  if (!next) return false
  const materials = listMaterials()
  const asset = materials.find((m) => m.id === id)
  if (!asset || asset.name === next) return false
  if (materials.some((m) => m.id !== id && m.name === next)) return false
  saveMaterial({ ...asset, name: next })
  return true
}

export function duplicateMaterial(id: string): MaterialAsset | null {
  const asset = getMaterial(id)
  if (!asset) return null
  const materials = listMaterials()
  const base = asset.name.replace(/_Copy\d*$/, '')
  let copyName = `${base}_Copy`
  const names = new Set(materials.map((m) => m.name))
  let n = 2
  while (names.has(copyName)) {
    copyName = `${base}_Copy${n}`
    n += 1
  }
  const dup: MaterialAsset = {
    id: nextMaterialId(),
    name: copyName,
    material: JSON.parse(JSON.stringify(asset.material)),
    materialGraph: asset.materialGraph ? JSON.parse(JSON.stringify(asset.materialGraph)) : undefined,
  }
  saveMaterial(dup)
  return dup
}

/** Merge asset base + per-instance overrides into effective MaterialProps. */
export function resolveMaterialProps(
  assetId: string | undefined,
  overrides: Partial<MaterialProps> | undefined,
  fallback: MaterialProps = DEFAULT_MATERIAL,
): MaterialProps {
  const base = assetId ? getMaterial(assetId)?.material : undefined
  return { ...DEFAULT_MATERIAL, ...fallback, ...base, ...overrides }
}

/** Instance graph override, else asset graph, else actor-local graph. */
export function getEffectiveMaterialGraph(actor: Actor): MaterialGraph | undefined {
  if (actor.materialGraph) return actor.materialGraph
  if (actor.materialAssetId) return getMaterial(actor.materialAssetId)?.materialGraph
  return undefined
}

/** Effective shader mode: graph.mode → actor override → asset default → cpu. */
export function getEffectiveMaterialGraphMode(actor: Actor): MaterialGraphMode {
  const graph = getEffectiveMaterialGraph(actor)
  if (actor.materialGraphMode) return actor.materialGraphMode
  if (graph?.mode) return graph.mode
  if (actor.materialAssetId) return getMaterial(actor.materialAssetId)?.materialGraphMode ?? 'cpu'
  return 'cpu'
}

/** Recompute effective material props (+ graph) and push onto the actor mesh. */
export function applyActorMaterial(actor: Actor) {
  if (!actor.mesh) return
  const mat = actor.mesh.material as THREE.MeshStandardMaterial
  actor.materialProps = resolveMaterialProps(actor.materialAssetId, actor.materialOverrides, actor.materialProps)
  applyMaterialProps(mat, actor.materialProps)
}

export function saveMaterialFromProps(name: string, props: MaterialProps, graph?: MaterialGraph): MaterialAsset {
  const asset: MaterialAsset = {
    id: nextMaterialId(),
    name,
    material: { ...props },
    materialGraph: graph ? JSON.parse(JSON.stringify(graph)) : undefined,
  }
  saveMaterial(asset)
  return asset
}