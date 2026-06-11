import type { World } from './World'

/**
 * Sequencer — the UE Sequencer / Godot AnimationPlayer analog (v1).
 * One master sequence per level: transform tracks with linearly
 * interpolated keys, sampled onto actors by the editor (scrub/play)
 * and by Play mode when autoPlay is set.
 */

export type SeqProperty = 'position' | 'rotation' | 'scale'

export interface SeqKey {
  t: number
  v: [number, number, number]
}

export interface SeqTrack {
  actorId: string
  property: SeqProperty
  keys: SeqKey[]
}

export interface Sequence {
  duration: number
  autoPlay: boolean
  tracks: SeqTrack[]
}

export function emptySequence(): Sequence {
  return { duration: 10, autoPlay: false, tracks: [] }
}

export function findTrack(seq: Sequence, actorId: string, property: SeqProperty): SeqTrack | undefined {
  return seq.tracks.find((tr) => tr.actorId === actorId && tr.property === property)
}

/** insert or replace a key (keys stay sorted by t) */
export function setKey(seq: Sequence, actorId: string, property: SeqProperty, t: number, v: [number, number, number]) {
  let track = findTrack(seq, actorId, property)
  if (!track) {
    track = { actorId, property, keys: [] }
    seq.tracks.push(track)
  }
  const existing = track.keys.find((k) => Math.abs(k.t - t) < 0.011)
  if (existing) existing.v = [...v]
  else {
    track.keys.push({ t, v: [...v] })
    track.keys.sort((a, b) => a.t - b.t)
  }
}

function sampleTrack(track: SeqTrack, t: number): [number, number, number] | null {
  const keys = track.keys
  if (keys.length === 0) return null
  if (t <= keys[0].t) return keys[0].v
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t >= a.t && t <= b.t) {
      const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
      return [a.v[0] + (b.v[0] - a.v[0]) * f, a.v[1] + (b.v[1] - a.v[1]) * f, a.v[2] + (b.v[2] - a.v[2]) * f]
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
    if (!v) continue
    if (track.property === 'position') actor.root.position.set(v[0], v[1], v[2])
    else if (track.property === 'rotation') actor.root.rotation.set(v[0], v[1], v[2])
    else actor.root.scale.set(v[0], v[1], v[2])
  }
}
