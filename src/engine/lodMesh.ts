import * as THREE from 'three'

/**
 * Static mesh LOD chains — honest Nanite analog (Wave 10).
 * Uses THREE.LOD with distance thresholds; optional simplified meshes via scale proxy.
 */

export interface LODLevel {
  /** Distance from camera to switch */
  distance: number
  /** 0–1 mesh complexity hint (1 = full, lower = smaller draw) */
  quality: number
}

export const DEFAULT_LOD_LEVELS: LODLevel[] = [
  { distance: 0, quality: 1 },
  { distance: 24, quality: 0.55 },
  { distance: 64, quality: 0.28 },
]

/** Build a THREE.LOD from a source mesh with distance-based quality proxies. */
export function buildLODChain(
  source: THREE.Mesh,
  levels: LODLevel[] = DEFAULT_LOD_LEVELS,
): THREE.LOD {
  const lod = new THREE.LOD()
  const mat = source.material
  for (const level of levels) {
    const geo = source.geometry.clone()
    if (level.quality < 0.99) {
      const pos = geo.attributes.position as THREE.BufferAttribute
      const step = Math.max(1, Math.round(1 / Math.max(0.1, level.quality)))
      if (step > 1 && pos.count > step * 3) {
        const indices: number[] = []
        for (let i = 0; i < pos.count; i += step) indices.push(i)
        const slim = new THREE.BufferGeometry()
        const newPos = new Float32Array(indices.length * 3)
        indices.forEach((idx, j) => {
          newPos[j * 3] = pos.getX(idx)
          newPos[j * 3 + 1] = pos.getY(idx)
          newPos[j * 3 + 2] = pos.getZ(idx)
        })
        slim.setAttribute('position', new THREE.BufferAttribute(newPos, 3))
        slim.computeVertexNormals()
        geo.dispose()
        lod.addLevel(new THREE.Mesh(slim, mat), level.distance)
        continue
      }
    }
    lod.addLevel(new THREE.Mesh(geo, mat), level.distance)
  }
  lod.userData.lotusLOD = true
  return lod
}

/** Attach LOD to actor root, replacing single mesh child when present. */
export function applyActorLOD(actorMesh: THREE.Mesh, levels?: LODLevel[]): THREE.LOD {
  const lod = buildLODChain(actorMesh, levels)
  lod.position.copy(actorMesh.position)
  lod.quaternion.copy(actorMesh.quaternion)
  lod.scale.copy(actorMesh.scale)
  return lod
}