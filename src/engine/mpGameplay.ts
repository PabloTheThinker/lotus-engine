import type { Actor } from './Actor'
import { mpConnected, mpIsHost, mpLocalId, mpRequestScoreDelta } from './multiplayer'

/** Deathmatch target tag — raycast hits award score (host authoritative). */
export const MP_TAG_TARGET = 'mp_target'

/** First player to this score wins and emits mp_game_won. */
export const MP_SCORE_WIN = 3

export const MP_SCOREBOARD_NAME = 'MpScoreboard'
export const MP_SCORE_VAR = 'peerScores'

export function findMpScoreboard(actors: Map<string, Actor>): Actor | undefined {
  return [...actors.values()].find((a) => a.name === MP_SCOREBOARD_NAME)
}

export function getMpScore(actors: Map<string, Actor>, peerId?: string): number {
  const board = findMpScoreboard(actors)
  const id = peerId ?? mpLocalId()
  const scores = (board?.scriptVars?.[MP_SCORE_VAR] ?? {}) as Record<string, number>
  return scores[id] ?? 0
}

export function applyMpScoreDelta(
  actors: Map<string, Actor>,
  peerId: string,
  delta: number,
  emit?: (signal: string, ...args: unknown[]) => void,
): boolean {
  const board = findMpScoreboard(actors)
  if (!board) return false
  const scores = { ...((board.scriptVars?.[MP_SCORE_VAR] ?? {}) as Record<string, number>) }
  const next = (scores[peerId] ?? 0) + delta
  scores[peerId] = next
  board.scriptVars = { ...(board.scriptVars ?? {}), [MP_SCORE_VAR]: scores }
  if (next >= MP_SCORE_WIN && emit) emit('mp_game_won', peerId, next)
  return true
}

/** Host applies score locally; clients request via relay. */
export function addMpScore(
  actors: Map<string, Actor>,
  delta: number,
  peerId?: string,
  emit?: (signal: string, ...args: unknown[]) => void,
): boolean {
  if (!mpConnected()) return false
  const id = peerId ?? mpLocalId()
  if (mpIsHost()) return applyMpScoreDelta(actors, id, delta, emit)
  mpRequestScoreDelta(delta, id)
  return true
}