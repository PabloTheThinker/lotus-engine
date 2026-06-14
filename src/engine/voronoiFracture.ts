import * as THREE from 'three'

/** Wave 12 — Voronoi fracture approx (Chaos Destruction upgrade over uniform cubes). */

export interface VoronoiFragment {
  mesh: THREE.Mesh
  offset: THREE.Vector3
  impulse: THREE.Vector3
}

/** Generate voronoi-like fragments from an actor mesh AABB. */
export function buildVoronoiFragments(
  source: THREE.Mesh,
  siteCount = 14,
  strain = 1,
): VoronoiFragment[] {
  const box = new THREE.Box3().setFromObject(source)
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  box.getSize(size)
  box.getCenter(center)
  if (size.lengthSq() < 1e-6) size.setScalar(1)

  const mat = source.material as THREE.MeshStandardMaterial
  const color = mat.color?.clone() ?? new THREE.Color(0x888888)
  const sites: THREE.Vector3[] = []
  for (let i = 0; i < siteCount; i++) {
    sites.push(
      new THREE.Vector3(
        center.x + (Math.random() - 0.5) * size.x * 0.9,
        center.y + (Math.random() - 0.5) * size.y * 0.9,
        center.z + (Math.random() - 0.5) * size.z * 0.9,
      ),
    )
  }

  const out: VoronoiFragment[] = []
  const base = Math.max(0.08, (size.x + size.y + size.z) / 3 / (4 + siteCount * 0.15))
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i]
    const jitter = 0.65 + Math.random() * 0.7
    const sx = Math.max(0.06, base * jitter * (0.8 + size.x))
    const sy = Math.max(0.06, base * jitter * (0.8 + size.y))
    const sz = Math.max(0.06, base * jitter * (0.8 + size.z))
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(sx, sy, sz),
      new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05 }),
    )
    mesh.castShadow = true
    mesh.userData.isEditorOnly = true
    const offset = s.clone().sub(center)
    const impulse = offset
      .clone()
      .normalize()
      .multiplyScalar((2.5 + Math.random() * 2) * strain)
    impulse.y += 1.2 + Math.random() * 1.5 * strain
    out.push({ mesh, offset, impulse })
  }
  return out
}