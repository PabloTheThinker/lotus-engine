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

/** Packed grid cell on a TileMap layer — [x, y, z, scale, rotY, kindIdx?]. */
export type GridLayerCell = [x: number, y: number, z: number, scale: number, rotY: number, kindIdx?: number]

export const GRID_TILE_KIND_INDEX: Record<GridTileKind, number> = { box: 0, sphere: 1, plane: 2 }

export type AutotileCorner =
  | 'none'
  | 'inner-ne'
  | 'inner-se'
  | 'inner-sw'
  | 'inner-nw'
  | 'outer-ne'
  | 'outer-se'
  | 'outer-sw'
  | 'outer-nw'

export interface AutotileRule {
  mask: number
  extendedMask: number
  tileKind: GridTileKind
  resolvedKind: GridTileKind
  corner: AutotileCorner
  rotY: number
}

const CARDINAL_BITS = [1, 2, 4, 8] as const
const DIAG_BITS = [16, 32, 64, 128] as const
const CARDINAL_DELTAS: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
]
const DIAG_DELTAS: [number, number][] = [
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
]

const CORNER_ROT_Y: Record<AutotileCorner, number> = {
  none: 0,
  'inner-ne': 0,
  'inner-se': Math.PI / 2,
  'inner-sw': Math.PI,
  'inner-nw': -Math.PI / 2,
  'outer-ne': Math.PI / 4,
  'outer-se': (3 * Math.PI) / 4,
  'outer-sw': (-3 * Math.PI) / 4,
  'outer-nw': -Math.PI / 4,
}

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

export function gridCellKindIndex(cell: GridLayerCell, fallback: GridTileKind = 'box'): number {
  const idx = cell[5]
  if (typeof idx === 'number' && idx >= 0 && idx < GRID_TILE_KINDS.length) return idx
  return GRID_TILE_KIND_INDEX[fallback]
}

export function gridCellKind(cell: GridLayerCell, fallback: GridTileKind = 'box'): GridTileKind {
  return GRID_TILE_KINDS[gridCellKindIndex(cell, fallback)] ?? fallback
}

export function withGridCellKind(cell: GridLayerCell, kind: GridTileKind): GridLayerCell {
  const next = [...cell] as GridLayerCell
  while (next.length < 6) next.push(0)
  next[5] = GRID_TILE_KIND_INDEX[kind]
  return next
}

function autotileMaskForBucket(bucket: number[][], cx: number, cy: number, cz: number): number {
  return autotileNeighbors(
    hasLayerNeighbor(bucket, cx, cy, cz, 0, -1),
    hasLayerNeighbor(bucket, cx, cy, cz, 1, 0),
    hasLayerNeighbor(bucket, cx, cy, cz, 0, 1),
    hasLayerNeighbor(bucket, cx, cy, cz, -1, 0),
  )
}

function autotileExtendedMaskForBucket(bucket: number[][], cx: number, cy: number, cz: number): number {
  const cardinals = CARDINAL_DELTAS.map(([dx, dz]) => hasLayerNeighbor(bucket, cx, cy, cz, dx, dz))
  const diagonals = DIAG_DELTAS.map(([dx, dz]) => hasLayerNeighbor(bucket, cx, cy, cz, dx, dz))
  return autotileExtendedMask(
    cardinals[0],
    cardinals[1],
    cardinals[2],
    cardinals[3],
    diagonals[0],
    diagonals[1],
    diagonals[2],
    diagonals[3],
  )
}

export function gridNeighborKinds(
  bucket: number[][],
  cx: number,
  cy: number,
  cz: number,
  fallback: GridTileKind,
): (GridTileKind | null)[] {
  return CARDINAL_DELTAS.map(([dx, dz]) => {
    const at = findGridCellIndexIn(bucket, cx + dx, cy, cz + dz)
    if (at < 0) return null
    return gridCellKind(bucket[at] as GridLayerCell, fallback)
  })
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
  return autotileMaskForBucket(bucket, cx, cy, cz)
}

/** 8-neighbor autotile mask (cardinals + diagonals) on a layer. */
export function previewAutotileExtendedMask(
  props: FoliageProps,
  layer: number,
  cx: number,
  cy: number,
  cz: number,
): number {
  const bucket = layerBucket(props, layer)
  return autotileExtendedMaskForBucket(bucket, cx, cy, cz)
}

export function previewAutotileCorner(
  props: FoliageProps,
  layer: number,
  cx: number,
  cy: number,
  cz: number,
): AutotileCorner {
  const bucket = layerBucket(props, layer)
  const mask = autotileMaskForBucket(bucket, cx, cy, cz)
  const extended = autotileExtendedMaskForBucket(bucket, cx, cy, cz)
  return resolveAutotileCorner(mask, extended)
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

/** 8-neighbor bitmask: N=1, E=2, S=4, W=8, NE=16, SE=32, SW=64, NW=128. */
export function autotileExtendedMask(
  hasN: boolean,
  hasE: boolean,
  hasS: boolean,
  hasW: boolean,
  hasNE: boolean,
  hasSE: boolean,
  hasSW: boolean,
  hasNW: boolean,
): number {
  return (
    autotileNeighbors(hasN, hasE, hasS, hasW) |
    (hasNE ? DIAG_BITS[0] : 0) |
    (hasSE ? DIAG_BITS[1] : 0) |
    (hasSW ? DIAG_BITS[2] : 0) |
    (hasNW ? DIAG_BITS[3] : 0)
  )
}

/** Inner/outer corner detection from cardinal + extended masks. */
export function resolveAutotileCorner(cardinalMask: number, extendedMask: number): AutotileCorner {
  const hasN = (cardinalMask & CARDINAL_BITS[0]) !== 0
  const hasE = (cardinalMask & CARDINAL_BITS[1]) !== 0
  const hasS = (cardinalMask & CARDINAL_BITS[2]) !== 0
  const hasW = (cardinalMask & CARDINAL_BITS[3]) !== 0
  const hasNE = (extendedMask & DIAG_BITS[0]) !== 0
  const hasSE = (extendedMask & DIAG_BITS[1]) !== 0
  const hasSW = (extendedMask & DIAG_BITS[2]) !== 0
  const hasNW = (extendedMask & DIAG_BITS[3]) !== 0

  if (hasN && hasE && !hasNE) return 'inner-ne'
  if (hasE && hasS && !hasSE) return 'inner-se'
  if (hasS && hasW && !hasSW) return 'inner-sw'
  if (hasN && hasW && !hasNW) return 'inner-nw'
  if (!hasN && !hasE && hasNE) return 'outer-ne'
  if (!hasE && !hasS && hasSE) return 'outer-se'
  if (!hasS && !hasW && hasSW) return 'outer-sw'
  if (!hasN && !hasW && hasNW) return 'outer-nw'
  return 'none'
}

/** Majority vote among cardinal neighbor tile kinds (null = missing). */
export function resolveAutotileKind(
  cardinalMask: number,
  neighborKinds: (GridTileKind | null)[],
  baseKind: GridTileKind,
): GridTileKind {
  const votes = new Map<GridTileKind, number>()
  for (let i = 0; i < 4; i++) {
    if ((cardinalMask & CARDINAL_BITS[i]) === 0) continue
    const kind = neighborKinds[i]
    if (!kind) continue
    votes.set(kind, (votes.get(kind) ?? 0) + 1)
  }
  if (votes.size === 0) return baseKind
  let best = baseKind
  let bestCount = -1
  for (const [kind, count] of votes) {
    if (count > bestCount) {
      best = kind
      bestCount = count
    }
  }
  return best
}

/** Map bitmask + tile kind to resolved kind, corner sprite, and rotation. */
export function autotileRuleForMask(
  mask: number,
  tileKind: GridTileKind,
  extendedMask?: number,
  neighborKinds?: (GridTileKind | null)[],
): AutotileRule {
  const ext = extendedMask ?? mask
  const corner = resolveAutotileCorner(mask, ext)
  const matchedKind = neighborKinds ? resolveAutotileKind(mask, neighborKinds, tileKind) : tileKind
  let resolvedKind = matchedKind
  let rotY = 0

  if (corner !== 'none') {
    if (corner.startsWith('inner')) {
      resolvedKind = 'plane'
      rotY = CORNER_ROT_Y[corner]
    } else {
      resolvedKind = 'sphere'
      rotY = CORNER_ROT_Y[corner]
    }
  } else if (mask === 0) {
    resolvedKind = 'box'
  } else if (mask === 15) {
    resolvedKind = matchedKind
  } else {
    resolvedKind = 'sphere'
    rotY = (mask * Math.PI) / 8
  }

  return { mask, extendedMask: ext, tileKind, resolvedKind, corner, rotY }
}

export function autotileRuleAtCell(
  props: FoliageProps,
  layer: number,
  cx: number,
  cy: number,
  cz: number,
  fallbackKind: GridTileKind = 'box',
): AutotileRule {
  const bucket = layerBucket(props, layer)
  const at = findGridCellIndexIn(bucket, cx, cy, cz)
  const baseKind = at >= 0 ? gridCellKind(bucket[at] as GridLayerCell, fallbackKind) : fallbackKind
  const mask = autotileMaskForBucket(bucket, cx, cy, cz)
  const extended = autotileExtendedMaskForBucket(bucket, cx, cy, cz)
  const neighborKinds = gridNeighborKinds(bucket, cx, cy, cz, fallbackKind)
  return autotileRuleForMask(mask, baseKind, extended, neighborKinds)
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

function applyAutotileRulesAt(
  bucket: number[][],
  cx: number,
  cy: number,
  cz: number,
  fallbackKind: GridTileKind,
): void {
  const at = findGridCellIndexIn(bucket, cx, cy, cz)
  if (at < 0) return
  const cell = bucket[at] as GridLayerCell
  const baseKind = gridCellKind(cell, fallbackKind)
  const mask = autotileMaskForBucket(bucket, cx, cy, cz)
  const extended = autotileExtendedMaskForBucket(bucket, cx, cy, cz)
  const neighborKinds = gridNeighborKinds(bucket, cx, cy, cz, fallbackKind)
  const rule = autotileRuleForMask(mask, baseKind, extended, neighborKinds)
  bucket[at][4] = rule.rotY
}

function refreshAutotileRulesAt(
  props: FoliageProps,
  layer: number,
  cx: number,
  cy: number,
  cz: number,
): void {
  const bucket = layerBucket(props, layer)
  const fallback = (props.geometry as GridTileKind) ?? 'box'
  const cells: [number, number, number][] = [
    [cx, cy, cz],
    [cx, cy, cz - 1],
    [cx + 1, cy, cz],
    [cx, cy, cz + 1],
    [cx - 1, cy, cz],
    [cx + 1, cy, cz - 1],
    [cx + 1, cy, cz + 1],
    [cx - 1, cy, cz + 1],
    [cx - 1, cy, cz - 1],
  ]
  for (const [x, y, z] of cells) applyAutotileRulesAt(bucket, x, y, z, fallback)
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
  const paintKind = GRID_TILE_KINDS.includes(props.geometry as GridTileKind)
    ? (props.geometry as GridTileKind)
    : 'box'
  bucket.push([cx, cy + 0.5, cz, 1, 0, GRID_TILE_KIND_INDEX[paintKind]])
  if (props.gridAutotileRules) refreshAutotileRulesAt(props, layer, cx, cy, cz)
  else if (props.gridAutotile) refreshAutotileAt(props, layer, cx, cy, cz)
  syncGridInstancesFromLayers(props)
  return true
}

export function eraseGridLayer(props: FoliageProps, layer: number, cx: number, cy: number, cz: number): boolean {
  const bucket = layerBucket(props, layer)
  const at = findGridCellIndexIn(bucket, cx, cy, cz)
  if (at < 0) return false
  bucket.splice(at, 1)
  if (props.gridAutotileRules) refreshAutotileRulesAt(props, layer, cx, cy, cz)
  else if (props.gridAutotile) refreshAutotileAt(props, layer, cx, cy, cz)
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