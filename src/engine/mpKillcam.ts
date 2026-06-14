import { hud } from './gameplay'
import { mpReplayGetSeekOffset, mpReplaySeek as bufferSeek } from './mpReplayBuffer'

/**
 * MP killcam — replay buffer rewind on death / match win (Wave 78).
 * On `player_killed` (victim) or `mp_game_won`, seek 5s back for 3s HUD overlay.
 */

export const MP_KILLCAM_SEEK_SEC = 5
export const MP_KILLCAM_DURATION_SEC = 3

let active = false
let remainingSec = 0
let trigger = ''
let seekHook: ((offsetSec: number) => number) | null = null
let localIdHook: (() => string) | null = null

export function mpKillcamSetSeekHook(fn: (offsetSec: number) => number) {
  seekHook = fn
}

export function mpKillcamSetLocalIdHook(fn: () => string) {
  localIdHook = fn
}

export function mpKillcamReset() {
  active = false
  remainingSec = 0
  trigger = ''
  hud.remove('mp_killcam_label')
  hud.remove('mp_killcam_bar')
  seek(0)
}

function seek(offsetSec: number): number {
  if (seekHook) return seekHook(offsetSec)
  return bufferSeek(offsetSec)
}

export function mpKillcamSeekOffset(): number {
  return mpReplayGetSeekOffset()
}

function refreshHud() {
  if (!active) return
  hud.text('mp_killcam_label', `KILLCAM · -${MP_KILLCAM_SEEK_SEC}s`, {
    anchor: 'tc',
    x: 0,
    y: 28,
    size: 22,
    color: '#e07a5f',
  })
  const frac = Math.max(0, Math.min(1, remainingSec / MP_KILLCAM_DURATION_SEC))
  hud.bar('mp_killcam_bar', frac, {
    anchor: 'tc',
    x: 0,
    y: 58,
    color: '#e07a5f',
  })
}

/** Manual / bridge trigger — seeks replay and shows overlay. */
export function mpKillcamTrigger(reason = 'manual') {
  active = true
  remainingSec = MP_KILLCAM_DURATION_SEC
  trigger = reason
  seek(MP_KILLCAM_SEEK_SEC)
  refreshHud()
}

export function mpKillcamActive(): boolean {
  return active
}

export function mpKillcamDurationSec(): number {
  return MP_KILLCAM_DURATION_SEC
}

export function mpKillcamTriggerReason(): string {
  return trigger
}

export function mpKillcamRemainingSec(): number {
  return Math.max(0, remainingSec)
}

export function mpKillcamOnPlayerKilled(_killerId: string, victimId: string) {
  const local = localIdHook?.() ?? ''
  if (!local || victimId !== local) return
  mpKillcamTrigger('player_killed')
}

export function mpKillcamOnGameWon(_winnerId: string) {
  mpKillcamTrigger('mp_game_won')
}

export function mpKillcamTick(dt: number) {
  if (!active) return
  remainingSec -= dt
  refreshHud()
  if (remainingSec <= 0) mpKillcamReset()
}