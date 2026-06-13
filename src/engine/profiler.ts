/**
 * Profiler — Godot debugger monitors analog. The viewport writes one sample
 * per frame; the Debug panel reads rolling buffers.
 */

export interface FrameSample {
  fps: number
  tickMs: number
  renderMs: number
  drawCalls: number
  triangles: number
  actors: number
}

export interface ActorTickSample {
  id: string
  name: string
  ms: number
}

const N = 120
export const samples: FrameSample[] = []

/** Last-frame per-actor tick cost (cleared when play stops). */
const actorTickMs = new Map<string, { name: string; ms: number }>()

export function pushSample(s: FrameSample) {
  samples.push(s)
  if (samples.length > N) samples.shift()
}

export function latest(): FrameSample | null {
  return samples[samples.length - 1] ?? null
}

export function recordActorTick(id: string, name: string, ms: number) {
  actorTickMs.set(id, { name, ms })
}

export function getActorTickBreakdown(): ActorTickSample[] {
  return [...actorTickMs.entries()]
    .map(([id, v]) => ({ id, name: v.name, ms: v.ms }))
    .sort((a, b) => b.ms - a.ms)
}

export function clearActorTicks() {
  actorTickMs.clear()
}
