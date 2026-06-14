import type { FoliageProps } from './types'

/**
 * GridMap — Godot GridMap-style integer cell painting on foliage layers (snap mode).
 * Instances are packed [x, y, z, scale, rotY] with y centered at cell.y + 0.5.
 * Multi-layer cells live in gridLayers[0..3]; instances is the merged render view.
 */

export const GRID_TILE_KINDS = ['box', 'sphere', 'plane'] as const
export type GridTileKind = (typeof GRID_TILE_KINDS)[number]

export interface GridCell {
  x: number
  y: number
  z: number
}

/** Packed grid cell on a TileMap layer — [x, y, z, scale, rotY]. */
export type GridLayerCell = [x: number, y: number, z: number, scale: number, rotY: number]

const CELL_Y_TOL = 0.6
const DEFAULT_CAP = 4000
const LAYER_Y_STEP = 0.05

export function worldToGridCell(x: number, y: number, z: number): GridCell {
  return { x: Math.round(x), y: Math.round(y), z: Math.round(z) }
}

export function gridCellKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`
}

export function activeGridLayerIndex(props: FoliageProps): number {
  return Math.max(0, Math.min(3, Math.floor(props.activeGridLayer ?? 0)))
}

function findGridCellIndexIn(instances: number[][], cx: number, cy: number, cz: number): number {
  return instances.findIndex(
    ([x, y, z]) => x === cx && Math.abs(y - (cy + 0.5)) < CELL_Y_TOL && z === cz,
  )
}

function findGridCellIndex(props: FoliageProps, cx: number, cy: number, cz: number): number {
  return findGridCellIndexIn(props.instances, cx, cy, cz)
}

function ensureGridLayers(props: FoliageProps): Record<number, number[][]> {
  if (!props.gridLayers) {
    props.gridLayers = { 0: props.instances.map((i) => [...i]) }
  }
  return props.gridLayers
}

function layerBucket(props: FoliageProps, layer: number): number[][] {
  const layers = ensureGridLayers(props)
  const L = Math.max(0, Math.min(3, Math.floor(layer)))
  if (!layers[L]) layers[L] = []
  return layers[L]
}

function totalLayerCells(props: FoliageProps): number {
  if (!props.gridLayers) return props.instances.length
  let n = 0
  for (let L = 0; L <= 3; L++) n += props.gridLayers[L]?.length ?? 0
  return n
}

/** Ensure gridLayerVisibility has 4 entries (default all visible). */
export function ensureGridLayerVisibility(props: FoliageProps): boolean[] {
  if (!props.gridLayerVisibility) props.gridLayerVisibility = [true, true, true, true]
  while (props.gridLayerVisibility.length < 4) props.gridLayerVisibility.push(true)
  return props.gridLayerVisibility
}

export function isGridLayerVisible(props: FoliageProps, layer: number): boolean {
  const vis = ensureGridLayerVisibility(props)
  const L = Math.max(0, Math.min(3, Math.floor(layer)))
  return vis[L] !== false
}

export function setGridLayerVisible(props: FoliageProps, layer: number, visible: boolean): void {
  const vis = ensureGridLayerVisibility(props)
  const L = Math.max(0, Math.min(3, Math.floor(layer)))
  vis[L] = visible
  syncGridInstancesFromLayers(props)
}

/** 4-neighbor autotile mask at a cell on a layer (N=1, E=2, S=4, W=8). */
export function previewAutotileMask(
  props: FoliageProps,
  layer: number,
  cx: number,
  cy: number,
  cz: number,
): number {
  const bucket = layerBucket(props, layer)
  return autotileNeighbors(
    hasLayerNeighbor(bucket, cx, cy, cz, 0, -1),
    hasLayerNeighbor(bucket, cx, cy, cz, 1, 0),
    hasLayerNeighbor(bucket, cx, cy, cz, 0, 1),
    hasLayerNeighbor(bucket, cx, cy, cz, -1, 0),
  )
}

/** Merge gridLayers into instances for InstancedMesh rendering. */
export function syncGridInstancesFromLayers(props: FoliageProps): void {
  if (!props.gridLayers) return
  const vis = ensureGridLayerVisibility(props)
  const merged: number[][] = []
  for (let L = 0; L <= 3; L++) {
    if (vis[L] === false) continue
    const bucket = props.gridLayers[L]
    if (!bucket) continue
    for (const [x, y, z, sc, rotY] of bucket) {
      const cy = Math.round(y - 0.5)
      merged.push([x, cy + 0.5 + L * LAYER_Y_STEP, z, sc, rotY])
    }
  }
  props.instances = merged
}

function hasLayerNeighbor(bucket: number[][], cx: number, cy: number, cz: number, dx: number, dz: number): boolean {
  return findGridCellIndexIn(bucket, cx + dx, cy, cz + dz) >= 0
}

/** 4-neighbor bitmask: N=1, E=2, S=4, W=8 → tile variant index 0–15 (lite). */
export function autotileNeighbors(hasN: boolean, hasE: boolean, hasS: boolean, hasW: boolean): number {
  return (hasN ? 1 : 0) | (hasE ? 2 : 0) | (hasS ? 4 : 0) | (hasW ? 8 : 0)
}

function applyAutotileAt(bucket: number[][], cx: number, cy: number, cz: number): void {
  const at = findGridCellIndexIn(bucket, cx, cy, cz)
  if (at < 0) return
  const variant = autotileNeighbors(
    hasLayerNeighbor(bucket, cx, cy, cz, 0, -1),
    hasLayerNeighbor(bucket, cx, cy, cz, 1, 0),
    hasLayerNeighbor(bucket, cx, cy, cz, 0, 1),
    hasLayerNeighbor(bucket, cx, cy, cz, -1, 0),
  )
  bucket[at][4] = variant * (Math.PI / 8)
}

function refreshAutotileAt(props: FoliageProps, layer: number, cx: number, cy: number, cz: number): void {
  const bucket = layerBucket(props, layer)
  const cells: [number, number, number][] = [
    [cx, cy, cz],
    [cx, cy, cz - 1],
    [cx + 1, cy, cz],
    [cx, cy, cz + 1],
    [cx - 1, cy, cz],
  ]
  for (const [x, y, z] of cells) applyAutotileAt(bucket, x, y, z)
}

/** Integer brush radius in cells (0 = single cell). */
export function gridBrushRadius(props: FoliageProps): number {
  return Math.max(0, Math.floor(props.gridBrushSize ?? 0))
}

export function gridCellsInBrush(cx: number, cy: number, cz: number, brushSize: number): GridCell[] {
  const r = Math.max(0, Math.floor(brushSize))
  const cells: GridCell[] = []
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      cells.push({ x: cx + dx, y: cy, z: cz + dz })
    }
  }
  return cells
}

export function paintGridCell(
  props: FoliageProps,
  cx: number,
  cy: number,
  cz: number,
  cap = DEFAULT_CAP,
): boolean {
  if (findGridCellIndex(props, cx, cy, cz) >= 0) return false
  if (props.instances.length >= cap) return false
  props.instances.push([cx, cy + 0.5, cz, 1, 0])
  return true
}

export function eraseGridCell(props: FoliageProps, cx: number, cy: number, cz: number): boolean {
  const at = findGridCellIndex(props, cx, cy, cz)
  if (at < 0) return false
  props.instances.splice(at, 1)
  return true
}

export function paintGridLayer(
  props: FoliageProps,
  layer: number,
  cx: number,
  cy: number,
  cz: number,
  cap = DEFAULT_CAP,
): boolean {
  const bucket = layerBucket(props, layer)
  if (findGridCellIndexIn(bucket, cx, cy, cz) >= 0) return false
  if (totalLayerCells(props) >= cap) return false
  bucket.push([cx, cy + 0.5, cz, 1, 0])
  if (props.gridAutotile) refreshAutotileAt(props, layer, cx, cy, cz)
  syncGridInstancesFromLayers(props)
  return true
}

export function eraseGridLayer(props: FoliageProps, layer: number, cx: number, cy: number, cz: number): boolean {
  const bucket = layerBucket(props, layer)
  const at = findGridCellIndexIn(bucket, cx, cy, cz)
  if (at < 0) return false
  bucket.splice(at, 1)
  if (props.gridAutotile) refreshAutotileAt(props, layer, cx, cy, cz)
  syncGridInstancesFromLayers(props)
  return true
}

export function getLayerCellCount(props: FoliageProps, layer: number): number {
  const L = Math.max(0, Math.min(3, Math.floor(layer)))
  if (!props.gridLayers) return L === 0 ? props.instances.length : 0
  return props.gridLayers[L]?.length ?? 0
}

export function paintGridBrush(
  props: FoliageProps,
  cx: number,
  cy: number,
  cz: number,
  brushSize = gridBrushRadius(props),
  cap = DEFAULT_CAP,
): number {
  let painted = 0
  for (const cell of gridCellsInBrush(cx, cy, cz, brushSize)) {
    if (paintGridCell(props, cell.x, cell.y, cell.z, cap)) painted++
  }
  return painted
}

export function eraseGridBrush(
  props: FoliageProps,
  cx: number,
  cy: number,
  cz: number,
  brushSize = gridBrushRadius(props),
): number {
  let erased = 0
  for (const cell of gridCellsInBrush(cx, cy, cz, brushSize)) {
    if (eraseGridCell(props, cell.x, cell.y, cell.z)) erased++
  }
  return erased
}

export function paintGridLayerBrush(
  props: FoliageProps,
  layer: number,
  cx: number,
  cy: number,
  cz: number,
  brushSize = gridBrushRadius(props),
  cap = DEFAULT_CAP,
): number {
  let painted = 0
  for (const cell of gridCellsInBrush(cx, cy, cz, brushSize)) {
    if (paintGridLayer(props, layer, cell.x, cell.y, cell.z, cap)) painted++
  }
  return painted
}

export function eraseGridLayerBrush(
  props: FoliageProps,
  layer: number,
  cx: number,
  cy: number,
  cz: number,
  brushSize = gridBrushRadius(props),
): number {
  let erased = 0
  for (const cell of gridCellsInBrush(cx, cy, cz, brushSize)) {
    if (eraseGridLayer(props, layer, cell.x, cell.y, cell.z)) erased++
  }
  return erased
}

export function getGridCellCount(props: FoliageProps): number {
  return props.instances.length
}

/** Overlay extent in world units for a brush radius. */
export function gridOverlaySize(brushSize: number): number {
  const r = Math.max(0, Math.floor(brushSize))
  return Math.max(3, r * 2 + 3)
}

export interface GridPaintSnapshot {
  instances: number[][]
  gridLayers?: Record<number, number[][]>
}

export function snapshotGridPaint(props: FoliageProps): GridPaintSnapshot {
  const gridLayers = props.gridLayers
    ? Object.fromEntries(
        Object.entries(props.gridLayers).map(([k, bucket]) => [Number(k), bucket.map((i) => [...i])]),
      )
    : undefined
  return { instances: props.instances.map((i) => [...i]), gridLayers }
}

export function restoreGridPaint(props: FoliageProps, snap: GridPaintSnapshot): void {
  props.instances = snap.instances.map((i) => [...i])
  if (snap.gridLayers) {
    props.gridLayers = Object.fromEntries(
      Object.entries(snap.gridLayers).map(([k, bucket]) => [Number(k), bucket.map((i) => [...i])]),
    )
  } else {
    delete props.gridLayers
  }
}