import * as THREE from 'three'
import { getSoundBuffer, playSound, stopScrubAudio } from './audio'
import { applyHudCssProperty } from './gameplay'
import type { HudWidget, SeqHudProperty } from './types'
import type { World } from './World'

/**
 * Sequencer — the UE Sequencer / Godot AnimationPlayer analog (v1).
 * One master sequence per level: transform tracks with interpolated
 * keys (linear, smooth, step, cubic bezier), sampled onto actors by
 * the editor (scrub/play) and by Play mode when autoPlay is set.
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

export type { SeqHudProperty } from './types'
export type SeqInterp = 'linear' | 'smooth' | 'step' | 'bezier'

/** Cubic-bezier tangent handle offset from key (time, value). */
export interface SeqTangent {
  dt: number
  dv: number | number[]
}

export interface SeqKey {
  t: number
  v: number[] | number | boolean | string
  interp?: SeqInterp
  tangentIn?: SeqTangent
  tangentOut?: SeqTangent
}

export type SeqAudioProperty = 'volume'

export interface SeqTrack {
  /** 'hud' for DOM widget tracks; 'audio' for imported sound clips; omitted or 'actor' for scene actors */
  trackType?: 'actor' | 'hud' | 'audio'
  actorId: string
  property: SeqProperty | SeqHudProperty | SeqAudioProperty
  keys: SeqKey[]
  /** audio only — loop region start in seconds within the clip buffer */
  loopIn?: number
  /** audio only — loop region end in seconds within the clip buffer */
  loopOut?: number
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
export const HUD_PROPERTIES: SeqHudProperty[] = ['opacity', 'left', 'top', 'width', 'color']

export function isHudTrack(track: SeqTrack): boolean {
  return track.trackType === 'hud'
}

export function isAudioTrack(track: SeqTrack): boolean {
  return track.trackType === 'audio'
}

export function hasHudTracks(seq: Sequence): boolean {
  return seq.tracks.some(isHudTrack)
}

export function hasAudioTracks(seq: Sequence): boolean {
  return seq.tracks.some(isAudioTrack)
}

export function keyableProperties(actor: { mesh?: unknown; light?: unknown; camera?: unknown; materialProps?: unknown }): SeqProperty[] {
  const out: SeqProperty[] = ['visible']
  if (actor.materialProps) out.push('color', 'opacity', 'emissiveIntensity')
  if (actor.light) out.push('intensity', 'color')
  if (actor.camera) out.push('fov')
  return [...new Set(out)]
}

/** which CSS properties are keyable on a HUD widget */
export function keyableHudProperties(_widget: HudWidget): SeqHudProperty[] {
  return HUD_PROPERTIES
}

export function findTrack(
  seq: Sequence,
  id: string,
  property: SeqProperty | SeqHudProperty | SeqAudioProperty,
  trackType: 'actor' | 'hud' | 'audio' = 'actor',
): SeqTrack | undefined {
  return seq.tracks.find((tr) => (tr.trackType ?? 'actor') === trackType && tr.actorId === id && tr.property === property)
}

/** insert or replace a key (keys stay sorted by t) */
export function setKey(
  seq: Sequence,
  id: string,
  property: SeqProperty | SeqHudProperty | SeqAudioProperty,
  t: number,
  v: SeqKey['v'],
  trackType: 'actor' | 'hud' | 'audio' = 'actor',
) {
  let track = findTrack(seq, id, property, trackType)
  if (!track) {
    track = { trackType, actorId: id, property, keys: [] }
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

/** Read one channel from a key value (for the curve graph). */
export function keyChannelValue(v: SeqKey['v'], ch = 0): number {
  if (typeof v === 'number') return v
  if (Array.isArray(v)) return v[ch] ?? 0
  if (typeof v === 'boolean') return v ? 1 : 0
  return 0
}

/** Write one channel back into a key value. */
export function setKeyChannelValue(v: SeqKey['v'], ch: number, n: number): SeqKey['v'] {
  if (typeof v === 'number') return n
  if (Array.isArray(v)) {
    const out = [...v]
    out[ch] = n
    return out
  }
  return v
}

function valueDelta(a: SeqKey['v'], b: SeqKey['v'], f: number): number | number[] {
  if (typeof a === 'number' && typeof b === 'number') return (b - a) * f
  if (Array.isArray(a) && Array.isArray(b)) return a.map((av, i) => ((b[i] ?? av) - av) * f)
  return 0
}

export function defaultTangentOut(a: SeqKey, b: SeqKey): SeqTangent {
  const seg = Math.max(0.001, b.t - a.t)
  return { dt: seg / 3, dv: valueDelta(a.v, b.v, 1 / 3) }
}

export function defaultTangentIn(a: SeqKey, b: SeqKey): SeqTangent {
  const seg = Math.max(0.001, b.t - a.t)
  return { dt: -seg / 3, dv: valueDelta(a.v, b.v, -1 / 3) }
}

/** Ensure default tangent handles exist when a key uses bezier interp. */
export function ensureBezierTangents(keys: SeqKey[], index: number) {
  const k = keys[index]
  const prev = keys[index - 1]
  const next = keys[index + 1]
  if (k.interp === 'bezier') {
    if (next && !k.tangentOut) k.tangentOut = defaultTangentOut(k, next)
    if (prev && !k.tangentIn) k.tangentIn = defaultTangentIn(prev, k)
  }
  if (next?.interp === 'bezier' && !next.tangentIn) {
    next.tangentIn = defaultTangentIn(k, next)
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

function cubic1D(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const m = 1 - u
  return m * m * m * p0 + 3 * m * m * u * p1 + 3 * m * u * u * p2 + u * u * u * p3
}

function bezierUForTime(t0: number, t1: number, t2: number, t3: number, t: number): number {
  if (t <= t0) return 0
  if (t >= t3) return 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) * 0.5
    if (cubic1D(t0, t1, t2, t3, mid) < t) lo = mid
    else hi = mid
  }
  return (lo + hi) * 0.5
}

function bezierValue(v0: SeqKey['v'], v3: SeqKey['v'], outDv: SeqTangent['dv'], inDv: SeqTangent['dv'], u: number): SeqKey['v'] {
  if (typeof v0 === 'number' && typeof v3 === 'number') {
    const p1 = v0 + (typeof outDv === 'number' ? outDv : 0)
    const p2 = v3 + (typeof inDv === 'number' ? inDv : 0)
    return cubic1D(v0, p1, p2, v3, u)
  }
  if (Array.isArray(v0) && Array.isArray(v3)) {
    const odv = Array.isArray(outDv) ? outDv : []
    const idv = Array.isArray(inDv) ? inDv : []
    return v0.map((c0, i) => {
      const c3 = v3[i] ?? c0
      const p1 = c0 + (odv[i] ?? 0)
      const p2 = c3 + (idv[i] ?? 0)
      return cubic1D(c0, p1, p2, c3, u)
    })
  }
  return lerpValue(v0, v3, u)
}

function bezierInterp(a: SeqKey, b: SeqKey, t: number): SeqKey['v'] {
  const out = a.tangentOut ?? defaultTangentOut(a, b)
  const inn = b.tangentIn ?? defaultTangentIn(a, b)
  const t0 = a.t
  const t1 = a.t + out.dt
  const t2 = b.t + inn.dt
  const t3 = b.t
  const u = bezierUForTime(t0, t1, t2, t3, t)
  return bezierValue(a.v, b.v, out.dv, inn.dv, u)
}

export function sampleTrack(track: SeqTrack, t: number): SeqKey['v'] | null {
  const keys = track.keys
  if (keys.length === 0) return null
  if (t <= keys[0].t) return keys[0].v
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t >= a.t && t <= b.t) {
      const interp = a.interp ?? 'linear'
      if (interp === 'bezier') return bezierInterp(a, b, t)
      let f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
      if (interp === 'step') f = 0
      else if (interp === 'smooth') f = f * f * (3 - 2 * f)
      return lerpValue(a.v, b.v, f)
    }
  }
  return null
}

/** Resolved loop region for an audio clip (seconds within the buffer). */
export function audioLoopRegion(track: SeqTrack, bufferDuration: number): { loopIn: number; loopOut: number } | null {
  const { loopIn, loopOut } = track
  if (loopIn == null || loopOut == null) return null
  const inClamped = Math.max(0, Math.min(loopIn, bufferDuration))
  const outClamped = Math.max(inClamped + 0.001, Math.min(loopOut, bufferDuration))
  if (outClamped <= inClamped) return null
  return { loopIn: inClamped, loopOut: outClamped }
}

/** Map sequencer time to a buffer offset, wrapping inside an optional loop region. */
export function audioPlaybackOffset(track: SeqTrack, timelineT: number, bufferDuration: number): number | null {
  if (track.keys.length === 0) return null
  const startT = track.keys[0].t
  if (timelineT < startT) return null
  const elapsed = timelineT - startT
  const region = audioLoopRegion(track, bufferDuration)
  if (region) {
    const span = region.loopOut - region.loopIn
    return region.loopIn + (elapsed % span)
  }
  return elapsed % Math.max(0.001, bufferDuration)
}

/** Play imported sounds at the playhead for audio tracks (scrub / editor playback). */
export function scrubSequenceAudio(seq: Sequence, t: number) {
  stopScrubAudio()
  for (const track of seq.tracks) {
    if (!isAudioTrack(track) || track.keys.length === 0) continue
    const soundName = track.actorId
    const buf = getSoundBuffer(soundName)
    if (!buf) continue
    const offset = audioPlaybackOffset(track, t, buf.duration)
    if (offset == null) continue
    const vol = sampleTrack(track, t)
    const volume = typeof vol === 'number' ? vol : 1
    const region = audioLoopRegion(track, buf.duration)
    playSound(soundName, {
      volume,
      currentTime: offset,
      scrub: true,
      loop: true,
      loopStart: region?.loopIn,
      loopEnd: region?.loopOut,
    })
  }
}

/** apply the sequence at time t to the world's actors and HUD widgets */
export function sampleSequence(world: World, seq: Sequence, t: number, withAudio = false) {
  for (const track of seq.tracks) {
    if (isAudioTrack(track)) continue
    const v = sampleTrack(track, t)
    if (v === null) continue
    if (isHudTrack(track)) {
      applyHudCssProperty(track.actorId, track.property as SeqHudProperty, v)
      continue
    }
    const actor = world.actors.get(track.actorId)
    if (!actor) continue
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
  if (withAudio) scrubSequenceAudio(seq, t)
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