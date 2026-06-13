/**
 * Audio — playback with true 3D spatialization, bus mixer, reverb zones, and MetaSounds.
 * Imported sounds are base64 assets; procedural graphs compile to WebAudio chains.
 */

import { compileMetaSound } from './metaSounds'
import { getMetaSoundByName } from './metaSoundAssets'
import type { AttenuationCurve, AttenuationSettings } from './types'
import { DEFAULT_ATTENUATION } from './types'

export type { AttenuationCurve, AttenuationSettings } from './types'

let ctx: AudioContext | null = null
let master: GainNode | null = null
const buses = new Map<string, GainNode>()
const buffers = new Map<string, AudioBuffer>()

/** dry path + shared reverb send */
let dryBus: GainNode | null = null
let reverbSend: GainNode | null = null
let reverbConvolver: ConvolverNode | null = null
let reverbWet = 0

const compiledMeta = new Map<string, ReturnType<typeof compileMetaSound>>()

/** per-imported-sound attenuation defaults (set by World on load) */
let soundAttenuationDefaults: Record<string, AttenuationSettings> = {}

export function setSoundAttenuationDefaults(m: Record<string, AttenuationSettings>) {
  soundAttenuationDefaults = m
}

function ensureCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.connect(ctx.destination)
    dryBus = ctx.createGain()
    dryBus.connect(master)
    reverbSend = ctx.createGain()
    reverbSend.gain.value = 0
    reverbConvolver = ctx.createConvolver()
    reverbConvolver.buffer = makeImpulseResponse(ctx, 1.2, 3)
    reverbConvolver.connect(reverbSend)
    reverbSend.connect(master)
    for (const name of ['sfx', 'music']) {
      const g = ctx.createGain()
      g.connect(dryBus)
      buses.set(name, g)
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function getAudioContext(): AudioContext {
  return ensureCtx()
}

export type ReverbPreset = '' | 'room' | 'hall' | 'cave'

const REVERB_IR: Record<Exclude<ReverbPreset, ''>, { duration: number; decay: number; wet: number }> = {
  room: { duration: 0.8, decay: 4, wet: 0.25 },
  hall: { duration: 2.5, decay: 2.5, wet: 0.45 },
  cave: { duration: 3.5, decay: 1.8, wet: 0.55 },
}

function makeImpulseResponse(ac: AudioContext, duration: number, decay: number): AudioBuffer {
  const len = Math.floor(ac.sampleRate * duration)
  const buf = ac.createBuffer(2, len, ac.sampleRate)
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c)
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}

/** Reverb zone — TriggerVolume sets this when the pawn enters/exits. */
export function setReverbZone(preset: ReverbPreset) {
  const ac = ensureCtx()
  if (!reverbConvolver || !reverbSend) return
  if (!preset) {
    reverbWet = 0
    reverbSend.gain.setTargetAtTime(0, ac.currentTime, 0.08)
    return
  }
  const cfg = REVERB_IR[preset]
  reverbConvolver.buffer = makeImpulseResponse(ac, cfg.duration, cfg.decay)
  reverbWet = cfg.wet
  reverbSend.gain.setTargetAtTime(cfg.wet, ac.currentTime, 0.12)
}

export function setBusVolume(bus: 'master' | 'sfx' | 'music', volume: number) {
  ensureCtx()
  const node = bus === 'master' ? master : buses.get(bus)
  if (node) node.gain.value = Math.max(0, Math.min(1.5, volume))
}

export async function registerSound(name: string, base64: string) {
  const ac = ensureCtx()
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  buffers.set(name, await ac.decodeAudioData(bytes.buffer))
}

export function hasSound(name: string) {
  return buffers.has(name)
}

export function getSoundBuffer(name: string): AudioBuffer | undefined {
  return buffers.get(name)
}

/** Update the WebAudio listener from the pawn / editor camera (true 3D audio). */
export function updateListener(
  pos: [number, number, number],
  forward: [number, number, number] = [0, 0, -1],
  up: [number, number, number] = [0, 1, 0],
) {
  const ac = ensureCtx()
  if (!ac.listener) return
  const l = ac.listener
  if ('positionX' in l) {
    l.positionX.value = pos[0]
    l.positionY.value = pos[1]
    l.positionZ.value = pos[2]
    l.forwardX.value = forward[0]
    l.forwardY.value = forward[1]
    l.forwardZ.value = forward[2]
    l.upX.value = up[0]
    l.upY.value = up[1]
    l.upZ.value = up[2]
  } else {
    // legacy API
    ;(l as AudioListener & { setPosition: (x: number, y: number, z: number) => void }).setPosition(pos[0], pos[1], pos[2])
    ;(l as AudioListener & { setOrientation: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void }).setOrientation(
      forward[0],
      forward[1],
      forward[2],
      up[0],
      up[1],
      up[2],
    )
  }
}

export interface PlayOpts {
  volume?: number
  bus?: 'sfx' | 'music'
  loop?: boolean
  /** world position — routed through a PannerNode (HRTF) */
  at?: [number, number, number]
  listener?: () => [number, number, number] | null
  falloff?: AttenuationCurve
  minDistance?: number
  maxDistance?: number
  customCurve?: [number, number][]
  /** start playback at this offset in seconds (sequencer scrubbing) */
  currentTime?: number
  /** loop wrap points within the buffer (sequencer loop regions) */
  loopStart?: number
  loopEnd?: number
  /** marks a scrub-preview voice (stopped by stopScrubAudio) */
  scrub?: boolean
}

interface ActiveVoice {
  stop: () => void
  panner?: PannerNode
  at?: [number, number, number]
  falloffGain?: GainNode
  falloff?: AttenuationCurve
  minDistance?: number
  maxDistance?: number
  customCurve?: [number, number][]
  listener?: () => [number, number, number] | null
}

const playing: ActiveVoice[] = []
const scrubVoices: ActiveVoice[] = []

function resolveAttenuation(name: string, opts: PlayOpts) {
  const defaults = soundAttenuationDefaults[name] ?? {}
  return {
    falloff: opts.falloff ?? defaults.falloff ?? DEFAULT_ATTENUATION.falloff ?? 'inverse',
    minDistance: opts.minDistance ?? defaults.minDistance ?? DEFAULT_ATTENUATION.minDistance ?? 1,
    maxDistance: opts.maxDistance ?? defaults.maxDistance ?? DEFAULT_ATTENUATION.maxDistance ?? 80,
    customCurve: opts.customCurve ?? defaults.customCurve ?? DEFAULT_ATTENUATION.customCurve,
  }
}

function distanceModelFor(curve: AttenuationCurve): DistanceModelType {
  switch (curve) {
    case 'linear':
      return 'linear'
    case 'inverseSquare':
      return 'exponential'
    case 'inverse':
    default:
      return 'inverse'
  }
}

export function evaluateCustomCurve(points: [number, number][], t: number): number {
  if (points.length === 0) return 1
  const sorted = [...points].sort((a, b) => a[0] - b[0])
  if (t <= sorted[0][0]) return sorted[0][1]
  if (t >= sorted[sorted.length - 1][0]) return sorted[sorted.length - 1][1]
  for (let i = 0; i < sorted.length - 1; i++) {
    const [t0, v0] = sorted[i]
    const [t1, v1] = sorted[i + 1]
    if (t >= t0 && t <= t1) {
      const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0)
      return v0 + (v1 - v0) * f
    }
  }
  return 1
}

function normalizedDistance(dist: number, minD: number, maxD: number): number {
  const span = Math.max(0.001, maxD - minD)
  return Math.max(0, Math.min(1, (dist - minD) / span))
}

function listenerPosition(listener?: () => [number, number, number] | null): [number, number, number] | null {
  if (listener) return listener()
  const ac = ctx
  if (!ac?.listener) return null
  const l = ac.listener
  if ('positionX' in l) return [l.positionX.value, l.positionY.value, l.positionZ.value]
  return null
}

function computeCustomGain(
  at: [number, number, number],
  minD: number,
  maxD: number,
  customCurve: [number, number][],
  listener?: () => [number, number, number] | null,
): number {
  const lp = listenerPosition(listener)
  if (!lp) return 1
  const dx = at[0] - lp[0]
  const dy = at[1] - lp[1]
  const dz = at[2] - lp[2]
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const nd = normalizedDistance(dist, minD, maxD)
  return evaluateCustomCurve(customCurve, nd)
}

function configurePanner(panner: PannerNode, falloff: AttenuationCurve, minD: number, maxD: number) {
  panner.panningModel = 'HRTF'
  if (falloff === 'custom') {
    panner.distanceModel = 'linear'
    panner.refDistance = minD
    panner.maxDistance = maxD
    panner.rolloffFactor = 0
  } else {
    panner.distanceModel = distanceModelFor(falloff)
    panner.refDistance = minD
    panner.maxDistance = maxD
    panner.rolloffFactor = 1
  }
}

function pushVoice(voice: ActiveVoice, scrub?: boolean) {
  if (scrub) scrubVoices.push(voice)
  else playing.push(voice)
}

function removeVoice(voice: ActiveVoice, scrub?: boolean) {
  const list = scrub ? scrubVoices : playing
  const i = list.indexOf(voice)
  if (i >= 0) list.splice(i, 1)
}

/** Move active PannerNodes when the source position changes; update custom falloff gains. */
export function updatePannerPositions() {
  const ac = ensureCtx()
  const t = ac.currentTime
  for (const v of [...playing, ...scrubVoices]) {
    if (v.panner && v.at) {
      v.panner.positionX.setValueAtTime(v.at[0], t)
      v.panner.positionY.setValueAtTime(v.at[1], t)
      v.panner.positionZ.setValueAtTime(v.at[2], t)
    }
    if (v.falloff === 'custom' && v.falloffGain && v.at) {
      const g = computeCustomGain(v.at, v.minDistance ?? 1, v.maxDistance ?? 80, v.customCurve ?? [[0, 1], [1, 0]], v.listener)
      v.falloffGain.gain.setValueAtTime(g, t)
    }
  }
}

export function playSound(name: string, opts: PlayOpts = {}) {
  const buf = buffers.get(name)
  if (!buf) return
  const ac = ensureCtx()
  const src = ac.createBufferSource()
  src.buffer = buf
  src.loop = !!opts.loop
  if (src.loop && opts.loopStart != null && opts.loopEnd != null && opts.loopEnd > opts.loopStart) {
    src.loopStart = opts.loopStart
    src.loopEnd = opts.loopEnd
  }

  const att = resolveAttenuation(name, opts)
  let panner: PannerNode | undefined
  let entryGain: GainNode | undefined
  let falloffGain: GainNode | undefined

  if (opts.at) {
    panner = ac.createPanner()
    configurePanner(panner, att.falloff, att.minDistance, att.maxDistance)
    panner.positionX.value = opts.at[0]
    panner.positionY.value = opts.at[1]
    panner.positionZ.value = opts.at[2]
    entryGain = ac.createGain()
    entryGain.gain.value = opts.volume ?? 1
    if (att.falloff === 'custom') {
      falloffGain = ac.createGain()
      falloffGain.gain.value = computeCustomGain(opts.at, att.minDistance, att.maxDistance, att.customCurve ?? [[0, 1], [1, 0]], opts.listener)
      src.connect(entryGain)
      entryGain.connect(falloffGain)
      falloffGain.connect(panner)
    } else {
      src.connect(entryGain)
      entryGain.connect(panner)
    }
    panner.connect(buses.get(opts.bus ?? 'sfx') ?? dryBus!)
    if (reverbConvolver && reverbWet > 0) {
      const send = ac.createGain()
      send.gain.value = reverbWet * 0.6
      ;(falloffGain ?? entryGain)!.connect(send)
      send.connect(reverbConvolver)
    }
  } else {
    entryGain = ac.createGain()
    entryGain.gain.value = opts.volume ?? 1
    src.connect(entryGain)
    entryGain.connect(buses.get(opts.bus ?? 'sfx') ?? dryBus!)
    if (reverbConvolver && reverbWet > 0) {
      const send = ac.createGain()
      send.gain.value = reverbWet * 0.35
      entryGain.connect(send)
      send.connect(reverbConvolver)
    }
  }

  const offset = Math.max(0, opts.currentTime ?? 0)
  const loopEnd = src.loop && opts.loopEnd != null ? opts.loopEnd : buf.duration
  const loopStart = src.loop && opts.loopStart != null ? opts.loopStart : 0
  const clamped = Math.max(loopStart, Math.min(offset, loopEnd - 0.001))
  src.start(0, clamped)

  const voice: ActiveVoice = {
    panner,
    at: opts.at,
    falloffGain,
    falloff: opts.at ? att.falloff : undefined,
    minDistance: att.minDistance,
    maxDistance: att.maxDistance,
    customCurve: att.customCurve,
    listener: opts.listener,
    stop: () => {
      try {
        src.stop()
      } catch {
        /* already stopped */
      }
      src.disconnect()
      entryGain?.disconnect()
      falloffGain?.disconnect()
      panner?.disconnect()
    },
  }
  pushVoice(voice, opts.scrub)
  src.onended = () => {
    removeVoice(voice, opts.scrub)
    voice.stop()
  }
}

function getCompiledMeta(name: string) {
  let compiled = compiledMeta.get(name)
  if (!compiled) {
    const asset = getMetaSoundByName(name)
    if (!asset) return null
    compiled = compileMetaSound(asset.graph, (n) => buffers.get(n), ensureCtx())
    compiledMeta.set(name, compiled)
  }
  return compiled
}

/** Invalidate cached compilers after graph edits. */
export function invalidateMetaSound(name: string) {
  compiledMeta.delete(name)
}

export function playMetaSound(name: string, opts: PlayOpts = {}) {
  const factory = getCompiledMeta(name)
  if (!factory) return
  const ac = ensureCtx()
  const inst = factory()
  const vol = opts.volume ?? 1
  const att = resolveAttenuation(name, opts)

  let panner: PannerNode | undefined
  let entryGain = ac.createGain()
  entryGain.gain.value = vol
  let falloffGain: GainNode | undefined
  inst.output.connect(entryGain)

  if (opts.at) {
    panner = ac.createPanner()
    configurePanner(panner, att.falloff, att.minDistance, att.maxDistance)
    panner.positionX.value = opts.at[0]
    panner.positionY.value = opts.at[1]
    panner.positionZ.value = opts.at[2]
    if (att.falloff === 'custom') {
      falloffGain = ac.createGain()
      falloffGain.gain.value = computeCustomGain(opts.at, att.minDistance, att.maxDistance, att.customCurve ?? [[0, 1], [1, 0]], opts.listener)
      entryGain.connect(falloffGain)
      falloffGain.connect(panner)
    } else {
      entryGain.connect(panner)
    }
    panner.connect(buses.get(opts.bus ?? 'sfx') ?? dryBus!)
  } else {
    entryGain.connect(buses.get(opts.bus ?? 'sfx') ?? dryBus!)
  }

  if (reverbConvolver && reverbWet > 0) {
    const send = ac.createGain()
    send.gain.value = reverbWet * 0.6
    ;(falloffGain ?? entryGain).connect(send)
    send.connect(reverbConvolver)
  }

  inst.start()

  const voice: ActiveVoice = {
    panner,
    at: opts.at,
    falloffGain,
    falloff: opts.at ? att.falloff : undefined,
    minDistance: att.minDistance,
    maxDistance: att.maxDistance,
    customCurve: att.customCurve,
    listener: opts.listener,
    stop: () => {
      inst.stop()
      entryGain.disconnect()
      falloffGain?.disconnect()
      panner?.disconnect()
    },
  }
  pushVoice(voice, opts.scrub)

  // one-shot procedural sounds auto-stop after a few seconds if not looping
  if (!opts.loop) {
    window.setTimeout(() => {
      removeVoice(voice, opts.scrub)
      voice.stop()
    }, 8000)
  }
}

/** Stop scrub-preview voices (sequencer scrub end). */
export function stopScrubAudio() {
  for (const s of [...scrubVoices]) s.stop()
  scrubVoices.length = 0
}

export function stopAllSounds() {
  stopScrubAudio()
  for (const s of [...playing]) s.stop()
  playing.length = 0
}