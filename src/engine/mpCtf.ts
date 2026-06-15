import type { Actor } from './Actor'
import { MP_SCORE_WIN, findMpScoreboard } from './mpGameplay'
import {
  mpBroadcastFlagCapture,
  mpBroadcastFlagPickup,
  mpConnected,
  mpIsHost,
  mpLocalId,
  mpRequestFlagCapture,
  mpRequestFlagPickup,
} from './multiplayer'
import {
  applyMpTeamScoreDelta,
  getMpTeamScores,
  mirrorMpTeamScores,
  type MpTeam,
  type MpTeamScores,
} from './mpTeams'

/** Red team flag actor tag. */
export const MP_TAG_FLAG_RED = 'mp_flag_red'

/** Blue team flag actor tag. */
export const MP_TAG_FLAG_BLUE = 'mp_flag_blue'

export type MpFlagTeam = MpTeam

export interface MpFlagState {
  /** Peer carrying this flag; undefined = at base. */
  carrier?: string
}

export interface MpCtfState {
  red: MpFlagState
  blue: MpFlagState
}

export const MP_CTF_STATE_VAR = 'ctfFlags'

const defaultCtfState = (): MpCtfState => ({ red: {}, blue: {} })

export function mpCtfReset() {
  // state lives on scoreboard actor; cleared when level respawns
}

export function getMpCtfState(actors: Map<string, Actor>): MpCtfState {
  const board = findMpScoreboard(actors)
  const raw = (board?.scriptVars?.[MP_CTF_STATE_VAR] ?? defaultCtfState()) as Partial<MpCtfState>
  return {
    red: { carrier: raw.red?.carrier },
    blue: { carrier: raw.blue?.carrier },
  }
}

export function getMpFlagCarrier(actors: Map<string, Actor>, flagTeam: MpFlagTeam): string | undefined {
  return getMpCtfState(actors)[flagTeam].carrier
}

/** Client mirror — overwrite local scoreboard ctfFlags from host relay. */
export function mirrorMpCtfState(actors: Map<string, Actor>, state: MpCtfState): boolean {
  const board = findMpScoreboard(actors)
  if (!board) return false
  board.scriptVars = {
    ...(board.scriptVars ?? {}),
    [MP_CTF_STATE_VAR]: {
      red: { carrier: state.red.carrier },
      blue: { carrier: state.blue.carrier },
    },
  }
  return true
}

function writeCtfState(
  actors: Map<string, Actor>,
  state: MpCtfState,
  emit?: (signal: string, ...args: unknown[]) => void,
  signal?: string,
  ...signalArgs: unknown[]
) {
  const board = findMpScoreboard(actors)
  if (!board) return false
  board.scriptVars = {
    ...(board.scriptVars ?? {}),
    [MP_CTF_STATE_VAR]: {
      red: { carrier: state.red.carrier },
      blue: { carrier: state.blue.carrier },
    },
  }
  if (signal && emit) emit(signal, ...signalArgs)
  return true
}

/** Pick up a flag — peer becomes carrier; emits flag_pickup. */
export function mpCtfPickup(
  actors: Map<string, Actor>,
  peerId: string,
  flagTeam: MpFlagTeam,
  emit?: (signal: string, ...args: unknown[]) => void,
  broadcast?: (peerId: string, flagTeam: MpFlagTeam, state: MpCtfState) => void,
): boolean {
  if (!peerId) return false
  const state = getMpCtfState(actors)
  if (state[flagTeam].carrier) return false
  state[flagTeam] = { carrier: peerId }
  const ok = writeCtfState(actors, state, emit, 'flag_pickup', peerId, flagTeam)
  if (ok) broadcast?.(peerId, flagTeam, state)
  return ok
}

/** Drop carried flag — returns to base; emits flag_drop. */
export function mpCtfDrop(
  actors: Map<string, Actor>,
  peerId: string,
  flagTeam: MpFlagTeam,
  emit?: (signal: string, ...args: unknown[]) => void,
  broadcast?: (peerId: string, flagTeam: MpFlagTeam, state: MpCtfState) => void,
): boolean {
  if (!peerId) return false
  const state = getMpCtfState(actors)
  if (state[flagTeam].carrier !== peerId) return false
  state[flagTeam] = {}
  const ok = writeCtfState(actors, state, emit, 'flag_drop', peerId, flagTeam)
  if (ok) broadcast?.(peerId, flagTeam, state)
  return ok
}

/**
 * Capture enemy flag at scoring team's base — awards team score, resets flag.
 * Emits flag_capture; applies team score delta on host.
 */
export function mpCtfCapture(
  actors: Map<string, Actor>,
  carrierId: string,
  flagTeam: MpFlagTeam,
  scoringTeam: MpTeam,
  emit?: (signal: string, ...args: unknown[]) => void,
  broadcast?: (
    carrierId: string,
    flagTeam: MpFlagTeam,
    scoringTeam: MpTeam,
    state: MpCtfState,
    scores: MpTeamScores,
    gameWon?: { team: MpTeam; score: number },
  ) => void,
): boolean {
  if (!carrierId) return false
  const state = getMpCtfState(actors)
  if (state[flagTeam].carrier !== carrierId) return false
  state[flagTeam] = {}
  const board = findMpScoreboard(actors)
  if (!board) return false
  board.scriptVars = {
    ...(board.scriptVars ?? {}),
    [MP_CTF_STATE_VAR]: {
      red: { carrier: state.red.carrier },
      blue: { carrier: state.blue.carrier },
    },
  }
  const applied = applyMpTeamScoreDelta(actors, scoringTeam, 1, undefined, (scores, gameWon) => {
    broadcast?.(carrierId, flagTeam, scoringTeam, state, scores, gameWon)
  })
  if (!applied) return false
  const scores = getMpTeamScores(actors)
  if (emit) emit('flag_capture', carrierId, flagTeam, scoringTeam, scores)
  if (scores[scoringTeam] >= MP_SCORE_WIN && emit) emit('mp_game_won', scoringTeam, scores[scoringTeam])
  return true
}

/** Host applies pickup locally; clients request via relay (Wave 88). */
export function addMpCtfPickup(
  actors: Map<string, Actor>,
  flagTeam: MpFlagTeam,
  peerId?: string,
  emit?: (signal: string, ...args: unknown[]) => void,
): boolean {
  if (!mpConnected()) return false
  const id = peerId ?? mpLocalId()
  if (mpIsHost()) {
    return mpCtfPickup(actors, id, flagTeam, emit, (pid, ft, state) => mpBroadcastFlagPickup(pid, ft, state))
  }
  mpRequestFlagPickup(flagTeam, id)
  return true
}

/** Host applies capture locally; clients request via relay (Wave 88). */
export function addMpCtfCapture(
  actors: Map<string, Actor>,
  flagTeam: MpFlagTeam,
  scoringTeam: MpTeam,
  peerId?: string,
  emit?: (signal: string, ...args: unknown[]) => void,
): boolean {
  if (!mpConnected()) return false
  const id = peerId ?? mpLocalId()
  if (mpIsHost()) {
    return mpCtfCapture(actors, id, flagTeam, scoringTeam, emit, (carrierId, ft, st, state, scores, gameWon) =>
      mpBroadcastFlagCapture(carrierId, ft, st, state, scores, gameWon),
    )
  }
  mpRequestFlagCapture(flagTeam, scoringTeam, id)
  return true
}

export { getMpTeamScores, mirrorMpTeamScores, type MpTeamScores }