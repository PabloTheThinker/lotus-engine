/** Wave 86 (v4.69–v4.73) — Grid nav path debug: find + polyline overlay on baked layers. */

import * as THREE from 'three'
import type { Actor } from './Actor'
import {
  bakeGridNavLayer,
  clampGridNavLayer,
  computeGridNavLayerPath,
  isGridNavLayerReady,
  snapGridNavPoint,
} from './gridNavAgents'

const PATH_DEBUG_COLOR = 0x46d160

let lastPolyline: [number, number, number][] | null = null
let lastLayer: number | null = null
let debugVisible = false
let debugLine: THREE.Line | null = null

function disposeDebugLine() {
  if (!debugLine) return
  debugLine.removeFromParent()
  debugLine.geometry.dispose()
  ;(debugLine.material as THREE.Material).dispose()
  debugLine = null
}

function rebuildDebugLine(points: [number, number, number][]) {
  disposeDebugLine()
  if (points.length < 2) return null
  const verts = points.flat()
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  debugLine = new THREE.Line(
    geom,
    new THREE.LineBasicMaterial({ color: PATH_DEBUG_COLOR, transparent: true, opacity: 0.9 }),
  )
  debugLine.userData.isHelper = true
  debugLine.userData.isGridNavPathDebug = true
  debugLine.visible = debugVisible
  return debugLine
}

export function resetGridNavPathDebug() {
  lastPolyline = null
  lastLayer = null
  debugVisible = false
  disposeDebugLine()
}

export function gridNavPathClear() {
  lastPolyline = null
  lastLayer = null
  disposeDebugLine()
}

export function gridNavPathLastPolyline(): [number, number, number][] | null {
  return lastPolyline ? lastPolyline.map((p) => [p[0], p[1], p[2]] as [number, number, number]) : null
}

export function gridNavPathLastLayer(): number | null {
  return lastLayer
}

export function gridNavPathShowDebug(show: boolean) {
  debugVisible = show
  if (debugLine) debugLine.visible = show
}

export function gridNavPathDebugVisible(): boolean {
  return debugVisible
}

/** Editor-only hook: current debug line overlay (null when hidden or empty). */
export function gridNavPathDebugOverlay(): THREE.Line | null {
  if (!debugVisible || !debugLine || !lastPolyline || lastPolyline.length < 2) return null
  return debugLine
}

/** Attach or detach the debug polyline in the editor scene. */
export function syncGridNavPathDebugOverlay(scene: THREE.Scene) {
  const line = gridNavPathDebugOverlay()
  if (!line) {
    if (debugLine?.parent) debugLine.removeFromParent()
    return
  }
  if (line.parent !== scene) {
    line.removeFromParent()
    scene.add(line)
  }
}

export async function gridNavPathFind(
  actors: Map<string, Actor>,
  layer: number,
  from: [number, number, number],
  to: [number, number, number],
): Promise<[number, number, number][] | null> {
  const L = clampGridNavLayer(layer)
  const baked = await bakeGridNavLayer(actors, L)
  if (!baked || !isGridNavLayerReady(L)) return null

  const snappedFrom = snapGridNavPoint(L, from)
  const snappedTo = snapGridNavPoint(L, to)
  const path = computeGridNavLayerPath(L, snappedFrom, snappedTo)
  if (!path) {
    lastPolyline = null
    lastLayer = L
    disposeDebugLine()
    return null
  }

  const polyline = path.map((p) => snapGridNavPoint(L, p))
  lastPolyline = polyline
  lastLayer = L
  rebuildDebugLine(polyline)
  return polyline
}