import * as THREE from 'three'
import type { EnvironmentSettings } from './types'

/** Wave 29 — identity LUT stub (16×16 strip) for upload wiring. */

const LUT_SIZE = 16

let identityLUT: THREE.DataTexture | null = null

export function createIdentityLUTTexture(): THREE.DataTexture {
  if (identityLUT) return identityLUT
  const n = LUT_SIZE * LUT_SIZE
  const data = new Uint8Array(n * 4)
  for (let y = 0; y < LUT_SIZE; y++) {
    for (let x = 0; x < LUT_SIZE; x++) {
      const i = (y * LUT_SIZE + x) * 4
      data[i] = Math.round((x / (LUT_SIZE - 1)) * 255)
      data[i + 1] = Math.round((y / (LUT_SIZE - 1)) * 255)
      data[i + 2] = Math.round(((x + y) / (LUT_SIZE * 2 - 2)) * 255)
      data[i + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(data, LUT_SIZE * LUT_SIZE, 1, THREE.RGBAFormat)
  tex.needsUpdate = true
  tex.colorSpace = THREE.SRGBColorSpace
  identityLUT = tex
  return tex
}

export function getGradingLUTStub(env: EnvironmentSettings): {
  enabled: boolean
  name: string | null
  size: number
} {
  const name = env.postGradingLutName ?? null
  return { enabled: !!name, name, size: LUT_SIZE }
}

/** Honest stub — stores filename only; texture stays identity until real decode lands. */
export function registerGradingLUTUpload(fileName: string): string {
  return fileName.replace(/[^\w.\-]+/g, '_').slice(0, 120)
}