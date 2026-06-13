import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Actor } from './Actor'

/**
 * BatchedMesh export merge — reduce draw calls in playable export (Wave 10).
 */

export interface BatchedExportMesh {
  name: string
  geometry: THREE.BufferGeometry
  material: THREE.Material
  matrix: number[]
}

const STATIC_TYPES = new Set(['StaticMesh', 'CustomMesh', 'ImportedMesh'])

function collectStaticMeshes(actors: Map<string, Actor>): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  for (const actor of actors.values()) {
    if (!STATIC_TYPES.has(actor.type) || actor.mobility !== 'static') continue
    actor.root.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.isHelper && !o.userData.isEditorOnly) {
        out.push(o)
      }
    })
  }
  return out
}

/** Merge compatible static meshes into BatchedMesh-ready payloads for export runtime. */
export function buildBatchedExportMeshes(actors: Map<string, Actor>): BatchedExportMesh[] {
  const meshes = collectStaticMeshes(actors)
  if (!meshes.length) return []

  const groups = new Map<string, THREE.Mesh[]>()
  for (const m of meshes) {
    const mat = Array.isArray(m.material) ? m.material[0] : m.material
    const key = `${mat.uuid}:${m.geometry.attributes.position?.count ?? 0}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(m)
  }

  const out: BatchedExportMesh[] = []
  let batchIdx = 0
  for (const [, group] of groups) {
    if (group.length < 2) continue
    const ref = group[0]
    const mat = Array.isArray(ref.material) ? ref.material[0].clone() : ref.material.clone()
    const parts: THREE.BufferGeometry[] = []
    for (const mesh of group) {
      const g = mesh.geometry.clone()
      g.applyMatrix4(mesh.matrixWorld)
      parts.push(g)
    }
    const merged = mergeGeometries(parts, false)
    if (!merged) continue
    for (const g of parts) g.dispose()
    out.push({
      name: `Batch_${batchIdx++}`,
      geometry: merged,
      material: mat,
      matrix: new THREE.Matrix4().identity().toArray(),
    })
  }
  return out
}

/** Serialize batched meshes for playable HTML embedding. */
export function serializeBatchedMeshes(batches: BatchedExportMesh[]): object[] {
  return batches.map((b) => ({
    name: b.name,
    matrix: b.matrix,
    position: Array.from(b.geometry.attributes.position?.array ?? []),
    normal: Array.from(b.geometry.attributes.normal?.array ?? []),
    index: b.geometry.index ? Array.from(b.geometry.index.array) : [],
    color: (b.material as THREE.MeshStandardMaterial).color?.getHexString?.() ?? '888888',
  }))
}