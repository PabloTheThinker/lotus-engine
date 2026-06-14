import * as THREE from 'three'
import type { EnvironmentSettings } from './types'

/** Wave 29–31 — LUT strip decode (.cube / .3dl) + apply in grading pass. */

export const GRADING_LUT_SIZE = 16

let identityLUT: THREE.DataTexture | null = null
const decodedLUTCache = new Map<string, THREE.DataTexture>()

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

export type GradingLUTFormat = 'cube' | '3dl' | 'png' | 'identity'

export interface DecodedGradingLUT {
  size: number
  texture: THREE.DataTexture
  format: GradingLUTFormat
  /** Wave 32 — raw RGBA bytes for export / level persist */
  rgbaBytes?: Uint8Array
}

function buildLUTTextureFromRGB(size: number, rgb: Float32Array): THREE.DataTexture {
  const n = size * size * size
  const data = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const i3 = i * 3
    data[i * 4] = Math.round(Math.max(0, Math.min(1, rgb[i3])) * 255)
    data[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, rgb[i3 + 1])) * 255)
    data[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, rgb[i3 + 2])) * 255)
    data[i * 4 + 3] = 255
  }
  const tex = new THREE.DataTexture(data, size * size, size, THREE.RGBAFormat)
  tex.needsUpdate = true
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Parse Iridas/Adobe .cube LUT (LUT_3D_SIZE + RGB triplets). */
export function parseCubeLUT(text: string): DecodedGradingLUT | null {
  const lines = text.split(/\r?\n/)
  let size = 0
  const samples: number[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('TITLE')) continue
    if (line.startsWith('LUT_3D_SIZE')) {
      size = parseInt(line.split(/\s+/)[1] ?? '0', 10)
      continue
    }
    if (line.startsWith('DOMAIN_')) continue
    const parts = line.split(/\s+/).map(parseFloat).filter((n) => Number.isFinite(n))
    if (parts.length >= 3) samples.push(parts[0]!, parts[1]!, parts[2]!)
  }
  if (!size || size < 2) size = Math.round(Math.cbrt(samples.length / 3))
  if (!size || size < 2) return null
  const need = size * size * size * 3
  const rgb = new Float32Array(need)
  const copy = Math.min(need, samples.length)
  for (let i = 0; i < copy; i++) rgb[i] = samples[i]!
  for (let i = copy; i < need; i += 3) {
    const t = i / 3
    rgb[i] = (t % size) / (size - 1)
    rgb[i + 1] = (Math.floor(t / size) % size) / (size - 1)
    rgb[i + 2] = Math.floor(t / (size * size)) / (size - 1)
  }
  const texture = buildLUTTextureFromRGB(size, rgb)
  return { size, texture, format: 'cube', rgbaBytes: texture.image.data as Uint8Array }
}

/** Parse ASCII .3dl (line triplets, infer cube size). */
export function parse3dlLUT(text: string): DecodedGradingLUT | null {
  const samples: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || /^[A-Za-z]/.test(line)) continue
    const parts = line.split(/\s+/).map(parseFloat).filter((n) => Number.isFinite(n))
    if (parts.length >= 3) {
      const scale = parts[0]! > 1 || parts[1]! > 1 || parts[2]! > 1 ? 1 / 255 : 1
      samples.push(parts[0]! * scale, parts[1]! * scale, parts[2]! * scale)
    }
  }
  if (samples.length < 24) return null
  let size = Math.round(Math.cbrt(samples.length / 3))
  if (size < 2) size = 2
  while (size * size * size * 3 > samples.length && size > 2) size--
  const need = size * size * size * 3
  const rgb = new Float32Array(need)
  const copy = Math.min(need, samples.length)
  for (let i = 0; i < copy; i++) rgb[i] = samples[i]!
  const texture = buildLUTTextureFromRGB(size, rgb)
  return { size, texture, format: '3dl', rgbaBytes: texture.image.data as Uint8Array }
}

/** Infer 3D LUT cube size from 2D atlas dimensions (width = size², height = size). */
export function inferLUTAtlasSize(width: number, height: number): number {
  if (width > 0 && height > 0 && width === height * height) return height
  const side = Math.round(Math.cbrt(width * height))
  return Math.max(2, Math.min(64, side))
}

function buildLUTTextureFromRGBA(width: number, height: number, rgba: Uint8Array, size: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat)
  tex.needsUpdate = true
  tex.colorSpace = THREE.SRGBColorSpace
  tex.userData.lutSize = size
  return tex
}

/** Wave 32 — PNG/JPEG atlas → 3D LUT texture (square atlas layout). */
export function decodePngLUTAtlas(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): DecodedGradingLUT | null {
  if (width < 2 || height < 2) return null
  const size = inferLUTAtlasSize(width, height)
  const bytes = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba)
  const tex = buildLUTTextureFromRGBA(width, height, bytes, size)
  return { size, texture: tex, format: 'png', rgbaBytes: bytes }
}

export function decodePngLUTFromBase64(b64: string, width: number, height: number): DecodedGradingLUT | null {
  try {
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    return decodePngLUTAtlas(raw, width, height)
  } catch {
    return null
  }
}

export function serializeGradingLUTForLevel(env: EnvironmentSettings): Pick<
  EnvironmentSettings,
  'postGradingLutData' | 'postGradingLutAtlasW' | 'postGradingLutAtlasH' | 'postGradingLutFormat'
> | null {
  if (!env.postGradingLutName || !env.postGradingLutData) return null
  return {
    postGradingLutData: env.postGradingLutData,
    postGradingLutAtlasW: env.postGradingLutAtlasW,
    postGradingLutAtlasH: env.postGradingLutAtlasH,
    postGradingLutFormat: env.postGradingLutFormat ?? 'png',
  }
}

/** Restore decoded LUT texture from level environment on load. */
export function restoreGradingLUTFromEnvironment(env: EnvironmentSettings): boolean {
  const name = env.postGradingLutName
  if (!name || !env.postGradingLutData) return false
  const w = env.postGradingLutAtlasW ?? 0
  const h = env.postGradingLutAtlasH ?? 0
  if (w < 2 || h < 2) return false
  const decoded = decodePngLUTFromBase64(env.postGradingLutData, w, h)
  if (!decoded) return false
  decodedLUTCache.set(name, decoded.texture)
  return true
}

export function getExportGradingLUTPayload(env: EnvironmentSettings): {
  name: string
  size: number
  format: string
  data: string
  atlasW: number
  atlasH: number
} | null {
  if (!env.postGradingLutName || !env.postGradingLutData) return null
  return {
    name: env.postGradingLutName,
    size: env.postGradingLutSize ?? GRADING_LUT_SIZE,
    format: env.postGradingLutFormat ?? 'png',
    data: env.postGradingLutData,
    atlasW: env.postGradingLutAtlasW ?? env.postGradingLutSize ?? GRADING_LUT_SIZE,
    atlasH: env.postGradingLutAtlasH ?? env.postGradingLutSize ?? GRADING_LUT_SIZE,
  }
}

export function persistDecodedLUTToEnvironment(
  env: EnvironmentSettings,
  fileName: string,
  decoded: DecodedGradingLUT,
): void {
  env.postGradingLutName = registerGradingLUTUpload(fileName)
  env.postGradingLutSize = decoded.size
  env.postGradingLutFormat =
    decoded.format === 'identity' ? 'png' : decoded.format
  if (decoded.rgbaBytes && decoded.texture.image.width && decoded.texture.image.height) {
    env.postGradingLutAtlasW = decoded.texture.image.width
    env.postGradingLutAtlasH = decoded.texture.image.height
    let bin = ''
    for (let i = 0; i < decoded.rgbaBytes.length; i++) bin += String.fromCharCode(decoded.rgbaBytes[i]!)
    env.postGradingLutData = btoa(bin)
  }
  decodedLUTCache.set(env.postGradingLutName, decoded.texture)
}

export function decodeGradingLUTFile(fileName: string, text: string): DecodedGradingLUT | null {
  const lower = fileName.toLowerCase()
  const decoded =
    lower.endsWith('.cube') ? parseCubeLUT(text) : lower.endsWith('.3dl') ? parse3dlLUT(text) : parseCubeLUT(text) ?? parse3dlLUT(text)
  if (!decoded) return null
  decodedLUTCache.set(fileName, decoded.texture)
  return decoded
}

export function cacheDecodedGradingLUT(fileName: string, texture: THREE.DataTexture, size: number): void {
  decodedLUTCache.set(fileName, texture)
  texture.userData.lutSize = size
}

export function getCachedGradingLUT(fileName: string | null | undefined): THREE.DataTexture | null {
  if (!fileName) return null
  return decodedLUTCache.get(fileName) ?? null
}

export interface ColorGradingLUTState {
  enabled: boolean
  name: string | null
  size: number
  strength: number
  texture: THREE.DataTexture
  format: GradingLUTFormat
}

export function getColorGradingLUTState(env: EnvironmentSettings): ColorGradingLUTState {
  const name = env.postGradingLutName ?? null
  const cached = getCachedGradingLUT(name)
  const size = (cached?.userData.lutSize as number | undefined) ?? env.postGradingLutSize ?? GRADING_LUT_SIZE
  const texture = cached ?? createIdentityLUTTexture()
  return {
    enabled: !!name,
    name,
    size,
    strength: env.postGradingLutStrength ?? 1,
    texture,
    format: cached
      ? ((env.postGradingLutFormat as GradingLUTFormat) ??
        (name?.toLowerCase().endsWith('.3dl') ? '3dl' : name?.toLowerCase().endsWith('.png') ? 'png' : 'cube'))
      : 'identity',
  }
}

export function getGradingLUTStub(env: EnvironmentSettings): {
  enabled: boolean
  name: string | null
  size: number
  format: string
} {
  const s = getColorGradingLUTState(env)
  return { enabled: s.enabled, name: s.name, size: s.size, format: s.format }
}

export function registerGradingLUTUpload(fileName: string): string {
  return fileName.replace(/[^\w.\-]+/g, '_').slice(0, 120)
}

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
  const b = (node as { b?: unknown; z?: unknown }).b ?? (node as { z?: unknown }).z ?? tsl.float(0)
  const u = tsl.mul(
    tsl.add(tsl.mul(r, tsl.float(size - 1)), tsl.mul(g, tsl.float(size - 1))),
    tsl.float(1 / grid),
  )
  const v = tsl.mul(b, tsl.float(1 / size))
  const uv = tsl.vec2(u, v)
  const sampled = tsl.texture(lut.texture, uv).rgb
  return tsl.mix(rgb, sampled, tsl.float(Math.max(0, Math.min(1, lut.strength))))
}

/** Wave 31 — export/runtime GLSL LUT sample snippet (horizontal strip). */
export function gradingLUTGlslSnippet(): string {
  return `
      if (lutEnabled > 0.5) {
        float grid = lutSize * lutSize;
        float idx = (c.r * (lutSize - 1.0) + c.g * (lutSize - 1.0) * lutSize);
        vec2 lutUv = vec2((idx + 0.5) / grid, 0.5);
        vec3 lutC = texture2D(lutMap, lutUv).rgb;
        c = mix(c, lutC, clamp(lutStrength, 0.0, 1.0));
      }`
}