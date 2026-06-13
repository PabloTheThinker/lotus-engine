/// <reference lib="webworker" />
import * as THREE from 'three'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'

/**
 * AO bake worker — hemisphere raycast occlusion off the main thread.
 * Main thread collects mesh buffers + builds BVHs before posting transferable arrays.
 */

THREE.Mesh.prototype.raycast = acceleratedRaycast

export type AOBakeWorkerRequest = {
  type: 'bakeVertex' | 'bakeMap'
  id: number
  samples: number
  radius: number
  strength: number
  mapSize?: number
  targets: Array<{
    positions: Float32Array
    normals: Float32Array
    uv2?: Float32Array
    matrix: number[]
    normalMatrix: number[]
  }>
  occluders: Array<{
    positions: Float32Array
    indices: Uint32Array
    matrix: number[]
  }>
}

export type AOBakeWorkerResponse =
  | {
      type: 'bakeVertex' | 'bakeMap'
      id: number
      ok: true
      colors: Float32Array[]
      maps?: Float32Array[]
    }
  | { type: 'bakeVertex' | 'bakeMap'; id: number; ok: false; error: string }

const _pos = new THREE.Vector3()
const _normal = new THREE.Vector3()
const _rayDir = new THREE.Vector3()
const _rayOrigin = new THREE.Vector3()
const _tangent = new THREE.Vector3()
const _bitangent = new THREE.Vector3()
const _raycaster = new THREE.Raycaster()

function getHemisphereSamples(count: number): THREE.Vector3[] {
  const cached: THREE.Vector3[] = []
  const golden = (1 + Math.sqrt(5)) / 2
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count
    const y = t
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const azimuth = (2 * Math.PI * i) / golden
    cached.push(new THREE.Vector3(Math.cos(azimuth) * r, y, Math.sin(azimuth) * r))
  }
  return cached
}

function orientSampleToNormal(sample: THREE.Vector3, normal: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  if (Math.abs(normal.y) < 0.999) _tangent.set(0, 1, 0).cross(normal).normalize()
  else _tangent.set(1, 0, 0).cross(normal).normalize()
  _bitangent.crossVectors(normal, _tangent)
  out.set(0, 0, 0)
    .addScaledVector(_tangent, sample.x)
    .addScaledVector(_bitangent, sample.z)
    .addScaledVector(normal, sample.y)
  return out.normalize()
}

function buildOccluderMeshes(occluders: AOBakeWorkerRequest['occluders']): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  for (const o of occluders) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(o.positions, 3))
    geo.setIndex(new THREE.BufferAttribute(o.indices, 1))
    geo.computeBoundsTree = computeBoundsTree
    geo.disposeBoundsTree = disposeBoundsTree
    geo.computeBoundsTree()
    const mesh = new THREE.Mesh(geo)
    mesh.matrix.fromArray(o.matrix)
    mesh.matrixAutoUpdate = false
    mesh.updateMatrixWorld(true)
    meshes.push(mesh)
  }
  return meshes
}

function computeVertexOcclusion(
  worldPos: THREE.Vector3,
  worldNormal: THREE.Vector3,
  target: THREE.Mesh,
  occluders: THREE.Mesh[],
  sampleDirs: THREE.Vector3[],
  strength: number,
): number {
  _rayOrigin.copy(worldPos).addScaledVector(worldNormal, 0.002)
  let hits = 0
  for (const sample of sampleDirs) {
    orientSampleToNormal(sample, worldNormal, _rayDir)
    _raycaster.set(_rayOrigin, _rayDir)
    const intersections = _raycaster.intersectObjects(occluders, false)
    for (const hit of intersections) {
      if (hit.distance < 0.003 && hit.object === target) continue
      hits++
      break
    }
  }
  return 1 - (hits / sampleDirs.length) * strength
}

function finalizeAOMapBuffer(sum: Float32Array, count: Uint32Array, size: number): Float32Array {
  const out = new Float32Array(size * size)
  for (let i = 0; i < size * size; i++) out[i] = count[i] > 0 ? sum[i] / count[i] : 1
  return out
}

self.onmessage = (e: MessageEvent<AOBakeWorkerRequest>) => {
  const msg = e.data
  try {
    const sampleDirs = getHemisphereSamples(msg.samples)
    _raycaster.far = msg.radius
    _raycaster.near = 0.0001
    _raycaster.firstHitOnly = true

    const occluders = buildOccluderMeshes(msg.occluders)
    const colorsOut: Float32Array[] = []
    const mapsOut: Float32Array[] = []

    for (let ti = 0; ti < msg.targets.length; ti++) {
      const t = msg.targets[ti]
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(t.positions, 3))
      geo.setAttribute('normal', new THREE.BufferAttribute(t.normals, 3))
      if (t.uv2) geo.setAttribute('uv2', new THREE.BufferAttribute(t.uv2, 2))
      const target = new THREE.Mesh(geo)
      target.matrix.fromArray(t.matrix)
      target.matrixAutoUpdate = false
      target.updateMatrixWorld(true)

      const matrix = new THREE.Matrix4().fromArray(t.matrix)
      const normalMatrix = new THREE.Matrix3().fromArray(t.normalMatrix)
      const posAttr = geo.attributes.position as THREE.BufferAttribute
      const normAttr = geo.attributes.normal as THREE.BufferAttribute
      const colors = new Float32Array(posAttr.count * 3)

      if (msg.type === 'bakeMap' && msg.mapSize && t.uv2) {
        const mapSize = msg.mapSize
        const sum = new Float32Array(mapSize * mapSize)
        const count = new Uint32Array(mapSize * mapSize)
        const uv2Attr = geo.attributes.uv2 as THREE.BufferAttribute

        for (let vi = 0; vi < posAttr.count; vi++) {
          _pos.fromBufferAttribute(posAttr, vi).applyMatrix4(matrix)
          _normal.fromBufferAttribute(normAttr, vi).applyMatrix3(normalMatrix).normalize()
          const shade = computeVertexOcclusion(_pos, _normal, target, occluders, sampleDirs, msg.strength)
          const u = uv2Attr.getX(vi)
          const v = uv2Attr.getY(vi)
          const tx = THREE.MathUtils.clamp(Math.floor(u * mapSize), 0, mapSize - 1)
          const ty = THREE.MathUtils.clamp(Math.floor(v * mapSize), 0, mapSize - 1)
          const idx = ty * mapSize + tx
          sum[idx] += shade
          count[idx]++
        }
        mapsOut.push(finalizeAOMapBuffer(sum, count, mapSize))
      }

      for (let vi = 0; vi < posAttr.count; vi++) {
        _pos.fromBufferAttribute(posAttr, vi).applyMatrix4(matrix)
        _normal.fromBufferAttribute(normAttr, vi).applyMatrix3(normalMatrix).normalize()
        const shade = computeVertexOcclusion(_pos, _normal, target, occluders, sampleDirs, msg.strength)
        colors[vi * 3] = shade
        colors[vi * 3 + 1] = shade
        colors[vi * 3 + 2] = shade
      }
      colorsOut.push(colors)
      geo.dispose()
    }

    for (const m of occluders) {
      m.geometry.disposeBoundsTree?.()
      m.geometry.dispose()
    }

    const res: AOBakeWorkerResponse = {
      type: msg.type,
      id: msg.id,
      ok: true,
      colors: colorsOut,
      maps: mapsOut.length ? mapsOut : undefined,
    }
    self.postMessage(res)
  } catch (err) {
    const res: AOBakeWorkerResponse = {
      type: msg.type,
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(res)
  }
}