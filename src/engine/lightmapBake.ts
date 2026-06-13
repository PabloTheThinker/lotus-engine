import * as THREE from 'three'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'
import type { Actor } from './Actor'
import type { SerializedActor } from './types'

/**
 * Baked AO (approx) — hemisphere raycast ambient occlusion, not Lightmass.
 * Writes per-vertex grayscale into geometry.color and enables material.vertexColors.
 */

THREE.Mesh.prototype.raycast = acceleratedRaycast

export interface BakeAOOptions {
  samples?: number
  radius?: number
  /** 0–1 how strongly occlusion darkens vertices */
  strength?: number
  /** vertices processed per yield chunk (main-thread breathing room) */
  chunkSize?: number
  onProgress?: (done: number, total: number, label: string) => void
}

export interface BakeAOResult {
  ok: boolean
  actorsBaked: number
  verticesProcessed: number
  error?: string
}

export let aoBaking = false
export let lastAOBakeError: string | null = null
export let aoBakeProgress = { done: 0, total: 0, label: '' }

const _pos = new THREE.Vector3()
const _normal = new THREE.Vector3()
const _rayDir = new THREE.Vector3()
const _rayOrigin = new THREE.Vector3()
const _tangent = new THREE.Vector3()
const _bitangent = new THREE.Vector3()
const _raycaster = new THREE.Raycaster()

let bakePromise: Promise<BakeAOResult> | null = null

const hemisphereSamplesCache = new Map<number, THREE.Vector3[]>()

function getHemisphereSamples(count: number): THREE.Vector3[] {
  let cached = hemisphereSamplesCache.get(count)
  if (cached) return cached
  cached = []
  const golden = (1 + Math.sqrt(5)) / 2
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count
    const y = t
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const azimuth = (2 * Math.PI * i) / golden
    cached.push(new THREE.Vector3(Math.cos(azimuth) * r, y, Math.sin(azimuth) * r))
  }
  hemisphereSamplesCache.set(count, cached)
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

function isBakeGeometryActor(actor: Actor): boolean {
  if (actor.mobility !== 'static') return false
  if (actor.type === 'Landscape' && actor.landscapeProps?.weights) return false
  return (
    actor.type === 'StaticMesh' ||
    actor.type === 'CustomMesh' ||
    actor.type === 'ImportedMesh' ||
    actor.type === 'Landscape'
  )
}

function collectBakeMeshes(actor: Actor): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  actor.root.traverse((o) => {
    if (
      o instanceof THREE.Mesh &&
      !o.userData.isHelper &&
      !o.userData.isEditorOnly &&
      !o.userData.isParticles &&
      !o.userData.isLabel3D
    ) {
      meshes.push(o)
    }
  })
  return meshes
}

function collectAllOccluderMeshes(actors: Map<string, Actor>): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  for (const actor of actors.values()) {
    if (!isBakeGeometryActor(actor)) continue
    meshes.push(...collectBakeMeshes(actor))
  }
  return meshes
}

function ensureBVH(mesh: THREE.Mesh) {
  const geo = mesh.geometry
  if (!geo.attributes.position) return
  if (!geo.boundsTree) {
    geo.computeBoundsTree = computeBoundsTree
    geo.disposeBoundsTree = disposeBoundsTree
    geo.computeBoundsTree()
  }
}

function disposeBVH(mesh: THREE.Mesh) {
  const geo = mesh.geometry
  if (geo.boundsTree && geo.disposeBoundsTree) {
    geo.disposeBoundsTree()
  }
}

function enableVertexColors(mesh: THREE.Mesh) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  for (const m of mats) {
    if (m instanceof THREE.MeshStandardMaterial) {
      m.vertexColors = true
      m.needsUpdate = true
    }
  }
}

export function applyVertexColors(mesh: THREE.Mesh, colors: Float32Array | number[]) {
  const arr = colors instanceof Float32Array ? colors : new Float32Array(colors)
  mesh.geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  mesh.geometry.attributes.color.needsUpdate = true
  enableVertexColors(mesh)
}

/** Re-apply serialized baked AO colors after level load / instantiate. */
export function applySerializedBakedAO(actor: Actor, sa: SerializedActor) {
  if (!sa.bakedAO) return
  actor.bakedAO = true
  if (!sa.bakedAOMeshes?.length) return
  const meshes = collectBakeMeshes(actor)
  sa.bakedAOMeshes.forEach((colors, i) => {
    const mesh = meshes[i]
    if (!mesh || !colors.length) return
    applyVertexColors(mesh, colors)
  })
}

export function extractBakedAOMeshes(actor: Actor): number[][] | undefined {
  if (!actor.bakedAO) return undefined
  const meshes = collectBakeMeshes(actor)
  const out: number[][] = []
  for (const mesh of meshes) {
    const c = mesh.geometry.attributes.color
    if (c) out.push(Array.from(c.array as ArrayLike<number>))
    else out.push([])
  }
  return out.some((a) => a.length) ? out : undefined
}

function yieldChunk(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Bake approximate ambient occlusion into vertex colors for static mesh actors.
 * Label: "Baked AO (approx)" — not Lightmass.
 */
export async function bakeAO(
  actors: Map<string, Actor>,
  opts: BakeAOOptions = {},
): Promise<BakeAOResult> {
  if (bakePromise) return bakePromise

  const samples = Math.max(4, Math.min(64, opts.samples ?? 16))
  const radius = Math.max(0.05, opts.radius ?? 1)
  const strength = Math.max(0, Math.min(1, opts.strength ?? 0.85))
  const chunkSize = Math.max(32, opts.chunkSize ?? 256)
  const onProgress = opts.onProgress

  bakePromise = (async (): Promise<BakeAOResult> => {
    aoBaking = true
    lastAOBakeError = null
    aoBakeProgress = { done: 0, total: 0, label: 'Collecting geometry…' }
    onProgress?.(0, 1, aoBakeProgress.label)

    const bakeActors = [...actors.values()].filter(isBakeGeometryActor)
    const occluders = collectAllOccluderMeshes(actors)

    if (!occluders.length) {
      lastAOBakeError = 'No static mesh geometry to bake'
      aoBaking = false
      bakePromise = null
      return { ok: false, actorsBaked: 0, verticesProcessed: 0, error: lastAOBakeError }
    }

    for (const mesh of occluders) ensureBVH(mesh)

    const sampleDirs = getHemisphereSamples(samples)
    let totalVerts = 0
    for (const actor of bakeActors) {
      for (const mesh of collectBakeMeshes(actor)) {
        totalVerts += mesh.geometry.attributes.position?.count ?? 0
      }
    }

    aoBakeProgress = { done: 0, total: totalVerts, label: 'Baking AO (approx)…' }
    onProgress?.(0, totalVerts, aoBakeProgress.label)

    _raycaster.far = radius
    _raycaster.near = 0.0001
    _raycaster.firstHitOnly = true

    let processed = 0
    let actorsBaked = 0
    let vertsSinceYield = 0

    try {
      for (const actor of bakeActors) {
        const targets = collectBakeMeshes(actor)
        if (!targets.length) continue

        for (const target of targets) {
          const geo = target.geometry
          const posAttr = geo.attributes.position as THREE.BufferAttribute | undefined
          const normAttr = geo.attributes.normal as THREE.BufferAttribute | undefined
          if (!posAttr?.count) continue

          if (!normAttr) geo.computeVertexNormals()

          const colors = new Float32Array(posAttr.count * 3)
          target.updateWorldMatrix(true, false)
          const normalMatrix = new THREE.Matrix3().getNormalMatrix(target.matrixWorld)

          for (let vi = 0; vi < posAttr.count; vi++) {
            _pos.fromBufferAttribute(posAttr, vi).applyMatrix4(target.matrixWorld)
            _normal.fromBufferAttribute(geo.attributes.normal as THREE.BufferAttribute, vi)
            _normal.applyMatrix3(normalMatrix).normalize()

            _rayOrigin.copy(_pos).addScaledVector(_normal, 0.002)

            let hits = 0
            for (const sample of sampleDirs) {
              orientSampleToNormal(sample, _normal, _rayDir)
              _raycaster.set(_rayOrigin, _rayDir)
              const intersections = _raycaster.intersectObjects(occluders, false)
              for (const hit of intersections) {
                if (hit.distance < 0.003 && hit.object === target) continue
                hits++
                break
              }
            }

            const occlusion = hits / samples
            const shade = 1 - occlusion * strength
            colors[vi * 3] = shade
            colors[vi * 3 + 1] = shade
            colors[vi * 3 + 2] = shade

            processed++
            vertsSinceYield++
            if (vertsSinceYield >= chunkSize) {
              vertsSinceYield = 0
              aoBakeProgress = {
                done: processed,
                total: totalVerts,
                label: `Baked AO (approx): ${actor.name}`,
              }
              onProgress?.(processed, totalVerts, aoBakeProgress.label)
              await yieldChunk()
            }
          }

          applyVertexColors(target, colors)
        }

        actor.bakedAO = true
        actorsBaked++
      }

      aoBakeProgress = { done: totalVerts, total: totalVerts, label: 'Baked AO (approx) complete' }
      onProgress?.(totalVerts, totalVerts, aoBakeProgress.label)
      return { ok: true, actorsBaked, verticesProcessed: processed }
    } catch (err) {
      lastAOBakeError = err instanceof Error ? err.message : String(err)
      return { ok: false, actorsBaked, verticesProcessed: processed, error: lastAOBakeError }
    } finally {
      for (const mesh of occluders) disposeBVH(mesh)
      aoBaking = false
      bakePromise = null
    }
  })()

  return bakePromise
}