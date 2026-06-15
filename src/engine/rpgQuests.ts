/** Wave 94 (v5.09–v5.13) — Godot-style quest log / objective tracker (lite). */

export type QuestState = 'inactive' | 'active' | 'completed' | 'failed'

export interface QuestObjectiveDef {
  id: string
  description: string
  count: number
  /** Gameplay tag to match (e.g. Herb, NPC). */
  target: string
}

export interface QuestDef {
  id: string
  title: string
  objectives: QuestObjectiveDef[]
}

export interface QuestObjectiveRuntime {
  id: string
  current: number
  count: number
}

export interface QuestRuntime {
  id: string
  state: QuestState
  objectives: QuestObjectiveRuntime[]
}

export interface QuestStateView extends QuestRuntime {
  title: string
  objectives: Array<QuestObjectiveRuntime & { description: string; target: string }>
}

export interface QuestCheckpointData {
  version: 1
  quests: Record<string, QuestRuntime>
}

/** Built-in quest catalog — extend via registerQuestDef for custom packs. */
export const QUEST_DEFS: Record<string, QuestDef> = {
  find_herbs: {
    id: 'find_herbs',
    title: 'Find Herbs',
    objectives: [
      {
        id: 'collect_herbs',
        description: 'Collect 3 herbs',
        count: 3,
        target: 'Herb',
      },
    ],
  },
}

const questRuntime = new Map<string, QuestRuntime>()

export function listQuestDefs(): QuestDef[] {
  return Object.values(QUEST_DEFS)
}

export function findQuestDef(id: string): QuestDef | null {
  const q = String(id ?? '').trim()
  return q ? (QUEST_DEFS[q] ?? null) : null
}

/** Register or override a quest definition at runtime (editor / export packs). */
export function registerQuestDef(def: QuestDef): void {
  const id = String(def.id ?? '').trim()
  if (!id) return
  QUEST_DEFS[id] = { ...def, id, objectives: def.objectives.map((o) => ({ ...o })) }
}

function buildRuntime(def: QuestDef, state: QuestState, progress?: QuestRuntime): QuestRuntime {
  return {
    id: def.id,
    state,
    objectives: def.objectives.map((o) => {
      const prev = progress?.objectives.find((p) => p.id === o.id)
      return {
        id: o.id,
        current: Math.max(0, Math.min(prev?.current ?? 0, o.count)),
        count: o.count,
      }
    }),
  }
}

function enrichQuestView(runtime: QuestRuntime): QuestStateView | null {
  const def = findQuestDef(runtime.id)
  if (!def) return null
  return {
    ...runtime,
    title: def.title,
    objectives: runtime.objectives.map((o) => {
      const od = def.objectives.find((d) => d.id === o.id)
      return {
        ...o,
        description: od?.description ?? o.id,
        target: od?.target ?? '',
      }
    }),
  }
}

export function resetQuests(): void {
  questRuntime.clear()
}

export function startQuest(id: string): boolean {
  const def = findQuestDef(id)
  if (!def) return false
  const existing = questRuntime.get(id)
  if (existing?.state === 'active' || existing?.state === 'completed') return false
  questRuntime.set(id, buildRuntime(def, 'active', existing))
  return true
}

export function updateObjective(questId: string, objectiveId: string, current: number): boolean {
  const runtime = questRuntime.get(questId)
  if (!runtime || runtime.state !== 'active') return false
  const obj = runtime.objectives.find((o) => o.id === objectiveId)
  if (!obj) return false
  obj.current = Math.max(0, Math.min(Math.floor(current), obj.count))
  if (runtime.objectives.every((o) => o.current >= o.count)) {
    runtime.state = 'completed'
  }
  return true
}

export function completeQuest(id: string): boolean {
  const runtime = questRuntime.get(id)
  if (!runtime || runtime.state !== 'active') return false
  for (const o of runtime.objectives) o.current = o.count
  runtime.state = 'completed'
  return true
}

export function failQuest(id: string): boolean {
  const runtime = questRuntime.get(id)
  if (!runtime || runtime.state !== 'active') return false
  runtime.state = 'failed'
  return true
}

export function getQuestState(id: string): QuestStateView | null {
  const runtime = questRuntime.get(id)
  if (!runtime) return null
  return enrichQuestView(runtime)
}

export function getActiveQuests(): QuestStateView[] {
  const out: QuestStateView[] = []
  for (const runtime of questRuntime.values()) {
    if (runtime.state !== 'active') continue
    const view = enrichQuestView(runtime)
    if (view) out.push(view)
  }
  return out
}

export function serializeQuestState(): QuestCheckpointData {
  const quests: Record<string, QuestRuntime> = {}
  for (const [id, runtime] of questRuntime) {
    quests[id] = {
      id: runtime.id,
      state: runtime.state,
      objectives: runtime.objectives.map((o) => ({ ...o })),
    }
  }
  return { version: 1, quests }
}

export function restoreQuestState(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const raw = data as { version?: number; quests?: Record<string, QuestRuntime> }
  if (!raw.quests || typeof raw.quests !== 'object') return false
  questRuntime.clear()
  for (const [id, runtime] of Object.entries(raw.quests)) {
    const def = findQuestDef(id)
    if (!def || !runtime || typeof runtime !== 'object') continue
    const state = runtime.state
    if (state !== 'active' && state !== 'completed' && state !== 'failed' && state !== 'inactive') continue
    questRuntime.set(id, {
      id,
      state,
      objectives: def.objectives.map((o) => {
        const prev = runtime.objectives?.find((p) => p.id === o.id)
        const current = Math.max(0, Math.min(Math.floor(prev?.current ?? 0), o.count))
        return { id: o.id, current, count: o.count }
      }),
    })
  }
  return true
}

/** Merge quest checkpoint blob from arbitrary save payload. */
export function restoreQuestsFromSavePayload(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const quests = (data as { quests?: unknown }).quests
  if (quests === undefined) return false
  return restoreQuestState(quests)
}