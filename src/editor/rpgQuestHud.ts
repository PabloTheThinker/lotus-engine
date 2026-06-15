/** Wave 94 (v5.09–v5.13) — active quest + objective progress HUD during Play. */

import type { ScriptApi } from '../engine/scripting'
import type { QuestStateView } from '../engine/rpgQuests'
import { getActiveQuests } from '../engine/rpgQuests'

const TRACKER_ID = 'lotus-rpg-quest-tracker'

export const RPG_QUEST_HUD_CSS = `
  .lotus-rpg-quest-tracker {
    position: fixed; top: 18px; left: 18px; z-index: 28; pointer-events: none;
    min-width: 220px; max-width: 320px;
    padding: 12px 14px; border-radius: 10px;
    background: rgba(13, 15, 18, 0.9); border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
    font: 600 12px system-ui, sans-serif; color: #e8edf4;
    animation: lotus-quest-in 0.28s ease-out;
  }
  .lotus-rpg-quest-title {
    font-size: 13px; font-weight: 800; letter-spacing: 0.03em; color: #7ec8a4;
  }
  .lotus-rpg-quest-objective {
    margin-top: 8px; font-size: 11px; font-weight: 500; color: #c8d0d8; line-height: 1.35;
  }
  .lotus-rpg-quest-progress {
    margin-top: 4px; font-size: 10px; font-weight: 700; color: #9aa4b2;
  }
  .lotus-rpg-quest-bar {
    margin-top: 6px; height: 4px; border-radius: 2px;
    background: rgba(255, 255, 255, 0.1); overflow: hidden;
  }
  .lotus-rpg-quest-bar-fill {
    height: 100%; border-radius: 2px;
    background: linear-gradient(90deg, #46a758, #7ec8a4);
    transition: width 0.2s ease-out;
  }
  @keyframes lotus-quest-in {
    from { opacity: 0; transform: translateX(-8px); }
    to { opacity: 1; transform: translateX(0); }
  }
`

let trackerRoot: HTMLElement | null = null
let wired = false

function trackerHost(parent?: HTMLElement): HTMLElement {
  return parent ?? document.body
}

function primaryObjective(quest: QuestStateView) {
  return quest.objectives[0] ?? null
}

function renderQuestTracker(quest: QuestStateView, parent?: HTMLElement) {
  const obj = primaryObjective(quest)
  if (!obj) {
    hideQuestTracker()
    return
  }
  const pct = obj.count > 0 ? Math.round((obj.current / obj.count) * 100) : 0
  trackerRoot?.remove()
  const host = trackerHost(parent)
  trackerRoot = document.createElement('div')
  trackerRoot.id = TRACKER_ID
  trackerRoot.className = 'lotus-rpg-quest-tracker'
  trackerRoot.innerHTML = `<div class="lotus-rpg-quest-title">📜 ${quest.title}</div>
    <div class="lotus-rpg-quest-objective">${obj.description}</div>
    <div class="lotus-rpg-quest-progress">${obj.current} / ${obj.count}</div>
    <div class="lotus-rpg-quest-bar"><div class="lotus-rpg-quest-bar-fill" style="width:${pct}%"></div></div>`
  host.appendChild(trackerRoot)
}

export function showQuestTracker(quest: QuestStateView, parent?: HTMLElement) {
  renderQuestTracker(quest, parent)
}

export function refreshQuestTracker(parent?: HTMLElement) {
  const active = getActiveQuests()
  if (!active.length) {
    hideQuestTracker()
    return
  }
  renderQuestTracker(active[0], parent)
}

export function hideQuestTracker() {
  trackerRoot?.remove()
  trackerRoot = null
}

function onQuestEvent(payload: unknown) {
  const quest =
    payload && typeof payload === 'object' ? (payload as QuestStateView) : null
  if (quest?.state === 'active') {
    showQuestTracker(quest)
    return
  }
  refreshQuestTracker()
}

/** Listen for quest_started / quest_updated / quest_completed and show tracker. */
export function wireRpgQuestHud(api: Pick<ScriptApi, 'on'>) {
  if (wired) return
  wired = true
  api.on('quest_started', onQuestEvent)
  api.on('quest_updated', onQuestEvent)
  api.on('quest_completed', () => hideQuestTracker())
}

export function unwireRpgQuestHud() {
  wired = false
  hideQuestTracker()
}

export function mountRpgQuestHudForPlay(parent: HTMLElement, api: Pick<ScriptApi, 'on'>) {
  wireRpgQuestHud(api)
  refreshQuestTracker(parent)
}

export function unmountRpgQuestHudForPlay() {
  unwireRpgQuestHud()
}