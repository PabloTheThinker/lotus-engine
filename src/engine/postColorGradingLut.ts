import * as THREE from 'three'
import type { EnvironmentSettings } from './types'

/** Wave 29–30 — identity LUT strip + apply in grading pass when uploaded. */

export const GRADING_LUT_SIZE = 16

let identityLUT: THREE.DataTexture | null = null

export function createIdentityLUTTexture(): THREE.DataTexture {
  if (identityLUT) return identityLUT
  const n = GRADING_LUT_SIZE * GRADING_LUT_SIZE
  const data = new Uint8Array(n * 4)
  for (let y = 0; y < GRADING_LUT_SIZE; y++) {
    for (let x = 0; x < GRADING_LUT_SIZE; x++) {
      const i = (y * GRADING_LUT_SIZE + x) * 4
      data[i] = Math.round((x / (GRADING_LUT_SIZE - 1)) * 255)
      data[i + 1] = Math.round((y / (GRADING_LUT_SIZE - 1)) * 255)
      data[i + 2] = Math.round(((x + y) / (GRADING_LUT_SIZE * 2 - 2)) * 255)
      data[i + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(data, GRADING_LUT_SIZE * GRADING_LUT_SIZE, 1, THREE.RGBAFormat)
  tex.needsUpdate = true
  tex.colorSpace = THREE.SRGBColorSpace
  identityLUT = tex
  return tex
}

export interface ColorGradingLUTState {
  enabled: boolean
  name: string | null
  size: number
  strength: number
  texture: THREE.DataTexture
}

export function getColorGradingLUTState(env: EnvironmentSettings): ColorGradingLUTState {
  const name = env.postGradingLutName ?? null
  return {
    enabled: !!name,
    name,
    size: GRADING_LUT_SIZE,
    strength: env.postGradingLutStrength ?? 1,
    texture: createIdentityLUTTexture(),
  }
}

export function getGradingLUTStub(env: EnvironmentSettings): {
  enabled: boolean
  name: string | null
  size: number
} {
  const s = getColorGradingLUTState(env)
  return { enabled: s.enabled, name: s.name, size: s.size }
}

/** Honest stub — stores filename only; texture stays identity until real decode lands. */
export function registerGradingLUTUpload(fileName: string): string {
  return fileName.replace(/[^\w.\-]+/g, '_').slice(0, 120)
}

/** Wave 30 — TSL LUT sample (horizontal strip layout). */
export interface GradingLUTTslOps {
  float: (n: number) => unknown
  vec2: (x: unknown, y: unknown) => unknown
  vec3: (x: unknown, y: unknown, z: unknown) => unknown
  mix: (a: unknown, b: unknown, t: unknown) => unknown
  mul: (a: unknown, b: unknown) => unknown
  add: (a: unknown, b: unknown) => unknown
  texture: (tex: THREE.Texture, uv: unknown) => { rgb: unknown }
}

export function applyGradingLUTTSL(
  rgb: unknown,
  lut: ColorGradingLUTState,
  tsl: GradingLUTTslOps,
): unknown {
  if (!lut.enabled || lut.strength <= 0.001) return rgb
  const node = rgb as { r?: unknown; g?: unknown; x?: unknown; y?: unknown }
  const r = node.r ?? node.x ?? rgb
  const g = node.g ?? node.y ?? rgb
  const size = lut.size
  const grid = size * size
  const idx = tsl.mul(
    tsl.add(
      tsl.mul(r, tsl.float(size - 1)),
      tsl.mul(g, tsl.float((size - 1) * size)),
    ),
    tsl.float(1 / grid),
  )
  const uv = tsl.vec2(idx, tsl.float(0.5))
  const sampled = tsl.texture(lut.texture, uv).rgb
  return tsl.mix(rgb, sampled, tsl.float(Math.max(0, Math.min(1, lut.strength))))
}