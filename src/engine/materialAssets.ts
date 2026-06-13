import * as THREE from 'three'
import type { Actor } from './Actor'
import { applyMaterialProps } from './factory'
import type { MaterialGraph } from './materialGraph'
import type { MaterialProps } from './types'
import { DEFAULT_MATERIAL } from './types'

/**
 * Material assets — UE Material + Material Instance analog.
 * Base materials live in localStorage; actors reference by id and store per-instance overrides.
 */

const KEY = 'vektra-engine.materials'

export interface MaterialAsset {
  id: string
  name: string
  material: MaterialProps
  materialGraph?: MaterialGraph
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