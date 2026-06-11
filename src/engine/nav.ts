import * as THREE from 'three'
import type { Actor } from './Actor'

/**
 * Navigation — navmesh-lite: a walkability grid baked from level geometry
 * (ground raycasts) + A* pathfinding. api.findPath returns waypoints; pair
 * with BT moveToBlackboard or the Path Follow template for agent steering.
 * (Upgrade path: recast-navigation-js for true polygon navmeshes.)
 */

// grid cell = 1 world unit
const HALF = 45 // grid covers [-45, 45] on x/z
const SIZE = HALF * 2 + 1

let walkable: Uint8Array | null = null
let heights: Float32Array | null = null

export function resetNav() {
  walkable = null
  heights = null
}

function bake(actors: Map<string, Actor>) {
  walkable = new Uint8Array(SIZE * SIZE)
  heights = new Float32Array(SIZE * SIZE)
  const ray = new THREE.Raycaster()
  const down = new THREE.Vector3(0, -1, 0)
  const meshes: THREE.Object3D[] = []
  for (const a of actors.values()) {
    a.root.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.isHelper && !o.userData.isEditorOnly && !o.userData.isParticles)
        meshes.push(o)
    })
  }
  for (let gz = 0; gz < SIZE; gz++) {
    for (let gx = 0; gx < SIZE; gx++) {
      ray.set(new THREE.Vector3(gx - HALF, 60, gz - HALF), down)
      ray.far = 120
      const hit = ray.intersectObjects(meshes, false)[0]
      const i = gz * SIZE + gx
      if (hit && hit.face) {
        const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
        walkable[i] = n.y > 0.65 ? 1 : 0
        heights[i] = hit.point.y
      }
    }
  }
  // mark cells with big height steps to neighbors unwalkable edges (handled in A* cost)
}

function idx(gx: number, gz: number) {
  return gz * SIZE + gx
}
function inGrid(gx: number, gz: number) {
  return gx >= 0 && gz >= 0 && gx < SIZE && gz < SIZE
}

/** A* over the walkability grid; returns world waypoints or null */
export function findPath(
  actors: Map<string, Actor>,
  from: [number, number, number],
  to: [number, number, number],
): [number, number, number][] | null {
  if (!walkable) bake(actors)
  const w = walkable!
  const h = heights!
  const sx = Math.round(from[0]) + HALF
  const sz = Math.round(from[2]) + HALF
  const tx = Math.round(to[0]) + HALF
  const tz = Math.round(to[2]) + HALF
  if (!inGrid(sx, sz) || !inGrid(tx, tz) || !w[idx(tx, tz)]) return null

  const open: number[] = [idx(sx, sz)]
  const came = new Map<number, number>()
  const g = new Map<number, number>([[idx(sx, sz), 0]])
  const f = new Map<number, number>([[idx(sx, sz), Math.hypot(tx - sx, tz - sz)]])
  const closed = new Set<number>()
  const target = idx(tx, tz)
  let guard = 0

  while (open.length && guard++ < 20000) {
    let bi = 0
    for (let i = 1; i < open.length; i++) if ((f.get(open[i]) ?? 1e9) < (f.get(open[bi]) ?? 1e9)) bi = i
    const cur = open.splice(bi, 1)[0]
    if (cur === target) {
      // reconstruct
      const cells: number[] = [cur]
      let c = cur
      while (came.has(c)) {
        c = came.get(c)!
        cells.push(c)
      }
      cells.reverse()
      return cells.map((ci) => [(ci % SIZE) - HALF, h[ci] + 0.0, Math.floor(ci / SIZE) - HALF] as [number, number, number])
    }
    closed.add(cur)
    const cx = cur % SIZE
    const cz = Math.floor(cur / SIZE)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const nx = cx + dx
      const nz = cz + dz
      if (!inGrid(nx, nz)) continue
      const ni = idx(nx, nz)
      if (closed.has(ni) || !w[ni]) continue
      if (Math.abs(h[ni] - h[cur]) > 0.8) continue // too steep a step
      const ng = (g.get(cur) ?? 0) + Math.hypot(dx, dz)
      if (ng < (g.get(ni) ?? 1e9)) {
        came.set(ni, cur)
        g.set(ni, ng)
        f.set(ni, ng + Math.hypot(tx - nx, tz - nz))
        if (!open.includes(ni)) open.push(ni)
      }
    }
  }
  return null
}
