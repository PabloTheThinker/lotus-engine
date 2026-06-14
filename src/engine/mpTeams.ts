import type { Actor } from './Actor'
import { MP_SCORE_WIN, findMpScoreboard } from './mpGameplay'

/** Red team spawn / player tag. */
export const MP_TAG_RED = 'mp_team_red'

/** Blue team spawn / player tag. */
export const MP_TAG_BLUE = 'mp_team_blue'

export type MpTeam = 'red' | 'blue'

export interface MpTeamScores {
  red: number
  blue: number
}

export const MP_TEAM_SCORES_VAR = 'teamScores'

const peerTeams = new Map<string, MpTeam>()

export function mpTeamsReset(localId?: string) {
  peerTeams.clear()
  if (localId) mpTeamsAssign(localId)
}

/** Balance red/blue — host-authoritative when connected. */
export function mpTeamsAssign(peerId: string): MpTeam {
  if (!peerId) return 'red'
  const existing = peerTeams.get(peerId)
  if (existing) return existing
  let red = 0
  let blue = 0
  for (const t of peerTeams.values()) {
    if (t === 'red') red++
    else blue++
  }
  const team: MpTeam = red <= blue ? 'red' : 'blue'
  peerTeams.set(peerId, team)
  return team
}

export function mpTeamsSet(peerId: string, team: MpTeam) {
  if (!peerId) return
  peerTeams.set(peerId, team)
}

export function mpTeamsGet(peerId: string): MpTeam | undefined {
  if (!peerId) return undefined
  return peerTeams.get(peerId)
}

export function mpTeamsGetAll(): Record<string, MpTeam> {
  const out: Record<string, MpTeam> = {}
  for (const [id, team] of peerTeams) out[id] = team
  return out
}

/** Friendly fire off — true when both peers share a team. */
export function mpTeamsAreFriendly(peerA: string, peerB: string): boolean {
  const a = peerTeams.get(peerA)
  const b = peerTeams.get(peerB)
  if (!a || !b) return false
  return a === b
}

export function getMpTeamScores(actors: Map<string, Actor>): MpTeamScores {
  const board = findMpScoreboard(actors)
  const raw = (board?.scriptVars?.[MP_TEAM_SCORES_VAR] ?? { red: 0, blue: 0 }) as Partial<MpTeamScores>
  return { red: raw.red ?? 0, blue: raw.blue ?? 0 }
}

/** Client mirror — overwrite local scoreboard teamScores from host relay. */
export function mirrorMpTeamScores(actors: Map<string, Actor>, scores: MpTeamScores): boolean {
  const board = findMpScoreboard(actors)
  if (!board) return false
  board.scriptVars = {
    ...(board.scriptVars ?? {}),
    [MP_TEAM_SCORES_VAR]: { red: scores.red ?? 0, blue: scores.blue ?? 0 },
  }
  return true
}

export function applyMpTeamScoreDelta(
  actors: Map<string, Actor>,
  team: MpTeam,
  delta: number,
  emit?: (signal: string, ...args: unknown[]) => void,
  broadcast?: (scores: MpTeamScores, gameWon?: { team: MpTeam; score: number }) => void,
): boolean {
  const board = findMpScoreboard(actors)
  if (!board) return false
  const scores = { ...getMpTeamScores(actors) }
  scores[team] = (scores[team] ?? 0) + delta
  board.scriptVars = { ...(board.scriptVars ?? {}), [MP_TEAM_SCORES_VAR]: scores }
  const won = scores[team] >= MP_SCORE_WIN
  broadcast?.(scores, won ? { team, score: scores[team] } : undefined)
  if (won && emit) emit('mp_game_won', team, scores[team])
  return true
}

