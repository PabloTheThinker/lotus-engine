import type { FoliageProps } from './types'

/**
 * GridMap — Godot GridMap-style integer cell painting on foliage layers (snap mode).
 * Instances are packed [x, y, z, scale, rotY] with y centered at cell.y + 0.5.
 */

export const GRID_TILE_KINDS = ['box', 'sphere', 'plane'] as const
export type GridTileKind = (typeof GRID_TILE_KINDS)[number]

export interface GridCell {
  x: number
  y: number
  z: number
}

const CELL_Y_TOL = 0.6
const DEFAULT_CAP = 4000

export function worldToGridCell(x: number, y: number, z: number): GridCell {
  return { x: Math.round(x), y: Math.round(y), z: Math.round(z) }
}

export function gridCellKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`
}

function findGridCellIndex(props: FoliageProps, cx: number, cy: number, cz: number): number {
  return props.instances.findIndex(
    ([x, y, z]) => x === cx && Math.abs(y - (cy + 0.5)) < CELL_Y_TOL && z === cz,
  )
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

export function getGridCellCount(props: FoliageProps): number {
  return props.instances.length
}

/** Overlay extent in world units for a brush radius. */
export function gridOverlaySize(brushSize: number): number {
  const r = Math.max(0, Math.floor(brushSize))
  return Math.max(3, r * 2 + 3)
}