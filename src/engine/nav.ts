import * as THREE from 'three'
import { exportNavMesh, init, importNavMesh, NavMeshQuery, type NavMesh } from 'recast-navigation'
import { generateSoloNavMesh } from 'recast-navigation/generators'
import type { NavMeshWorkerRequest, NavMeshWorkerResponse } from './navMeshWorker'
import type { Actor } from './Actor'

/**
 * Navigation — Recast polygon navmesh (Phase 1.3) with grid A* fallback.
 * Bake static/landscape geometry via bakeNavMesh(); api.findPath returns
 * navmesh waypoints when a bake is available.
 */

// grid cell = 1 world unit (fallback)
const HALF = 45
const SIZE = HALF * 2 + 1

const NAV_MESH_CONFIG = {
  cs: 0.25,
  ch: 0.25,
  walkableSlopeAngle: 45,
  walkableHeight: 2,
  walkableClimb: 0.5,
  walkableRadius: 0.4,
  maxEdgeLen: 12,
  maxSimplificationError: 1.3,
  minRegionArea: 8,
  mergeRegionArea: 20,
  maxVertsPerPoly: 6,
  detailSampleDist: 6,
  detailSampleMaxError: 1,
}

let walkable: Uint8Array | null = null
let heights: Float32Array | null = null

let navMesh: NavMesh | null = null
let navMeshQuery: NavMeshQuery | null = null
let initPromise: Promise<void> | null = null
let bakePromise: Promise<boolean> | null = null
let bakeWorker: Worker | null = null
let bakeRequestId = 0

export let navMeshReady = false
export let navMeshBaking = false
export let lastBakeError: string | null = null

export function resetNav() {
  walkable = null
  heights = null
  navMeshQuery?.destroy()
  navMeshQuery = null
  navMesh?.destroy()
  navMesh = null
  navMeshReady = false
  lastBakeError = null
  bakePromise = null
  bakeWorker?.terminate()
  bakeWorker = null
}

export function getNavMesh(): NavMesh | null {
  return navMesh
}

export function isRecastNavReady(): boolean {
  return navMeshReady && navMesh !== null && navMeshQuery !== null
}

function isNavGeometryActor(actor: Actor): boolean {
  return actor.mobility === 'static' || actor.type === 'Landscape'
}

/** Static + landscape meshes used as the base Recast bake input. */
export function collectNavMeshes(actors: Map<string, Actor>): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  for (const a of actors.values()) {
    if (!isNavGeometryActor(a)) continue
    a.root.traverse((o) => {
      if (
        o instanceof THREE.Mesh &&
        !o.userData.isHelper &&
        !o.userData.isEditorOnly &&
        !o.userData.isParticles
      ) {
        meshes.push(o)
      }
    })
  }
  return meshes
}

function meshesToArrays(meshes: THREE.Mesh[]): { positions: Float32Array; indices: Uint32Array } {
  const posList: number[] = []
  const idxList: number[] = []
  const v = new THREE.Vector3()
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false)
    const geo = mesh.geometry
    const posAttr = geo.attributes.position
    if (!posAttr) continue
    const base = posList.length / 3
    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr as THREE.BufferAttribute, i)
      v.applyMatrix4(mesh.matrixWorld)
      posList.push(v.x, v.y, v.z)
    }
    const index = geo.index
    if (index) {
      for (let i = 0; i < index.count; i++) idxList.push(index.getX(i) + base)
    } else {
      for (let i = 0; i < posAttr.count; i += 3) {
        idxList.push(base + i, base + i + 1, base + i + 2)
      }
    }
  }
  return { positions: new Float32Array(posList), indices: new Uint32Array(idxList) }
}

async function ensureRecastInit(): Promise<boolean> {
  try {
    if (!initPromise) initPromise = init()
    await initPromise
    return true
  } catch (err) {
    lastBakeError = err instanceof Error ? err.message : String(err)
    return false
  }
}

function installNavMesh(data: Uint8Array): boolean {
  try {
    navMeshQuery?.destroy()
    navMeshQuery = null
    navMesh?.destroy()
    navMesh = null
    const { navMesh: imported } = importNavMesh(data)
    navMesh = imported
    navMeshQuery = new NavMeshQuery(navMesh)
    navMeshReady = true
    walkable = null
    heights = null
    lastBakeError = null
    return true
  } catch (err) {
    lastBakeError = err instanceof Error ? err.message : String(err)
    navMeshReady = false
    return false
  }
}

function bakeOnMainThread(positions: Float32Array, indices: Uint32Array): Uint8Array | null {
  const result = generateSoloNavMesh(positions, indices, NAV_MESH_CONFIG)
  const { success, navMesh: generated } = result
  const error = (result as { error?: string }).error
  if (!success || !generated) {
    lastBakeError = typeof error === 'string' ? error : 'navmesh generation failed'
    return null
  }
  const data = exportNavMesh(generated)
  generated.destroy()
  return data
}

function bakeInWorker(positions: Float32Array, indices: Uint32Array): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    try {
      if (!bakeWorker) {
        bakeWorker = new Worker(new URL('./navMeshWorker.ts', import.meta.url), { type: 'module' })
      }
      const id = ++bakeRequestId
      const onMessage = (e: MessageEvent<NavMeshWorkerResponse>) => {
        if (e.data.type !== 'bake' || e.data.id !== id) return
        bakeWorker?.removeEventListener('message', onMessage)
        if (e.data.success) resolve(e.data.navMeshData)
        else {
          lastBakeError = e.data.error
          resolve(null)
        }
      }
      bakeWorker.addEventListener('message', onMessage)
      const req: NavMeshWorkerRequest = { type: 'bake', id, positions, indices }
      bakeWorker.postMessage(req, [positions.buffer, indices.buffer])
    } catch (err) {
      lastBakeError = err instanceof Error ? err.message : String(err)
      resolve(null)
    }
  })
}

/** Bake Recast navmesh bytes without installing the global navmesh (per-layer agents). */
export async function bakeNavMeshDataFromMeshes(meshes: THREE.Mesh[]): Promise<Uint8Array | null> {
  lastBakeError = null
  if (meshes.length === 0) {
    lastBakeError = 'No geometry to bake'
    return null
  }

  const { positions, indices } = meshesToArrays(meshes)
  if (positions.length < 9 || indices.length < 3) {
    lastBakeError = 'Insufficient walkable geometry'
    return null
  }

  const ok = await ensureRecastInit()
  if (!ok) return null

  const posCopy = new Float32Array(positions)
  const idxCopy = new Uint32Array(indices)

  let data = await bakeInWorker(posCopy, idxCopy)
  if (!data) {
    const pos2 = new Float32Array(positions)
    const idx2 = new Uint32Array(indices)
    data = bakeOnMainThread(pos2, idx2)
  }
  return data
}

/** Bake a Recast polygon navmesh from an explicit mesh list. */
export async function bakeNavMeshFromMeshes(meshes: THREE.Mesh[]): Promise<boolean> {
  if (bakePromise) return bakePromise

  bakePromise = (async () => {
    navMeshBaking = true
    lastBakeError = null
    try {
      const data = await bakeNavMeshDataFromMeshes(meshes)
      if (!data) return false
      return installNavMesh(data)
    } finally {
      navMeshBaking = false
      bakePromise = null
    }
  })()

  return bakePromise
}

/** Bake a Recast polygon navmesh from static / landscape geometry. */
export async function bakeNavMesh(actors: Map<string, Actor>): Promise<boolean> {
  return bakeNavMeshFromMeshes(collectNavMeshes(actors))
}

function findRecastPath(
  from: [number, number, number],
  to: [number, number, number],
): [number, number, number][] | null {
  if (!navMeshQuery) return null
  const halfExtents = { x: 2, y: 4, z: 2 }
  const start = { x: from[0], y: from[1], z: from[2] }
  const end = { x: to[0], y: to[1], z: to[2] }
  const { success, path } = navMeshQuery.computePath(start, end, { halfExtents })
  if (!success || path.length < 2) return null
  return path.map((p) => [p.x, p.y, p.z])
}

function bakeGrid(actors: Map<string, Actor>) {
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
}

function idx(gx: number, gz: number) {
  return gz * SIZE + gx
}
function inGrid(gx: number, gz: number) {
  return gx >= 0 && gz >= 0 && gx < SIZE && gz < SIZE
}

function findGridPath(
  from: [number, number, number],
  to: [number, number, number],
): [number, number, number][] | null {
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
      const cells: number[] = [cur]
      let c = cur
      while (came.has(c)) {
        c = came.get(c)!
        cells.push(c)
      }
      cells.reverse()
      return cells.map((ci) => [(ci % SIZE) - HALF, h[ci], Math.floor(ci / SIZE) - HALF] as [number, number, number])
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
      if (Math.abs(h[ni] - h[cur]) > 0.8) continue
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

/** Pathfind on the Recast navmesh when baked; otherwise grid A* fallback. */
export function findPath(
  actors: Map<string, Actor>,
  from: [number, number, number],
  to: [number, number, number],
): [number, number, number][] | null {
  if (navMeshReady && navMeshQuery) {
    const recast = findRecastPath(from, to)
    if (recast) return recast
  }
  if (!walkable) bakeGrid(actors)
  return findGridPath(from, to)
}