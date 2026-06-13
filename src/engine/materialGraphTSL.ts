import * as THREE from 'three'
import type { MaterialGraph, MatValue } from './materialGraph'
import { evaluateMaterialGraph } from './materialGraph'

const toVec = (v: MatValue): [number, number, number] => (typeof v === 'number' ? [v, v, v] : v)
const toNum = (v: MatValue): number => (typeof v === 'number' ? v : (v[0] + v[1] + v[2]) / 3)

/**
 * TSL material backend (preview stub) — parallel to materialShader.ts GLSL path.
 * Uses MeshPhysicalNodeMaterial when WebGPU/TSL is available; falls back to CPU eval.
 */

export type MaterialBackend = 'glsl' | 'tsl'

export function isTSLPreviewAvailable(): boolean {
  return typeof (THREE as unknown as { MeshPhysicalNodeMaterial?: unknown }).MeshPhysicalNodeMaterial === 'function'
}

/** Apply material instance overrides as TSL uniform targets (Wave 10.7 stub). */
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
  if (!isTSLPreviewAvailable()) return null
  try {
    const NodeMaterial = (THREE as unknown as { MeshPhysicalNodeMaterial: new () => THREE.MeshPhysicalMaterial })
      .MeshPhysicalNodeMaterial
    const mat = new NodeMaterial()
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