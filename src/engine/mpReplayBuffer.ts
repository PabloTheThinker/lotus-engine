import * as THREE from 'three'

/**
 * MP replay buffer — last 30s pose ring for spectator rewind (Wave 73).
 * Host records peer poses @ 10 Hz; spectators sample via replay_sample relay.
 */

export const MP_REPLAY_BUFFER_SEC = 30
export const MP_REPLAY_SAMPLE_HZ = 10
const MAX_FRAMES = MP_REPLAY_BUFFER_SEC * MP_REPLAY_SAMPLE_HZ

export interface MpReplayPose {
  t: number
  peerId: string
  position: THREE.Vector3
  rotation: THREE.Euler
}

export interface MpReplayPoseWire {
  peerId: string
  p: [number, number, number]
  r: [number, number, number]
}

interface ReplayFrame {
  t: number
  poses: Map<string, { position: THREE.Vector3; rotation: THREE.Euler }>
}

const frames: (ReplayFrame | undefined)[] = new Array(MAX_FRAMES)
let frameWrite = 0
let frameCount = 0
let seekOffsetSec = 0
let recordEnabled = false

/** Spectator mirror — last host replay_sample payload. */
let remoteBufferLengthSec = 0
let remoteSampleOffset = -1
let remoteSamples: MpReplayPose[] = []

export function mpReplayReset() {
  frameWrite = 0
  frameCount = 0
  seekOffsetSec = 0
  recordEnabled = false
  remoteBufferLengthSec = 0
  remoteSampleOffset = -1
  remoteSamples = []
  frames.fill(undefined)
}

export function mpReplaySetRecordEnabled(enabled: boolean) {
  recordEnabled = enabled
}

export function mpReplayRecordEnabled(): boolean {
  return recordEnabled
}

export function mpReplayGetSeekOffset(): number {
  return seekOffsetSec
}

/** Seconds of history available (0–30). */
export function mpReplayBufferLength(): number {
  if (frameCount >= 2) {
    const oldest = frames[(frameWrite - frameCount + MAX_FRAMES) % MAX_FRAMES]
    const newest = frames[(frameWrite - 1 + MAX_FRAMES) % MAX_FRAMES]
    if (oldest && newest) return Math.min(MP_REPLAY_BUFFER_SEC, Math.max(0, (newest.t - oldest.t) / 1000))
  }
  if (remoteBufferLengthSec > 0) return remoteBufferLengthSec
  return MP_REPLAY_BUFFER_SEC
}

export function mpReplaySeek(offsetSec: number): number {
  const max = mpReplayBufferLength()
  seekOffsetSec = Math.max(0, Math.min(max, offsetSec))
  return seekOffsetSec
}

function frameAt(index: number): ReplayFrame | null {
  if (index < 0 || index >= frameCount) return null
  return frames[(frameWrite - frameCount + index + MAX_FRAMES) % MAX_FRAMES] ?? null
}

function requireFrame(index: number): ReplayFrame {
  const f = frameAt(index)
  if (!f) throw new Error('mpReplayBuffer: missing frame')
  return f
}

function newestFrame(): ReplayFrame | null {
  return frameAt(frameCount - 1)
}

function oldestFrame(): ReplayFrame | null {
  return frameAt(0)
}

function pushFrame(t: number, poses: Map<string, { position: THREE.Vector3; rotation: THREE.Euler }>) {
  const frame: ReplayFrame = { t, poses: new Map(poses) }
  frames[frameWrite] = frame
  frameWrite = (frameWrite + 1) % MAX_FRAMES
  if (frameCount < MAX_FRAMES) frameCount++
  const cutoff = t - MP_REPLAY_BUFFER_SEC * 1000
  while (frameCount > 1) {
    const oldest = oldestFrame()
    if (!oldest || oldest.t >= cutoff) break
    frameCount--
  }
}

/** Record one 10 Hz frame of peer poses (host authority). */
export function mpReplayRecordPoses(
  entries: Array<{ peerId: string; position: THREE.Vector3; rotation: THREE.Euler }>,
  now = performance.now(),
) {
  if (!recordEnabled || !entries.length) return
  const map = new Map<string, { position: THREE.Vector3; rotation: THREE.Euler }>()
  for (const e of entries) {
    map.set(e.peerId, {
      position: e.position.clone(),
      rotation: new THREE.Euler(e.rotation.x, e.rotation.y, e.rotation.z),
    })
  }
  pushFrame(now, map)
}

/** Convenience — append/update a single peer pose on the latest frame. */
export function mpReplayRecordPose(
  peerId: string,
  position: THREE.Vector3,
  rotation: THREE.Euler,
  now = performance.now(),
) {
  if (!recordEnabled || !peerId) return
  const latest = newestFrame()
  if (latest && now - latest.t < 50) {
    latest.poses.set(peerId, {
      position: position.clone(),
      rotation: new THREE.Euler(rotation.x, rotation.y, rotation.z),
    })
    return
  }
  const map = new Map<string, { position: THREE.Vector3; rotation: THREE.Euler }>()
  map.set(peerId, {
    position: position.clone(),
    rotation: new THREE.Euler(rotation.x, rotation.y, rotation.z),
  })
  pushFrame(now, map)
}

function sampleLocalAt(targetT: number): MpReplayPose[] {
  if (!frameCount) return []
  const oldest = requireFrame(0)
  const newest = requireFrame(frameCount - 1)
  if (targetT <= oldest.t) return flattenFrame(oldest)
  if (targetT >= newest.t) return flattenFrame(newest)

  let before: ReplayFrame | null = null
  let after: ReplayFrame | null = null
  for (let i = 0; i < frameCount; i++) {
    const f = frameAt(i)!
    if (f.t <= targetT) before = f
    if (f.t >= targetT) {
      after = f
      break
    }
  }
  if (!before) return flattenFrame(after ?? newest)
  if (!after || before.t === after.t) return flattenFrame(before)

  const u = (targetT - before.t) / Math.max(1, after.t - before.t)
  const peerIds = new Set([...before.poses.keys(), ...after.poses.keys()])
  const out: MpReplayPose[] = []
  for (const peerId of peerIds) {
    const a = before.poses.get(peerId)
    const b = after.poses.get(peerId) ?? a
    if (!a && !b) continue
    const pa = a?.position ?? b!.position
    const pb = b?.position ?? a!.position
    const ra = a?.rotation ?? b!.rotation
    const rb = b?.rotation ?? a!.rotation
    out.push({
      t: targetT,
      peerId,
      position: pa.clone().lerp(pb, u),
      rotation: new THREE.Euler(
        THREE.MathUtils.lerp(ra.x, rb.x, u),
        THREE.MathUtils.lerp(ra.y, rb.y, u),
        THREE.MathUtils.lerp(ra.z, rb.z, u),
      ),
    })
  }
  return out
}

function flattenFrame(frame: ReplayFrame): MpReplayPose[] {
  const out: MpReplayPose[] = []
  for (const [peerId, pose] of frame.poses) {
    out.push({
      t: frame.t,
      peerId,
      position: pose.position.clone(),
      rotation: new THREE.Euler(pose.rotation.x, pose.rotation.y, pose.rotation.z),
    })
  }
  return out
}

/** Sample all peer poses offsetSec seconds before the live edge. */
export function mpReplaySampleAt(offsetSec: number): MpReplayPose[] {
  const clamped = Math.max(0, Math.min(mpReplayBufferLength(), offsetSec))
  if (frameCount) {
    const newest = newestFrame()
    if (!newest) return []
    const targetT = newest.t - clamped * 1000
    return sampleLocalAt(targetT)
  }
  if (remoteSampleOffset === clamped && remoteSamples.length) return remoteSamples.map(clonePose)
  return remoteSamples.map(clonePose)
}

function clonePose(p: MpReplayPose): MpReplayPose {
  return {
    t: p.t,
    peerId: p.peerId,
    position: p.position.clone(),
    rotation: new THREE.Euler(p.rotation.x, p.rotation.y, p.rotation.z),
  }
}

export function mpReplayPackWire(samples: MpReplayPose[]): MpReplayPoseWire[] {
  return samples.map((s) => ({
    peerId: s.peerId,
    p: [s.position.x, s.position.y, s.position.z],
    r: [s.rotation.x, s.rotation.y, s.rotation.z],
  }))
}

export function mpReplayUnpackWire(
  offsetSec: number,
  bufferLengthSec: number,
  wire: MpReplayPoseWire[],
  t = performance.now(),
) {
  remoteBufferLengthSec = bufferLengthSec
  remoteSampleOffset = offsetSec
  remoteSamples = wire.map((w) => ({
    t,
    peerId: w.peerId,
    position: new THREE.Vector3(w.p[0], w.p[1], w.p[2]),
    rotation: new THREE.Euler(w.r[0], w.r[1], w.r[2]),
  }))
}