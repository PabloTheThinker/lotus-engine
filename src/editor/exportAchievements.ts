/** Wave 85 (v4.64–v4.68) — localStorage trophy unlocks in mini-game export packs. */

import type { MiniGameMode } from './starterMiniGames'

export const ACHIEVEMENT_STORAGE_PREFIX = 'lotus-engine.achievements'

export interface AchievementDef {
  id: string
  title: string
  description: string
  icon?: string
}

export interface ExportAchievementsPayload {
  packId: string
  achievements: AchievementDef[]
}

/** Trophy catalog per mini-game genre — embedded in pack HTML as __LOTUS_ACHIEVEMENTS__. */
export const ACHIEVEMENTS: Record<MiniGameMode, AchievementDef[]> = {
  platformer: [
    {
      id: 'platformer_win',
      title: 'Goal Getter',
      description: 'Reach the goal zone',
      icon: '🏁',
    },
  ],
  rpg: [
    {
      id: 'rpg_win',
      title: 'Quest Complete',
      description: 'Collect all NPCs or reach the quest zone',
      icon: '⚔️',
    },
  ],
  fps: [
    {
      id: 'fps_win',
      title: 'Sharpshooter',
      description: 'Destroy all target crates',
      icon: '🎯',
    },
  ],
}

let activePackId: MiniGameMode | null = null

export function achievementStorageKey(packId: string): string {
  const safe = String(packId ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 32)
  return `${ACHIEVEMENT_STORAGE_PREFIX}.${safe || 'pack'}`
}

export function setAchievementPackId(packId: MiniGameMode | string | null | undefined): string | null {
  const id = String(packId ?? '')
    .trim()
    .toLowerCase()
  if (id === 'platformer' || id === 'rpg' || id === 'fps') {
    activePackId = id
    return id
  }
  activePackId = null
  return null
}

export function getAchievementPackId(): MiniGameMode | null {
  return activePackId
}

export function achievementsForPack(packId?: string | null): AchievementDef[] {
  const id = String(packId ?? activePackId ?? '')
    .trim()
    .toLowerCase()
  if (id === 'platformer' || id === 'rpg' || id === 'fps') return [...ACHIEVEMENTS[id]]
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

export function buildExportAchievementsPayload(packId: MiniGameMode): ExportAchievementsPayload {
  return { packId, achievements: [...ACHIEVEMENTS[packId]] }
}

export function serializeAchievementsForExport(payload: ExportAchievementsPayload): string {
  return JSON.stringify(payload).replace(/</g, '\\u003c')
}