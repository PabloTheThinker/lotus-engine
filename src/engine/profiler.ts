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

const N = 120
export const samples: FrameSample[] = []

export function pushSample(s: FrameSample) {
  samples.push(s)
  if (samples.length > N) samples.shift()
}

export function latest(): FrameSample | null {
  return samples[samples.length - 1] ?? null
}
