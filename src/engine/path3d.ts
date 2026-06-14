import * as THREE from 'three'
import type { Actor } from './Actor'
import type { Path3DProps } from './types'

/** Build a Catmull-Rom curve from local-space waypoints. */
export function buildPathCurve(
  waypoints: [number, number, number][],
  closed: boolean,
): THREE.CatmullRomCurve3 | null {
  if (waypoints.length < 2) return null
  const pts = waypoints.map((w) => new THREE.Vector3(...w))
  return new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.5)
}

/** Sample position at normalized progress 0–1 along the path. */
export function samplePathAt(
  waypoints: [number, number, number][],
  closed: boolean,
  t: number,
): THREE.Vector3 | null {
  const curve = buildPathCurve(waypoints, closed)
  if (!curve) return waypoints[0] ? new THREE.Vector3(...waypoints[0]) : null
  return curve.getPointAt(THREE.MathUtils.clamp(t, 0, 1))
}

/** Rebuild editor wireframe line + waypoint handles for a Path3D actor. */
export function rebuildPath3DVisual(actor: Actor) {
  const props = actor.path3DProps
  if (!props) return
  actor.root.children
    .filter((c) => c.userData.isPath3DHelper)
    .forEach((c) => {
      actor.root.remove(c)
      if ((c as THREE.Line).geometry) (c as THREE.Line).geometry.dispose()
      if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry.dispose()
    })
  const curve = buildPathCurve(props.waypoints, props.closed)
  if (curve) {
    const geom = new THREE.BufferGeometry().setFromPoints(curve.getPoints(Math.max(16, props.waypoints.length * 8)))
    const line = new THREE.Line(
      geom,
      new THREE.LineBasicMaterial({ color: 0xf5a623, transparent: true, opacity: 0.85 }),
    )
    line.userData.isPath3DHelper = true
    line.userData.isHelper = true
    actor.root.add(line)
  }
  for (const w of props.waypoints) {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xf5a623, wireframe: true }),
    )
    dot.position.set(w[0], w[1], w[2])
    dot.userData.isPath3DHelper = true
    dot.userData.isHelper = true
    actor.root.add(dot)
  }
}

export const DEFAULT_PATH3D: Path3DProps = {
  waypoints: [
    [0, 0, 0],
    [2, 0, 0],
    [2, 0, -2],
    [0, 0, -2],
  ],
  closed: false,
}