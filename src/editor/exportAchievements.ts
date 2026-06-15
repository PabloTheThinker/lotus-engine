/** Wave 85 (v4.64–v4.68) — localStorage trophy unlocks in mini-game export packs. */
/** Wave 90 (v4.89–v4.93) — partial unlock progress counters + HUD progress ring. */
/** Wave 95 (v5.14–v5.18) — 3D RPG export pack trophies. */

import type { MiniGameMode } from './starterMiniGames'

export type AchievementPackId = MiniGameMode | 'rpg3d'

export const ACHIEVEMENT_STORAGE_PREFIX = 'lotus-engine.achievements'
export const ACHIEVEMENT_PROGRESS_STORAGE_PREFIX = 'lotus-engine.achievements.progress'

export interface AchievementDef {
  id: string
  title: string
  description: string
  icon?: string
  /** Wave 90 — progress-based unlock threshold (current/max). */
  progressMax?: number
}

export interface AchievementProgress {
  current: number
  max: number
}

export interface ExportAchievementsPayload {
  packId: string
  achievements: AchievementDef[]
}

export interface ExportAchievementProgressPayload {
  packId: string
  defaults: Record<string, { max: number }>
}

/** Trophy catalog per mini-game genre — embedded in pack HTML as __LOTUS_ACHIEVEMENTS__. */
export const ACHIEVEMENTS: Record<AchievementPackId, AchievementDef[]> = {
  platformer: [
    {
      id: 'platformer_win',
      title: 'Goal Getter',
      description: 'Reach the goal zone',
      icon: '🏁',
    },
    {
      id: 'platformer_coins',
      title: 'Coin Collector',
      description: 'Collect 10 coins',
      icon: '🪙',
      progressMax: 10,
    },
  ],
  rpg: [
    {
      id: 'rpg_win',
      title: 'Quest Complete',
      description: 'Collect all NPCs or reach the quest zone',
      icon: '⚔️',
    },
    {
      id: 'rpg_collect',
      title: 'NPC Hunter',
      description: 'Collect 3 NPCs',
      icon: '👥',
      progressMax: 3,
    },
  ],
  fps: [
    {
      id: 'fps_win',
      title: 'Sharpshooter',
      description: 'Destroy all target crates',
      icon: '🎯',
    },
    {
      id: 'fps_targets',
      title: 'Target Practice',
      description: 'Destroy 2 targets',
      icon: '🎯',
      progressMax: 2,
    },
  ],
  rpg3d: [
    {
      id: 'quest_complete',
      title: 'Herbalist',
      description: 'Complete the find_herbs quest',
      icon: '🌿',
    },
    {
      id: 'talk_to_elder',
      title: 'Village Welcome',
      description: 'Talk to the village elder',
      icon: '🧙',
    },
  ],
}

let activePackId: AchievementPackId | null = null

export function achievementStorageKey(packId: string): string {
  const safe = String(packId ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 32)
  return `${ACHIEVEMENT_STORAGE_PREFIX}.${safe || 'pack'}`
}

export function achievementProgressStorageKey(packId: string): string {
  const safe = String(packId ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 32)
  return `${ACHIEVEMENT_PROGRESS_STORAGE_PREFIX}.${safe || 'pack'}`
}

function isAchievementPackId(id: string): id is AchievementPackId {
  return id === 'platformer' || id === 'rpg' || id === 'fps' || id === 'rpg3d'
}

export function setAchievementPackId(packId: AchievementPackId | string | null | undefined): string | null {
  const id = String(packId ?? '')
    .trim()
    .toLowerCase()
  if (isAchievementPackId(id)) {
    activePackId = id
    return id
  }
  activePackId = null
  return null
}

export function getAchievementPackId(): AchievementPackId | null {
  return activePackId
}

export function achievementsForPack(packId?: string | null): AchievementDef[] {
  const id = String(packId ?? activePackId ?? '')
    .trim()
    .toLowerCase()
  if (isAchievementPackId(id)) return [...ACHIEVEMENTS[id]]
  return []
}

export function findAchievement(id: string, packId?: string | null): AchievementDef | null {
  const q = String(id ?? '').trim()
  if (!q) return null
  return achievementsForPack(packId).find((a) => a.id === q) ?? null
}

function readUnlockedSet(packId: string): Set<string> {
  try {
    const raw = localStorage.getItem(achievementStorageKey(packId))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.map((v) => String(v)))
  } catch {
    return new Set()
  }
}

function writeUnlockedSet(packId: string, unlocked: Set<string>): void {
  localStorage.setItem(achievementStorageKey(packId), JSON.stringify([...unlocked]))
}

function readProgressMap(packId: string): Record<string, AchievementProgress> {
  try {
    const raw = localStorage.getItem(achievementProgressStorageKey(packId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, AchievementProgress> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const row = value as { current?: unknown; max?: unknown }
      const current = Number(row.current)
      const max = Number(row.max)
      if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) continue
      out[key] = { current: Math.max(0, current), max }
    }
    return out
  } catch {
    return {}
  }
}

function writeProgressMap(packId: string, progress: Record<string, AchievementProgress>): void {
  localStorage.setItem(achievementProgressStorageKey(packId), JSON.stringify(progress))
}

function resolveProgressMax(
  achievement: AchievementDef,
  maxArg: number | undefined,
  stored: AchievementProgress | null,
): number {
  if (typeof maxArg === 'number' && Number.isFinite(maxArg) && maxArg > 0) return Math.floor(maxArg)
  if (stored && stored.max > 0) return stored.max
  if (typeof achievement.progressMax === 'number' && achievement.progressMax > 0) {
    return achievement.progressMax
  }
  return 1
}

export function listUnlocked(packId?: string | null): string[] {
  const id = setAchievementPackId(packId) ?? activePackId
  if (!id) return []
  return [...readUnlockedSet(id)]
}

export function isAchievementUnlocked(id: string, packId?: string | null): boolean {
  const resolvedPack = setAchievementPackId(packId) ?? activePackId
  if (!resolvedPack) return false
  return readUnlockedSet(resolvedPack).has(String(id ?? '').trim())
}

export interface UnlockAchievementResult {
  newlyUnlocked: boolean
  achievement: AchievementDef | null
  packId: string | null
}

/** Persist trophy unlock under lotus-engine.achievements.{packId}. */
export function unlockAchievement(id: string, packId?: string | null): UnlockAchievementResult {
  const resolvedPack = setAchievementPackId(packId) ?? activePackId
  const achievement = findAchievement(id, resolvedPack)
  if (!resolvedPack || !achievement) {
    return { newlyUnlocked: false, achievement: null, packId: resolvedPack }
  }
  const unlocked = readUnlockedSet(resolvedPack)
  if (unlocked.has(achievement.id)) {
    return { newlyUnlocked: false, achievement, packId: resolvedPack }
  }
  unlocked.add(achievement.id)
  writeUnlockedSet(resolvedPack, unlocked)
  return { newlyUnlocked: true, achievement, packId: resolvedPack }
}

export interface SetAchievementProgressResult {
  current: number
  max: number
  newlyUnlocked: boolean
  achievement: AchievementDef | null
  packId: string | null
}

/** Wave 90 — persist partial progress; unlock when current >= max. */
export function setAchievementProgress(
  id: string,
  current: number,
  max?: number,
  packId?: string | null,
): SetAchievementProgressResult {
  const resolvedPack = setAchievementPackId(packId) ?? activePackId
  const achievement = findAchievement(id, resolvedPack)
  if (!resolvedPack || !achievement) {
    return { current: 0, max: 0, newlyUnlocked: false, achievement: null, packId: resolvedPack }
  }

  const progressMap = readProgressMap(resolvedPack)
  const stored = progressMap[achievement.id] ?? null
  const resolvedMax = resolveProgressMax(achievement, max, stored)
  const resolvedCurrent = Math.max(0, Math.min(Math.floor(current), resolvedMax))

  progressMap[achievement.id] = { current: resolvedCurrent, max: resolvedMax }
  writeProgressMap(resolvedPack, progressMap)

  if (resolvedCurrent >= resolvedMax) {
    const unlock = unlockAchievement(achievement.id, resolvedPack)
    return {
      current: resolvedCurrent,
      max: resolvedMax,
      newlyUnlocked: unlock.newlyUnlocked,
      achievement,
      packId: resolvedPack,
    }
  }

  return {
    current: resolvedCurrent,
    max: resolvedMax,
    newlyUnlocked: false,
    achievement,
    packId: resolvedPack,
  }
}

/** Wave 90 — read stored progress counter for an achievement id. */
export function getAchievementProgress(id: string, packId?: string | null): AchievementProgress | null {
  const resolvedPack = setAchievementPackId(packId) ?? activePackId
  const achievement = findAchievement(id, resolvedPack)
  if (!resolvedPack || !achievement) return null

  const stored = readProgressMap(resolvedPack)[achievement.id]
  if (stored) return { ...stored }

  const defaultMax = achievement.progressMax
  if (typeof defaultMax === 'number' && defaultMax > 0) {
    return { current: 0, max: defaultMax }
  }
  return null
}

export function buildExportAchievementsPayload(packId: AchievementPackId): ExportAchievementsPayload {
  return { packId, achievements: [...ACHIEVEMENTS[packId]] }
}

export function buildExportAchievementProgressPayload(packId: AchievementPackId): ExportAchievementProgressPayload {
  const defaults: Record<string, { max: number }> = {}
  for (const a of ACHIEVEMENTS[packId]) {
    if (typeof a.progressMax === 'number' && a.progressMax > 0) {
      defaults[a.id] = { max: a.progressMax }
    }
  }
  return { packId, defaults }
}

export function serializeAchievementsForExport(payload: ExportAchievementsPayload): string {
  return JSON.stringify(payload).replace(/</g, '\\u003c')
}

export function serializeAchievementProgressForExport(payload: ExportAchievementProgressPayload): string {
  return JSON.stringify(payload).replace(/</g, '\\u003c')
}