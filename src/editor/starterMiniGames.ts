import { world } from '../engine/World'
import type { SerializedActor } from '../engine/types'
import { AddActorCommand, runCommand } from './commands'
import { buildSerializedActor } from './spawn'
import {
  spawnFpsStarter,
  spawnPlatformerStarter,
  spawnTopDownRpgStarter,
  type PlatformerStarterMode,
  type TopDownRpgStarterMode,
} from './starterTemplates'
import { setAchievementPackId } from './exportAchievements'
import { enableMiniGameHud } from './miniGameHud'
import { useEditor } from './store'

export type MiniGameMode = 'platformer' | 'rpg' | 'fps'

export const MINIGAME_MANAGER_NAME = 'MiniGameManager'
export const GOAL_ZONE_NAME = 'GoalZone'
export const FPS_TARGET_TAG = 'Target'
export const RPG_NPC_GOAL = 3
export const PLATFORMER_COIN_GOAL = 10

/** Optional countdown — 0 disables timeout. */
export const MINIGAME_TIMEOUT_EXPORT = `// @export timeoutSeconds = 0`

function miniGameTimeoutBlock(): string {
  return `  if (vars.timeoutSeconds > 0) {
    api.setTimer(vars.timeoutSeconds, () => {
      api.log('Time up!')
      api.emit('game_lost')
    })
  }`
}

/** v2.50 — reach GoalZone TriggerVolume → emit game_won. */
export const PLATFORMER_MINIGAME_SCRIPT = `// platformer minigame — reach GoalZone + collect coins
// @export coinGoal = ${PLATFORMER_COIN_GOAL}
// @export collectRadius = 1.2
${MINIGAME_TIMEOUT_EXPORT}
const _coins = new Set()
function onBeginPlay() {
${miniGameTimeoutBlock()}
  api.on('enter:${GOAL_ZONE_NAME}', () => {
    api.log('Goal reached!')
    api.emit('game_won')
    api.unlockAchievement('platformer_win')
  })
}
function onTick(_dt) {
  const p = api.pawnPosition()
  if (!p) return
  const r2 = vars.collectRadius * vars.collectRadius
  for (const coin of api.getActorsByTag('Coin')) {
    if (!coin.root.visible) continue
    const cp = coin.root.getWorldPosition(new THREE.Vector3())
    const dx = cp.x - p.x
    const dz = cp.z - p.z
    if (dx * dx + dz * dz > r2) continue
    coin.root.visible = false
    _coins.add(coin.name)
    api.log('Coin collected (' + _coins.size + '/' + vars.coinGoal + ')')
    api.setAchievementProgress('platformer_coins', _coins.size, vars.coinGoal)
  }
}
`

/** v2.51 — collect ${RPG_NPC_GOAL} NPC tags or enter quest zone → game_won. */
export const RPG_MINIGAME_SCRIPT = `// rpg minigame — collect NPCs or reach quest zone
// @export npcGoal = ${RPG_NPC_GOAL}
// @export collectRadius = 1.5
${MINIGAME_TIMEOUT_EXPORT}
const _collected = new Set()
function onBeginPlay() {
${miniGameTimeoutBlock()}
  api.on('enter:RpgQuestZone', () => {
    api.log('Quest zone reached!')
    api.emit('game_won')
    api.unlockAchievement('rpg_win')
  })
}
function onTick(_dt) {
  const p = api.pawnPosition()
  if (!p) return
  const r2 = vars.collectRadius * vars.collectRadius
  for (const npc of api.getActorsByTag('NPC')) {
    if (!npc.root.visible) continue
    const np = npc.root.getWorldPosition(new THREE.Vector3())
    const dx = np.x - p.x
    const dz = np.z - p.z
    if (dx * dx + dz * dz > r2) continue
    npc.root.visible = false
    _collected.add(npc.name)
    api.log('Collected ' + npc.name + ' (' + _collected.size + '/' + vars.npcGoal + ')')
    api.setAchievementProgress('rpg_collect', _collected.size, vars.npcGoal)
  }
  if (_collected.size >= vars.npcGoal) {
    api.emit('game_won')
    api.unlockAchievement('rpg_win')
  }
}
`

/** v2.52 — destroy 2 target crates (hide on Fire raycast hit) → game_won. */
export const FPS_MINIGAME_SCRIPT = `// fps minigame — shoot Target crates
// @export targetsToWin = 2
// @export shootRange = 30
${MINIGAME_TIMEOUT_EXPORT}
let _destroyed = 0
function onBeginPlay() {
${miniGameTimeoutBlock()}
}
function onTick(_dt) {
  if (!api.actionJustPressed('Fire')) return
  const p = api.pawnPosition()
  if (!p) return
  const origin = [p.x, p.y + 1.6, p.z]
  const hit = api.raycast(origin, [0, 0, 1], vars.shootRange)
  if (!hit || !hit.actor.tags.includes('${FPS_TARGET_TAG}')) return
  if (!hit.actor.root.visible) return
  hit.actor.root.visible = false
  _destroyed++
  api.log('Target destroyed (' + _destroyed + '/' + vars.targetsToWin + ')')
  api.setAchievementProgress('fps_targets', _destroyed, vars.targetsToWin)
  if (_destroyed >= vars.targetsToWin) {
    api.emit('game_won')
    api.unlockAchievement('fps_win')
  }
}
`

function findActorByName(name: string) {
  return [...world.actors.values()].find((a) => a.name === name)
}

function goalZonePosition(): [number, number, number] {
  const floor = findActorByName('PlatformerFloor')
  const wide = (floor?.transform.scale[0] ?? 18) >= 20
  return wide ? [9, 2.4, 0] : [7, 2.4, 0]
}

function buildGoalZone(): SerializedActor {
  const trig = buildSerializedActor({ kind: 'trigger' }, goalZonePosition())
  trig.name = GOAL_ZONE_NAME
  trig.transform.scale = [2, 2, 2]
  trig.material = {
    color: '#46a758',
    roughness: 0.7,
    metalness: 0.05,
    emissive: '#1a3d2a',
    emissiveIntensity: 0.6,
    wireframe: false,
    opacity: 0.55,
    transparent: true,
  }
  return trig
}

function buildMiniGameManager(script: string): SerializedActor {
  const empty = buildSerializedActor({ kind: 'empty' }, [0, 0, 0])
  empty.name = MINIGAME_MANAGER_NAME
  empty.tags = ['minigame']
  empty.script = script
  return empty
}

function buildExtraRpgNpc(name: string, position: [number, number, number]): SerializedActor {
  const empty = buildSerializedActor({ kind: 'empty' }, position)
  empty.name = name
  empty.tags = ['NPC']
  return empty
}

const PLATFORMER_COIN_POSITIONS: [number, number, number][] = [
  [-6, 1.2, 0],
  [-4, 1.2, 0],
  [-2, 1.6, 0],
  [0, 2.0, 0],
  [2, 2.4, 0],
  [4, 2.4, 0],
  [6, 1.6, 0],
  [-1, 0.6, 0],
  [1, 0.6, 0],
  [3, 1.0, 0],
]

function buildPlatformerCoin(name: string, position: [number, number, number]): SerializedActor {
  const empty = buildSerializedActor({ kind: 'empty' }, position)
  empty.name = name
  empty.tags = ['Coin']
  return empty
}

function scriptForMode(mode: MiniGameMode): string {
  switch (mode) {
    case 'platformer':
      return PLATFORMER_MINIGAME_SCRIPT
    case 'rpg':
      return RPG_MINIGAME_SCRIPT
    case 'fps':
      return FPS_MINIGAME_SCRIPT
  }
}

/**
 * Attach win-condition scripts and mini-game actors to the current greybox scene.
 * Idempotent: reuses MiniGameManager / GoalZone when already present.
 */
export function attachMiniGameScripts(mode: MiniGameMode) {
  const script = scriptForMode(mode)
  const prevManager = findActorByName(MINIGAME_MANAGER_NAME)
  const prevManagerScript = prevManager?.script ?? ''
  const prevGoalId = findActorByName(GOAL_ZONE_NAME)?.id
  const prevTargetTags = ['FpsCrateA', 'FpsCrateB'].map((name) => {
    const a = findActorByName(name)
    return a ? { id: a.id, tags: [...a.tags] } : null
  })
  const prevExtraNpcs = [...world.actors.values()]
    .filter((a) => a.name === 'RpgNpcC' || a.name === 'RpgNpcE')
    .map((a) => a.id)
  const addedSerialized: SerializedActor[] = []

  runCommand({
    label: `Attach mini-game (${mode})`,
    execute() {
      let manager = findActorByName(MINIGAME_MANAGER_NAME)
      if (!manager) {
        const sa = buildMiniGameManager(script)
        addedSerialized.push(sa)
        new AddActorCommand(sa).execute()
        manager = findActorByName(MINIGAME_MANAGER_NAME)
      } else {
        manager.script = script
      }

      if (mode === 'platformer') {
        if (!findActorByName(GOAL_ZONE_NAME)) {
          const goal = buildGoalZone()
          addedSerialized.push(goal)
          new AddActorCommand(goal).execute()
        }
        for (let i = 0; i < PLATFORMER_COIN_POSITIONS.length; i++) {
          const name = `PlatformerCoin${String.fromCharCode(65 + i)}`
          if (findActorByName(name)) continue
          const coin = buildPlatformerCoin(name, PLATFORMER_COIN_POSITIONS[i])
          addedSerialized.push(coin)
          new AddActorCommand(coin).execute()
        }
      }

      if (mode === 'rpg') {
        const npcCount = [...world.actors.values()].filter((a) => a.tags.includes('NPC')).length
        let missing = RPG_NPC_GOAL - npcCount
        const candidates: [string, [number, number, number]][] = [
          ['RpgNpcC', [-5, 0, 4]],
          ['RpgNpcE', [0, 0, -5]],
        ]
        for (const [name, pos] of candidates) {
          if (missing <= 0) break
          if (findActorByName(name)) continue
          const npc = buildExtraRpgNpc(name, pos)
          addedSerialized.push(npc)
          new AddActorCommand(npc).execute()
          missing--
        }
      }

      if (mode === 'fps') {
        for (const name of ['FpsCrateA', 'FpsCrateB']) {
          const crate = findActorByName(name)
          if (crate && !crate.tags.includes(FPS_TARGET_TAG)) crate.tags.push(FPS_TARGET_TAG)
        }
      }

      useEditor.getState().setStatus(`Mini-game ready: ${mode}`)
      useEditor.getState().touch()
    },
    undo() {
      for (const sa of addedSerialized) {
        const a = world.actors.get(sa.id)
        if (a) world.removeActor(a.id)
      }
      if (prevGoalId && !world.actors.has(prevGoalId)) {
        // goal was added in this command — already removed via addedSerialized
      }
      const manager = findActorByName(MINIGAME_MANAGER_NAME)
      if (manager) {
        if (prevManager) manager.script = prevManagerScript
        else world.removeActor(manager.id)
      }
      for (const snap of prevTargetTags) {
        if (!snap) continue
        const a = world.actors.get(snap.id)
        if (a) a.tags = [...snap.tags]
      }
      for (const id of prevExtraNpcs) {
        if (world.actors.has(id)) world.removeActor(id)
      }
      useEditor.getState().touch()
    },
  })
}

/** Spawn the greybox starter for mode, then attach mini-game scripts and actors. */
export function spawnMiniGame(mode: MiniGameMode, variant?: string) {
  switch (mode) {
    case 'platformer':
      spawnPlatformerStarter((variant as PlatformerStarterMode) || 'side')
      break
    case 'rpg':
      spawnTopDownRpgStarter((variant as TopDownRpgStarterMode) || 'small')
      break
    case 'fps':
      spawnFpsStarter()
      break
  }
  attachMiniGameScripts(mode)
  setAchievementPackId(mode)
  enableMiniGameHud()
}