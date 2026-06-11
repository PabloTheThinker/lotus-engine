import * as THREE from 'three'
import type { Actor } from './Actor'

/**
 * Gameplay services — timers, HUD, camera shake, view-camera override.
 * All state is per-play-session: reset at beginPlay, cleared at endPlay.
 */

// ---- timers (Godot Timer node) ----
interface Timer {
  at: number
  fn: () => void
  loop: number | null // interval if looping
}
let timers: Timer[] = []
let clock = 0

export function resetGameplay() {
  timers = []
  clock = 0
  shake = null
  viewCameraName = null
  hudClear()
}

export function tickGameplay(dt: number, log: (level: 'log' | 'error', msg: string) => void) {
  clock += dt
  for (let i = timers.length - 1; i >= 0; i--) {
    const t = timers[i]
    if (clock >= t.at) {
      if (t.loop !== null) t.at = clock + t.loop
      else timers.splice(i, 1)
      try {
        t.fn()
      } catch (err) {
        log('error', `timer: ${(err as Error).message}`)
      }
    }
  }
  if (shake && clock > shake.until) shake = null
}

export function setTimer(seconds: number, fn: () => void, loop = false) {
  timers.push({ at: clock + seconds, fn, loop: loop ? seconds : null })
}

// ---- camera shake (UE Camera Shake) ----
let shake: { intensity: number; until: number } | null = null

export function cameraShake(intensity: number, duration: number) {
  shake = { intensity, until: clock + duration }
}

/** apply the current shake to a camera — called by the viewport after pawn update */
export function applyShake(camera: THREE.Camera) {
  if (!shake) return
  const falloff = Math.max(0, (shake.until - clock) / Math.max(0.0001, shake.until - clock + 0.0001))
  const a = shake.intensity * 0.08 * Math.min(1, shake.until - clock + 0.3)
  camera.position.x += (Math.random() - 0.5) * a
  camera.position.y += (Math.random() - 0.5) * a
  camera.rotation.z += (Math.random() - 0.5) * a * 0.15 * falloff
}

// ---- view camera override (CineCamera possession) ----
let viewCameraName: string | null = null
export function setViewCamera(name: string | null) {
  viewCameraName = name
}
export function getViewCamera(): string | null {
  return viewCameraName
}

// ---- HUD (UMG-lite: DOM overlay) ----
let hudRoot: HTMLElement | null = null
export function mountHud(parent: HTMLElement) {
  hudRoot = document.createElement('div')
  hudRoot.className = 'game-hud'
  parent.appendChild(hudRoot)
}
export function unmountHud() {
  hudRoot?.remove()
  hudRoot = null
}

function hudEl(id: string, kind: string): HTMLElement {
  let el = hudRoot?.querySelector<HTMLElement>(`[data-hud="${id}"]`) ?? null
  if (!el && hudRoot) {
    el = document.createElement('div')
    el.dataset.hud = id
    el.dataset.kind = kind
    hudRoot.appendChild(el)
  }
  return el!
}

export interface HudOpts {
  x?: number | string
  y?: number | string
  size?: number
  color?: string
  anchor?: 'tl' | 'tr' | 'bl' | 'br' | 'center'
}

function place(el: HTMLElement, opts: HudOpts = {}) {
  const anchor = opts.anchor ?? 'tl'
  el.style.position = 'absolute'
  const x = typeof opts.x === 'number' ? `${opts.x}px` : (opts.x ?? '16px')
  const y = typeof opts.y === 'number' ? `${opts.y}px` : (opts.y ?? '16px')
  el.style.left = el.style.right = el.style.top = el.style.bottom = ''
  el.style.transform = ''
  if (anchor === 'center') {
    el.style.left = '50%'
    el.style.top = y
    el.style.transform = 'translateX(-50%)'
  } else {
    if (anchor.includes('l')) el.style.left = x
    else el.style.right = x
    if (anchor.includes('t')) el.style.top = y
    else el.style.bottom = y
  }
}

export const hud = {
  text(id: string, text: string, opts: HudOpts = {}) {
    if (!hudRoot) return
    const el = hudEl(id, 'text')
    el.textContent = text
    el.style.font = `600 ${opts.size ?? 16}px system-ui, sans-serif`
    el.style.color = opts.color ?? '#fff'
    el.style.textShadow = '0 1px 3px rgba(0,0,0,.8)'
    place(el, opts)
  },
  bar(id: string, fraction: number, opts: HudOpts = {}) {
    if (!hudRoot) return
    const el = hudEl(id, 'bar')
    el.style.width = '180px'
    el.style.height = '14px'
    el.style.background = 'rgba(13,15,18,.65)'
    el.style.border = '1px solid rgba(255,255,255,.25)'
    el.style.borderRadius = '4px'
    place(el, opts)
    let fill = el.firstElementChild as HTMLElement | null
    if (!fill) {
      fill = document.createElement('div')
      fill.style.height = '100%'
      fill.style.borderRadius = '3px'
      el.appendChild(fill)
    }
    fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`
    fill.style.background = opts.color ?? '#46a758'
  },
  remove(id: string) {
    hudRoot?.querySelector(`[data-hud="${id}"]`)?.remove()
  },
  clear() {
    hudClear()
  },
}

function hudClear() {
  if (hudRoot) hudRoot.innerHTML = ''
}

// ---- EQS-lite (UE Environment Query System) ----
export interface EQSOpts {
  around: [number, number, number]
  radius?: number
  count?: number
  scoreBy?: 'farFromPlayer' | 'nearPlayer' | 'nearPoint'
  point?: [number, number, number]
}

/** generate ring points around a location, score them, return the best */
export function queryBestPoint(
  pawn: () => THREE.Vector3 | null,
  opts: EQSOpts,
): [number, number, number] | null {
  const radius = opts.radius ?? 6
  const count = Math.max(4, opts.count ?? 12)
  const p = pawn()
  let best: [number, number, number] | null = null
  let bestScore = -Infinity
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    const x = opts.around[0] + Math.cos(a) * radius
    const z = opts.around[2] + Math.sin(a) * radius
    let score = 0
    if (opts.scoreBy === 'farFromPlayer' && p) score = Math.hypot(x - p.x, z - p.z)
    else if (opts.scoreBy === 'nearPlayer' && p) score = -Math.hypot(x - p.x, z - p.z)
    else if (opts.scoreBy === 'nearPoint' && opts.point) score = -Math.hypot(x - opts.point[0], z - opts.point[2])
    else score = Math.random()
    if (score > bestScore) {
      bestScore = score
      best = [x, opts.around[1], z]
    }
  }
  return best
}

// ---- AI perception (UE sight sense) ----
export function canSeePoint(
  actors: Map<string, import('./Actor').Actor>,
  from: import('./Actor').Actor,
  target: THREE.Vector3,
  fovDeg = 90,
  maxDist = 20,
): boolean {
  const origin = new THREE.Vector3()
  from.root.getWorldPosition(origin)
  origin.y += 1
  const to = target.clone().sub(origin)
  const dist = to.length()
  if (dist > maxDist) return false
  // facing check against the actor's -Z forward
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(from.root.quaternion)
  const angle = forward.angleTo(to.clone().normalize())
  if (angle > THREE.MathUtils.degToRad(fovDeg / 2)) return false
  // occlusion
  const hit = raycastActors(actors, [origin.x, origin.y, origin.z], [to.x, to.y, to.z], dist - 0.6)
  return !hit || hit.actor === from
}

// ---- raycast helper (Godot RayCast3D) ----
const _ray = new THREE.Raycaster()
export function raycastActors(
  actors: Map<string, Actor>,
  origin: [number, number, number],
  dir: [number, number, number],
  maxDist = 1000,
): { point: [number, number, number]; actor: Actor; distance: number } | null {
  _ray.set(new THREE.Vector3(...origin), new THREE.Vector3(...dir).normalize())
  _ray.far = maxDist
  const meshes: THREE.Object3D[] = []
  for (const a of actors.values()) {
    a.root.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.isHelper && !o.userData.isEditorOnly) meshes.push(o)
    })
  }
  for (const hit of _ray.intersectObjects(meshes, false)) {
    let cur: THREE.Object3D | null = hit.object
    while (cur) {
      const id = cur.userData.actorId as string | undefined
      if (id && actors.has(id)) {
        return { point: [hit.point.x, hit.point.y, hit.point.z], actor: actors.get(id)!, distance: hit.distance }
      }
      cur = cur.parent
    }
  }
  return null
}
