import * as THREE from 'three'
import type { AutotileCorner, AutotileRule } from './gridMap'

/** Total tiles in the autotile sprite sheet (4-neighbor bitmask 0–15). */
export const AUTOTILE_ATLAS_SIZE = 16

export const DEFAULT_ATLAS_COLS = 4
export const DEFAULT_ATLAS_ROWS = 4

export interface AtlasUvRect {
  /** Normalized U offset (left). */
  u: number
  /** Normalized V offset (bottom). */
  v: number
  /** Tile width in UV space. */
  w: number
  /** Tile height in UV space. */
  h: number
}

/** Cardinal bitmask → atlas index (0–15). */
export function atlasIndexForMask(mask: number): number {
  return Math.max(0, Math.min(AUTOTILE_ATLAS_SIZE - 1, Math.floor(mask)))
}

/** Corner variant → dedicated atlas slot; `none` returns null (use mask). */
export function atlasIndexForCorner(corner: AutotileCorner): number | null {
  if (corner === 'none') return null
  const CORNER_INDEX: Record<Exclude<AutotileCorner, 'none'>, number> = {
    'inner-ne': 5,
    'inner-se': 6,
    'inner-sw': 9,
    'inner-nw': 10,
    'outer-ne': 0,
    'outer-se': 3,
    'outer-sw': 12,
    'outer-nw': 15,
  }
  return CORNER_INDEX[corner]
}

/** Resolved autotile rule → atlas tile index (corner overrides cardinal mask). */
export function atlasIndexForRule(rule: AutotileRule): number {
  const cornerIdx = atlasIndexForCorner(rule.corner)
  if (cornerIdx !== null) return cornerIdx
  return atlasIndexForMask(rule.mask)
}

/** UV rect for a tile index in a cols×rows atlas grid. */
export function atlasUvRect(
  index: number,
  cols = DEFAULT_ATLAS_COLS,
  rows = DEFAULT_ATLAS_ROWS,
): AtlasUvRect {
  const c = Math.max(1, Math.floor(cols))
  const r = Math.max(1, Math.floor(rows))
  const i = Math.max(0, Math.min(AUTOTILE_ATLAS_SIZE - 1, Math.floor(index)))
  const col = i % c
  const row = Math.floor(i / c)
  const tw = 1 / c
  const th = 1 / r
  return { u: col * tw, v: 1 - (row + 1) * th, w: tw, h: th }
}

export const ATLAS_PALETTE = [
  '#3a4150',
  '#4a5568',
  '#5c6b7f',
  '#7a8699',
  '#3f7d44',
  '#4aef88',
  '#f5a623',
  '#c77dff',
  '#56b3c9',
  '#9b59b6',
  '#e74c3c',
  '#2f80ed',
  '#6e5239',
  '#dfe7ec',
  '#46a758',
  '#ff6b6b',
]

/** Debug sprite sheet — numbered 4×4 grid for editor preview. */
export function createAutotileAtlasTexture(
  cols = DEFAULT_ATLAS_COLS,
  rows = DEFAULT_ATLAS_ROWS,
): THREE.CanvasTexture {
  const c = Math.max(1, Math.floor(cols))
  const r = Math.max(1, Math.floor(rows))
  const cellPx = 32
  const canvas = document.createElement('canvas')
  canvas.width = c * cellPx
  canvas.height = r * cellPx
  const ctx = canvas.getContext('2d')!
  for (let i = 0; i < AUTOTILE_ATLAS_SIZE; i++) {
    const col = i % c
    const row = Math.floor(i / c)
    const x = col * cellPx
    const y = row * cellPx
    ctx.fillStyle = ATLAS_PALETTE[i % ATLAS_PALETTE.length]
    ctx.fillRect(x, y, cellPx, cellPx)
    ctx.strokeStyle = '#1a1d24'
    ctx.lineWidth = 2
    ctx.strokeRect(x + 1, y + 1, cellPx - 2, cellPx - 2)
    ctx.fillStyle = '#e8eaed'
    ctx.font = 'bold 14px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(i), x + cellPx / 2, y + cellPx / 2)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

/** InstancedMesh shader patch — per-instance atlas UV offset from `instanceUvRect`. */
export function patchMaterialForAtlasUv(mat: THREE.MeshStandardMaterial): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute vec4 instanceUvRect;\n${shader.vertexShader}`
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
#ifdef USE_INSTANCING
  vUv = vUv * instanceUvRect.zw + instanceUvRect.xy;
#endif`,
    )
  }
  mat.customProgramCacheKey = () => 'lotus_autotile_atlas_v1'
}