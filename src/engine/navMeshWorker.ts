/// <reference lib="webworker" />
import { exportNavMesh, init } from 'recast-navigation'
import { generateSoloNavMesh } from 'recast-navigation/generators'

export type NavMeshWorkerRequest = {
  type: 'bake'
  id: number
  positions: Float32Array
  indices: Uint32Array
}

export type NavMeshWorkerResponse =
  | { type: 'bake'; id: number; success: true; navMeshData: Uint8Array }
  | { type: 'bake'; id: number; success: false; error: string }

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

self.onmessage = async (e: MessageEvent<NavMeshWorkerRequest>) => {
  const msg = e.data
  if (msg.type !== 'bake') return
  try {
    await init()
    const result = generateSoloNavMesh(msg.positions, msg.indices, NAV_MESH_CONFIG)
    const { success, navMesh } = result
    const error = (result as { error?: string }).error
    if (!success || !navMesh) {
      const res: NavMeshWorkerResponse = {
        type: 'bake',
        id: msg.id,
        success: false,
        error: typeof error === 'string' ? error : 'navmesh generation failed',
      }
      self.postMessage(res)
      return
    }
    const navMeshData = exportNavMesh(navMesh)
    navMesh.destroy()
    const res: NavMeshWorkerResponse = { type: 'bake', id: msg.id, success: true, navMeshData }
    self.postMessage(res, { transfer: [navMeshData.buffer] })
  } catch (err) {
    const res: NavMeshWorkerResponse = {
      type: 'bake',
      id: msg.id,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(res)
  }
}