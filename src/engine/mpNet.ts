import * as THREE from 'three'

/** Wave 11 — MP delta compression, lag compensation history, interest management. */

export interface MPNetSettings {
  lagCompensationMs: number
  interestRadius: number
  deltaCompression: boolean
}

export const DEFAULT_MP_NET: MPNetSettings = {
  lagCompensationMs: 120,
  interestRadius: 80,
  deltaCompression: true,
}

export interface TransformSample {
  t: number
  position: THREE.Vector3
  rotation: THREE.Euler
}

const HISTORY_MS = 2000
const MAX_SAMPLES = 64
const transformHistory = new Map<string, TransformSample[]>()
const lastSentProps = new Map<string, Record<string, unknown>>()

const SHORT_KEYS: Record<string, string> = {
  position: 'p',
  rotation: 'r',
  visible: 'v',
}

const LONG_KEYS: Record<string, string> = Object.fromEntries(
  Object.entries(SHORT_KEYS).map(([k, v]) => [v, k]),
)

export function mpNetReset() {
  transformHistory.clear()
  lastSentProps.clear()
}

export function mpRecordTransformHistory(
  actorId: string,
  position: THREE.Vector3,
  rotation: THREE.Euler,
  now = performance.now(),
) {
  let buf = transformHistory.get(actorId)
  if (!buf) {
    buf = []
    transformHistory.set(actorId, buf)
  }
  buf.push({
    t: now,
    position: position.clone(),
    rotation: new THREE.Euler(rotation.x, rotation.y, rotation.z),
  })
  const cutoff = now - HISTORY_MS
  while (buf.length > MAX_SAMPLES || (buf.length > 2 && buf[0].t < cutoff)) buf.shift()
}

/** Sample authoritative transform at a past client timestamp (lag compensation). */
export function mpSampleHistory(
  actorId: string,
  atTime: number,
): { position: THREE.Vector3; rotation: THREE.Euler } | null {
  const buf = transformHistory.get(actorId)
  if (!buf?.length) return null
  if (atTime <= buf[0].t) return { position: buf[0].position.clone(), rotation: buf[0].rotation.clone() }
  const last = buf[buf.length - 1]
  if (atTime >= last.t) return { position: last.position.clone(), rotation: last.rotation.clone() }
  for (let i = 1; i < buf.length; i++) {
    const a = buf[i - 1]
    const b = buf[i]
    if (atTime >= a.t && atTime <= b.t) {
      const u = (atTime - a.t) / Math.max(1, b.t - a.t)
      const pos = a.position.clone().lerp(b.position, u)
      const rot = new THREE.Euler(
        THREE.MathUtils.lerp(a.rotation.x, b.rotation.x, u),
        THREE.MathUtils.lerp(a.rotation.y, b.rotation.y, u),
        THREE.MathUtils.lerp(a.rotation.z, b.rotation.z, u),
      )
      return { position: pos, rotation: rot }
    }
  }
  return null
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Delta-compress property sync payloads; returns null when unchanged. */
export function mpPackDelta(
  actorId: string,
  props: Record<string, unknown>,
  useCompression: boolean,
): Record<string, unknown> | null {
  if (!useCompression) return props
  const prev = lastSentProps.get(actorId) ?? {}
  const delta: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) {
    if (!valuesEqual(prev[k], v)) delta[SHORT_KEYS[k] ?? k] = v
  }
  if (!Object.keys(delta).length) return null
  lastSentProps.set(actorId, { ...prev, ...props })
  return delta
}

/** Expand short keys from wire format. */
export function mpExpandDelta(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) {
    out[LONG_KEYS[k] ?? k] = v
  }
  return out
}

export function mpActorInInterest(
  actorPos: THREE.Vector3,
  peerPositions: THREE.Vector3[],
  radius: number,
): boolean {
  if (!radius || radius <= 0) return true
  if (!peerPositions.length) return true
  return peerPositions.some((p) => actorPos.distanceTo(p) <= radius)
}