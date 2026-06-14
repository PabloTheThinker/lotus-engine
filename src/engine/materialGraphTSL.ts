import * as THREE from 'three'
import type { MaterialGraph, MatValue } from './materialGraph'
import { evaluateMaterialGraph } from './materialGraph'

const toVec = (v: MatValue): [number, number, number] => (typeof v === 'number' ? [v, v, v] : v)
const toNum = (v: MatValue): number => (typeof v === 'number' ? v : (v[0] + v[1] + v[2]) / 3)

/**
 * TSL material backend (Wave 11–15) — parallel to materialShader.ts GLSL path.
 * Wave 15: dynamic import from three/webgpu (no static MeshPhysicalNodeMaterial on THREE).
 */

export type MaterialBackend = 'glsl' | 'tsl'

type NodeMatCtor = new () => THREE.Material
let cachedNodeMat: NodeMatCtor | null | undefined

async function resolveNodeMaterialCtor(): Promise<NodeMatCtor | null> {
  if (cachedNodeMat !== undefined) return cachedNodeMat
  try {
    const m = await import('three/webgpu')
    const Ctor = (m as unknown as { MeshPhysicalNodeMaterial?: NodeMatCtor }).MeshPhysicalNodeMaterial
    cachedNodeMat = Ctor ?? null
  } catch {
    cachedNodeMat = null
  }
  return cachedNodeMat
}

void resolveNodeMaterialCtor()

/** Sync probe — true after async webgpu module resolves with NodeMaterial. */
export function isTSLPreviewAvailable(): boolean {
  return cachedNodeMat != null
}

/** Async capability check for editor / tests. */
export async function isTSLPreviewAvailableAsync(): Promise<boolean> {
  return (await resolveNodeMaterialCtor()) != null
}

/** Apply material instance overrides as TSL uniform targets (Wave 10.7 stub). */
/** Serialize TSL material graph preview state for export / roundtrip. */
export function serializeMaterialGraphTSL(graph: MaterialGraph, t: number): object {
  const out = evaluateMaterialGraph(graph, t)
  return {
    backend: 'tsl',
    version: 1,
    preview: {
      baseColor: out.baseColor,
      emissive: out.emissive,
      emissiveInt: out.emissiveInt,
      roughness: out.roughness,
      metalness: out.metalness,
      opacity: out.opacity,
    },
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  }
}

/** Restore TSL preview from serialized blob (preview channels only). */
export function deserializeMaterialGraphTSL(
  blob: { preview?: Record<string, MatValue> },
  graph: MaterialGraph,
  t: number,
): THREE.Material | null {
  const mat = compileMaterialGraphTSL(graph, t)
  if (!mat || !blob.preview) return mat
  const std = mat as THREE.MeshPhysicalMaterial
  const p = blob.preview
  if (p.baseColor !== undefined) {
    const [cr, cg, cb] = toVec(p.baseColor)
    std.color.setRGB(cr, cg, cb)
  }
  if (p.emissive !== undefined) {
    const [er, eg, eb] = toVec(p.emissive)
    std.emissive.setRGB(er, eg, eb)
  }
  if (p.emissiveInt !== undefined) std.emissiveIntensity = Math.max(0, toNum(p.emissiveInt))
  if (p.roughness !== undefined) std.roughness = Math.max(0, Math.min(1, toNum(p.roughness)))
  if (p.metalness !== undefined) std.metalness = Math.max(0, Math.min(1, toNum(p.metalness)))
  if (p.opacity !== undefined) {
    const op = Math.max(0, Math.min(1, toNum(p.opacity)))
    std.opacity = op
    std.transparent = op < 0.999
  }
  return mat
}

export function applyMaterialInstanceTSL(
  mat: THREE.MeshPhysicalMaterial,
  overrides: { color?: string; roughness?: number; metalness?: number; emissive?: string },
): void {
  if (overrides.color) mat.color.set(overrides.color)
  if (overrides.emissive) mat.emissive.set(overrides.emissive)
  if (overrides.roughness != null) mat.roughness = overrides.roughness
  if (overrides.metalness != null) mat.metalness = overrides.metalness
  mat.userData.lotusInstanceOverrides = overrides
}

/** Compile a Lotus material graph to a TSL-backed preview material (preview only). */
export function compileMaterialGraphTSL(
  graph: MaterialGraph,
  t: number,
  instanceOverrides?: { color?: string; roughness?: number; metalness?: number; emissive?: string },
): THREE.Material | null {
  const NodeMaterial = cachedNodeMat
  if (!NodeMaterial) return null
  try {
    const mat = new NodeMaterial() as THREE.MeshPhysicalMaterial
    const out = evaluateMaterialGraph(graph, t)
    if (out.baseColor !== undefined) {
      const [cr, cg, cb] = toVec(out.baseColor)
      mat.color.setRGB(cr, cg, cb)
    }
    if (out.emissive !== undefined) {
      const [er, eg, eb] = toVec(out.emissive)
      mat.emissive.setRGB(er, eg, eb)
    }
    if (out.emissiveInt !== undefined) mat.emissiveIntensity = Math.max(0, toNum(out.emissiveInt))
    if (out.roughness !== undefined) mat.roughness = Math.max(0, Math.min(1, toNum(out.roughness)))
    if (out.metalness !== undefined) mat.metalness = Math.max(0, Math.min(1, toNum(out.metalness)))
    if (out.opacity !== undefined) {
      const op = Math.max(0, Math.min(1, toNum(out.opacity)))
      mat.opacity = op
      mat.transparent = op < 0.999
    }
    if (instanceOverrides) applyMaterialInstanceTSL(mat, instanceOverrides)
    mat.userData.lotusMaterialBackend = 'tsl'
    mat.userData.lotusGraphPreview = true
    return mat
  } catch {
    return null
  }
}