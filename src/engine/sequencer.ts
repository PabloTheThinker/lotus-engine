import * as THREE from 'three'
import type { World } from './World'

/**
 * Sequencer — the UE Sequencer / Godot AnimationPlayer analog (v1).
 * One master sequence per level: transform tracks with linearly
 * interpolated keys, sampled onto actors by the editor (scrub/play)
 * and by Play mode when autoPlay is set.
 */

export type SeqProperty =
  | 'position'
  | 'rotation'
  | 'scale'
  | 'visible'
  | 'color'
  | 'opacity'
  | 'emissiveIntensity'
  | 'intensity'
  | 'fov'

export type SeqInterp = 'linear' | 'smooth' | 'step'

export interface SeqKey {
  t: number
  v: number[] | number | boolean | string
  interp?: SeqInterp
}

export interface SeqTrack {
  actorId: string
  property: SeqProperty
  keys: SeqKey[]
}

export interface SeqCameraCut {
  t: number
  cameraName: string
}

export interface SeqEvent {
  t: number
  signal: string
}

export interface Sequence {
  duration: number
  autoPlay: boolean
  tracks: SeqTrack[]
  cameraCuts?: SeqCameraCut[]
  events?: SeqEvent[]
}

export function emptySequence(): Sequence {
  return { duration: 10, autoPlay: false, tracks: [], cameraCuts: [], events: [] }
}

/** which extra properties are keyable on an actor */
export function keyableProperties(actor: { mesh?: unknown; light?: unknown; camera?: unknown; materialProps?: unknown }): SeqProperty[] {
  const out: SeqProperty[] = ['visible']
  if (actor.materialProps) out.push('color', 'opacity', 'emissiveIntensity')
  if (actor.light) out.push('intensity', 'color')
  if (actor.camera) out.push('fov')
  return [...new Set(out)]
}

export function findTrack(seq: Sequence, actorId: string, property: SeqProperty): SeqTrack | undefined {
  return seq.tracks.find((tr) => tr.actorId === actorId && tr.property === property)
}

/** insert or replace a key (keys stay sorted by t) */
export function setKey(seq: Sequence, actorId: string, property: SeqProperty, t: number, v: SeqKey['v']) {
  let track = findTrack(seq, actorId, property)
  if (!track) {
    track = { actorId, property, keys: [] }
    seq.tracks.push(track)
  }
  const clone = Array.isArray(v) ? [...v] : v
  const existing = track.keys.find((k) => Math.abs(k.t - t) < 0.011)
  if (existing) existing.v = clone
  else {
    track.keys.push({ t, v: clone })
    track.keys.sort((a, b) => a.t - b.t)
  }
}

const _ca = new THREE.Color()
const _cb = new THREE.Color()

function lerpValue(a: SeqKey['v'], b: SeqKey['v'], f: number): SeqKey['v'] {
  if (typeof a === 'boolean') return a // step only
  if (typeof a === 'string' && typeof b === 'string') {
    _ca.set(a)
    _cb.set(b)
    return `#${_ca.lerp(_cb, f).getHexString()}`
  }
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * f
  if (Array.isArray(a) && Array.isArray(b)) return a.map((av, i) => av + ((b[i] ?? av) - av) * f)
  return a
}

function sampleTrack(track: SeqTrack, t: number): SeqKey['v'] | null {
  const keys = track.keys
  if (keys.length === 0) return null
  if (t <= keys[0].t) return keys[0].v
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t >= a.t && t <= b.t) {
      let f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
      const interp = a.interp ?? 'linear'
      if (interp === 'step') f = 0
      else if (interp === 'smooth') f = f * f * (3 - 2 * f)
      return lerpValue(a.v, b.v, f)
    }
  }
  return null
}

/** apply the sequence at time t to the world's actors */
export function sampleSequence(world: World, seq: Sequence, t: number) {
  for (const track of seq.tracks) {
    const actor = world.actors.get(track.actorId)
    if (!actor) continue
    const v = sampleTrack(track, t)
    if (v === null) continue
    switch (track.property) {
      case 'position':
        if (Array.isArray(v)) actor.root.position.set(v[0], v[1], v[2])
        break
      case 'rotation':
        if (Array.isArray(v)) actor.root.rotation.set(v[0], v[1], v[2])
        break
      case 'scale':
        if (Array.isArray(v)) actor.root.scale.set(v[0], v[1], v[2])
        break
      case 'visible':
        actor.root.visible = Boolean(v) && actor.visible
        break
      case 'color': {
        const mat = actor.mesh?.material as THREE.MeshStandardMaterial | undefined
        if (typeof v === 'string') {
          if (mat?.color && actor.materialProps) mat.color.set(v)
          else actor.light?.color.set(v)
        }
        break
      }
      case 'opacity': {
        const mat = actor.mesh?.material as THREE.MeshStandardMaterial | undefined
        if (mat && typeof v === 'number') {
          mat.opacity = v
          mat.transparent = v < 1
        }
        break
      }
      case 'emissiveIntensity': {
        const mat = actor.mesh?.material as THREE.MeshStandardMaterial | undefined
        if (mat && typeof v === 'number') mat.emissiveIntensity = v
        break
      }
      case 'intensity':
        if (actor.light && typeof v === 'number') actor.light.intensity = v
        break
      case 'fov':
        if (actor.camera && typeof v === 'number') {
          actor.camera.fov = v
          actor.camera.updateProjectionMatrix()
        }
        break
    }
  }
}

/** active camera cut at time t (PIE: routed through setViewCamera) */
export function cameraCutAt(seq: Sequence, t: number): string | null {
  let current: string | null = null
  for (const cut of seq.cameraCuts ?? []) {
    if (cut.t <= t) current = cut.cameraName
  }
  return current
}

/** events crossed between prevT and t (handles loop wrap) */
export function eventsBetween(seq: Sequence, prevT: number, t: number): SeqEvent[] {
  const evs = seq.events ?? []
  if (t >= prevT) return evs.filter((e) => e.t > prevT && e.t <= t)
  // looped
  return evs.filter((e) => e.t > prevT || e.t <= t)
}
