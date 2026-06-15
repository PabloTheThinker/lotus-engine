/** Wave 95 (v5.14–v5.18) — Full 3D RPG export pack (camera rig + inventory + dialogue + quests). */

import { captureExportScreenshot } from './captureExportScreenshot'
import { buildPlayableHTML, type ExportOptions } from './exportPlayable'
import { setAchievementPackId } from './exportAchievements'
import { scheduleExportPerfProbe } from './exportPerfProbe'
import { enableRpg3dHud } from './rpg3dHud'
import { spawnRpg3dStarter, type Rpg3dStarterMode } from './rpg3dStarter'
import { useEditor } from './store'
import { world } from '../engine/World'
import type { SerializedActor } from '../engine/types'
import { AddActorCommand, runCommand } from './commands'
import { buildSerializedActor } from './spawn'
import { registerItem } from '../engine/rpgInventory'
import {
  MINIGAME_PACK_ICON_B64,
  MINIGAME_PACK_ICON_DATA_URI,
  miniGamePackIconStub,
} from './miniGameExportPack'

export const RPG3D_MANAGER_NAME = 'Rpg3dGameManager'
export const RPG3D_CAMERA_RIG_NAME = 'Rpg3dCameraRig'
export const VILLAGE_ELDER_NAME = 'VillageElder'
export const RPG3D_HERB_GOAL = 3
export const RPG3D_PACK_ID = 'rpg3d' as const
export const RPG3D_HERB_ITEM_ID = 'healing_herb'

export const RPG3D_DIALOGUE_VILLAGE_ELDER = 'village_elder'
export const RPG3D_QUEST_FIND_HERBS = 'find_herbs'
export const RPG3D_HERB_OBJECTIVE_ID = 'collect_herbs'

/** Wave 95 — GameManager wires inventory, dialogue (village_elder), quest (find_herbs), RPG HUD. */
export const RPG3D_GAME_MANAGER_SCRIPT = `// 3D RPG — inventory + dialogue + quest + HUD (wave 95)
// @export herbQuestId = '${RPG3D_QUEST_FIND_HERBS}'
// @export herbObjectiveId = '${RPG3D_HERB_OBJECTIVE_ID}'
// @export herbItemId = '${RPG3D_HERB_ITEM_ID}'
// @export herbGoal = ${RPG3D_HERB_GOAL}
// @export interactRadius = 2.8
let _inventoryOpen = false
let _elderTalked = false
const _herbs = new Set()

function refreshInventoryPanel() {
  const items = []
  const n = api.getItemCount(vars.herbItemId)
  for (let i = 0; i < n; i++) items.push('Healing Herb')
  api.emit('inventory_toggle', _inventoryOpen, items)
}

function onBeginPlay() {
  api.emit('rpg_hud_ready')
  api.emit('hp_update', 1)
  api.emit('quest_update', 'Talk to the Village Elder')
  api.on('quest_started', (q) => {
    const o = q?.objectives?.[0]
    if (q?.id === vars.herbQuestId && o) {
      api.emit('quest_update', q.title + ': ' + o.description)
    }
  })
  api.on('quest_updated', (q) => {
    const o = q?.objectives?.[0]
    if (q?.id === vars.herbQuestId && o) {
      api.emit('quest_update', q.title + ' (' + o.current + '/' + o.count + ')')
    }
  })
  api.on('quest_completed', (q) => {
    if (q?.id !== vars.herbQuestId) return
    api.emit('quest_update', 'Quest complete: herbs delivered!')
    api.unlockAchievement('quest_complete')
    api.emit('game_won')
  })
  api.log('3D RPG ready — Interact with elder, collect herbs, press I for inventory')
}

function onTick(_dt) {
  if (api.keyJustPressed('KeyI')) {
    _inventoryOpen = !_inventoryOpen
    refreshInventoryPanel()
  }

  if (!_elderTalked && api.actionJustPressed('Interact')) {
    const elder = api.getActor('${VILLAGE_ELDER_NAME}')
    const p = api.pawnPosition()
    if (elder && p) {
      const ep = elder.root.getWorldPosition(new THREE.Vector3())
      const dx = ep.x - p.x
      const dz = ep.z - p.z
      const r2 = vars.interactRadius * vars.interactRadius
      if (dx * dx + dz * dz <= r2) {
        _elderTalked = true
        api.unlockAchievement('talk_to_elder')
        api.startQuest(vars.herbQuestId)
      }
    }
  }

  const q = api.getQuestState(vars.herbQuestId)
  if (!q || q.state !== 'active') return
  const p = api.pawnPosition()
  if (!p) return
  const r2 = vars.interactRadius * vars.interactRadius
  for (const herb of api.getActorsByTag('Herb')) {
    if (!herb.root.visible) continue
    const hp = herb.root.getWorldPosition(new THREE.Vector3())
    const dx = hp.x - p.x
    const dz = hp.z - p.z
    if (dx * dx + dz * dz > r2) continue
    herb.root.visible = false
    _herbs.add(herb.name)
    api.addItem(vars.herbItemId)
    api.updateQuestObjective(vars.herbQuestId, vars.herbObjectiveId, _herbs.size)
    if (_inventoryOpen) refreshInventoryPanel()
  }
}
`

const RPG3D_HERB_POSITIONS: [string, [number, number, number]][] = [
  ['Rpg3dHerbA', [-6, 0.4, -4]],
  ['Rpg3dHerbB', [4, 0.4, -6]],
  ['Rpg3dHerbC', [7, 0.4, 3]],
]

function findActorByName(name: string) {
  return [...world.actors.values()].find((a) => a.name === name)
}

function buildDialogueNpc(
  name: string,
  position: [number, number, number],
  dialogueId: string,
): SerializedActor {
  const empty = buildSerializedActor({ kind: 'empty' }, position)
  empty.name = name
  empty.tags = ['DialogueNPC', 'NPC']
  empty.scriptVars = { dialogueId }
  return empty
}

function buildRpgHerb(name: string, position: [number, number, number]): SerializedActor {
  const empty = buildSerializedActor({ kind: 'empty' }, position)
  empty.name = name
  empty.tags = ['Herb', 'Collectible']
  return empty
}

function buildGameManager(): SerializedActor {
  const mgr = buildSerializedActor({ kind: 'empty' }, [0, 0, 0])
  mgr.name = RPG3D_MANAGER_NAME
  mgr.tags = ['rpg3d', 'minigame']
  mgr.script = RPG3D_GAME_MANAGER_SCRIPT
  return mgr
}

/** Attach village elder, herbs, and GameManager to an existing 3D RPG starter scene. */
export function attachRpg3dGamePack() {
  const added: SerializedActor[] = []
  const prevManager = findActorByName(RPG3D_MANAGER_NAME)
  const prevScript = prevManager?.script ?? ''

  runCommand({
    label: 'Attach 3D RPG game pack',
    execute() {
      registerItem({
        id: RPG3D_HERB_ITEM_ID,
        name: 'Healing Herb',
        stackable: true,
        maxStack: 99,
      })

      if (!findActorByName(VILLAGE_ELDER_NAME)) {
        const elder = buildDialogueNpc(VILLAGE_ELDER_NAME, [2, 0.2, 2], RPG3D_DIALOGUE_VILLAGE_ELDER)
        added.push(elder)
        new AddActorCommand(elder).execute()
      }

      for (const [name, pos] of RPG3D_HERB_POSITIONS) {
        if (findActorByName(name)) continue
        const herb = buildRpgHerb(name, pos)
        added.push(herb)
        new AddActorCommand(herb).execute()
      }

      let manager = findActorByName(RPG3D_MANAGER_NAME)
      if (!manager) {
        const mgr = buildGameManager()
        added.push(mgr)
        new AddActorCommand(mgr).execute()
        manager = findActorByName(RPG3D_MANAGER_NAME)
      } else {
        manager.script = RPG3D_GAME_MANAGER_SCRIPT
      }

      useEditor.getState().touch()
    },
    undo() {
      for (const sa of added) {
        const a = world.actors.get(sa.id)
        if (a) world.removeActor(a.id)
      }
      const manager = findActorByName(RPG3D_MANAGER_NAME)
      if (manager) {
        if (prevManager) manager.script = prevScript
        else world.removeActor(manager.id)
      }
      useEditor.getState().touch()
    },
  })
}

/** Spawn 3D RPG starter + GameManager wiring inventory, dialogue, quests, and HUD. */
export function spawnRpg3dGame(mode: Rpg3dStarterMode = 'small') {
  spawnRpg3dStarter(mode)
  attachRpg3dGamePack()
  setAchievementPackId(RPG3D_PACK_ID)
  enableRpg3dHud()
  useEditor.getState().setStatus('3D RPG game ready — Play to explore village')
  useEditor.getState().touch()
}

export function rpg3dPackTitle(): string {
  return 'Lotus 3D RPG Pack'
}

/** Build offline-capable PWA HTML for the 3D RPG template. */
export function buildRpg3dPackHTML(opts: ExportOptions = {}): string {
  const screenshot = opts.packScreenshotB64 ?? captureExportScreenshot().base64
  return buildPlayableHTML({
    ...opts,
    pwa: true,
    rpg3d: true,
    rpgHud: true,
    minigameHud: true,
    achievementPack: RPG3D_PACK_ID,
    packMeta:
      opts.packMeta ?? {
        title: rpg3dPackTitle(),
        description: 'Third-person 3D RPG with dialogue, quests, inventory, and camera rig.',
        tags: ['rpg', '3d', 'adventure', 'dialogue'],
        kind: 'html' as const,
        version: '1.0',
      },
    packScreenshotB64: screenshot,
    pwaIcons: opts.pwaIcons ?? miniGamePackIconStub(),
    quality: opts.quality ?? 'mobile',
  })
}

function downloadPackHtml(filename: string, html: string) {
  const blob = new Blob([html], { type: 'text/html' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
  useEditor.getState().setStatus(`Exported 3D RPG pack: ${a.download}`)
  scheduleExportPerfProbe()
}

/** Spawn 3D RPG preset, then download a single-file PWA pack. */
export function exportRpg3dPack(opts: ExportOptions = {}) {
  spawnRpg3dGame()
  const html = buildRpg3dPackHTML(opts)
  downloadPackHtml('rpg3d.pack.html', html)
}

export { MINIGAME_PACK_ICON_B64, MINIGAME_PACK_ICON_DATA_URI }