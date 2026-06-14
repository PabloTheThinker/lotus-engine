import { world, sanitizeLevelKey } from '../engine/World'
import { migrateToLevel, setSaveContext } from '../engine/saveSystem'
import type { HudWidget, SerializedLevel } from '../engine/types'
import { hud } from '../engine/gameplay'
import { AddActorCommand, runCommand } from './commands'
import { buildSerializedActor } from './spawn'
import { spawnIndieMpDeathmatch } from './indieMpGameplay'
import { spawnMiniGame } from './starterMiniGames'
import { runSceneTransition, type SceneTransitionKind } from './sceneTransitions'
import { useEditor } from './store'

/** v2.89 — main menu → level select from starter templates. */
export type MainMenuLevelKind = 'platformer' | 'rpg' | 'fps' | 'mpdeathmatch'

export const MAIN_MENU_MANAGER_NAME = 'MainMenuManager'

export interface MainMenuItem {
  kind: MainMenuLevelKind
  label: string
  /** Linked level / export manifest key for api.changeScene / api.loadLevel */
  levelKey: string
}

export const MENU_ITEMS: MainMenuItem[] = [
  { kind: 'platformer', label: 'Platformer', levelKey: 'platformer' },
  { kind: 'rpg', label: 'RPG', levelKey: 'rpg' },
  { kind: 'fps', label: 'FPS', levelKey: 'fps' },
  { kind: 'mpdeathmatch', label: 'MP Deathmatch', levelKey: 'mpdeathmatch' },
]

function menuItem(kind: MainMenuLevelKind): MainMenuItem {
  return MENU_ITEMS.find((m) => m.kind === kind) ?? MENU_ITEMS[0]
}

function findActorByName(name: string) {
  return [...world.actors.values()].find((a) => a.name === name)
}

function removeActorsByName(names: string[]) {
  for (const name of names) {
    const a = findActorByName(name)
    if (a) world.removeActor(a.id)
  }
}

/** HUD widgets authored for World Settings sync during Play. */
export function buildMainMenuHudWidgets(): HudWidget[] {
  const rows: HudWidget[] = [
    {
      id: 'menu_title',
      type: 'text',
      text: 'LOTUS ENGINE',
      anchor: 'center',
      x: 0,
      y: 120,
      size: 32,
      color: '#e8edf4',
    },
    {
      id: 'menu_subtitle',
      type: 'text',
      text: 'Choose a starter level',
      anchor: 'center',
      x: 0,
      y: 168,
      size: 14,
      color: '#9aa4b2',
    },
  ]
  const yStart = 230
  for (let i = 0; i < MENU_ITEMS.length; i++) {
    const item = MENU_ITEMS[i]
    rows.push({
      id: `menu_btn_${item.kind}`,
      type: 'button',
      text: item.label,
      signal: `menu_select:${item.kind}`,
      anchor: 'center',
      x: 0,
      y: yStart + i * 52,
      size: 15,
      color: item.kind === 'mpdeathmatch' ? '#7c3aed' : '#2f80ed',
    })
  }
  return rows
}

/** Play-mode script — DOM/HUD buttons call api.changeScene(levelKey). */
export const MAIN_MENU_SCRIPT = `// main menu — level select (Wave 50)
function onBeginPlay() {
  api.hud.text('menu_title', 'LOTUS ENGINE', { anchor: 'center', y: '18%', size: 32, color: '#e8edf4' })
  api.hud.text('menu_subtitle', 'Choose a starter level', { anchor: 'center', y: '26%', size: 14, color: '#9aa4b2' })
  const items = [
    { kind: 'platformer', id: 'menu_btn_platformer', label: 'Platformer', key: 'platformer', y: '38%', color: '#2f80ed' },
    { kind: 'rpg', id: 'menu_btn_rpg', label: 'RPG', key: 'rpg', y: '47%', color: '#2f80ed' },
    { kind: 'fps', id: 'menu_btn_fps', label: 'FPS', key: 'fps', y: '56%', color: '#2f80ed' },
    { kind: 'mpdeathmatch', id: 'menu_btn_mpdeathmatch', label: 'MP Deathmatch', key: 'mpdeathmatch', y: '65%', color: '#7c3aed' },
  ]
  for (const item of items) {
    api.hud.button(item.id, item.label, () => {
      api.log('Loading ' + item.label + '…')
      api.changeScene(item.key)
    }, { anchor: 'center', y: item.y, size: 15, color: item.color })
    api.on('menu_select:' + item.kind, () => api.changeScene(item.key))
  }
}
`

function buildMainMenuManager(): ReturnType<typeof buildSerializedActor> {
  const empty = buildSerializedActor({ kind: 'empty' }, [0, 0, 0])
  empty.name = MAIN_MENU_MANAGER_NAME
  empty.tags = ['mainmenu']
  empty.script = MAIN_MENU_SCRIPT
  return empty
}

/** Register or replace a linked level snapshot for export / PIE scene switching. */
export function linkStarterLevel(kind: MainMenuLevelKind, level?: SerializedLevel) {
  const key = sanitizeLevelKey(menuItem(kind).levelKey)
  const snapshot = level ?? world.serialize()
  snapshot.name = menuItem(kind).label
  const idx = world.levelLinks.findIndex((l) => sanitizeLevelKey(l.name) === key)
  const link = { name: key, level: JSON.parse(JSON.stringify(snapshot)) as SerializedLevel }
  if (idx >= 0) world.levelLinks[idx] = link
  else world.levelLinks.push(link)
  useEditor.getState().touch()
  return key
}

export type SelectLevelOpts = {
  play?: boolean
  link?: boolean
  /** false skips overlay; string picks fade / slideLeft / slideRight (default fade). */
  transition?: boolean | SceneTransitionKind
  transitionMs?: number
}

/** Spawn starter greybox + mini-game (or MP deathmatch) for the chosen menu item. */
function selectLevelCore(kind: MainMenuLevelKind, opts: SelectLevelOpts = {}) {
  const item = menuItem(kind)
  removeActorsByName([MAIN_MENU_MANAGER_NAME])
  world.hudWidgets = []

  switch (kind) {
    case 'platformer':
      spawnMiniGame('platformer')
      break
    case 'rpg':
      spawnMiniGame('rpg')
      break
    case 'fps':
      spawnMiniGame('fps')
      break
    case 'mpdeathmatch':
      spawnIndieMpDeathmatch()
      break
  }

  if (opts.link !== false) linkStarterLevel(kind)

  const env = world.environment
  if (env.saveSlotsEnabled && env.crossLevelSaves) {
    migrateToLevel(world.levelName)
  }
  setSaveContext({
    levelName: world.levelName,
    enabled: env.saveSlotsEnabled === true,
    cloudBackup: env.cloudSaveBackup === true,
    crossLevelSaves: env.crossLevelSaves === true,
  })

  useEditor.getState().setStatus(`Level selected: ${item.label}`)
  useEditor.getState().touch()
}

function resolveTransitionKind(transition: SelectLevelOpts['transition']): SceneTransitionKind | null {
  if (transition === false) return null
  if (transition === true || transition === undefined) return 'fade'
  return transition
}

/** Spawn + optional Play with fade/slide transition (Wave 55). */
export async function selectLevel(kind: MainMenuLevelKind, opts: SelectLevelOpts = {}) {
  const transitionKind = resolveTransitionKind(opts.transition)
  const ms = opts.transitionMs ?? 400
  const run = async () => {
    selectLevelCore(kind, opts)
    if (opts.play) useEditor.getState().startPlay('pie')
  }
  if (transitionKind) await runSceneTransition(transitionKind, ms, run)
  else await run()
}

/** Fade transition alias for menu → level (Wave 55 bridge). */
export async function fadeToLevel(kind: MainMenuLevelKind, ms = 400) {
  return selectLevel(kind, { transition: 'fade', transitionMs: ms })
}

/** Editor + Play — spawn MainMenuManager and authored HUD menu buttons. */
export function spawnMainMenu() {
  const prevManager = findActorByName(MAIN_MENU_MANAGER_NAME)
  const prevHud = JSON.parse(JSON.stringify(world.hudWidgets)) as HudWidget[]
  const widgets = buildMainMenuHudWidgets()

  runCommand({
    label: 'Main menu flow',
    execute() {
      let manager = findActorByName(MAIN_MENU_MANAGER_NAME)
      if (!manager) {
        const sa = buildMainMenuManager()
        new AddActorCommand(sa).execute()
        manager = findActorByName(MAIN_MENU_MANAGER_NAME)
      } else {
        manager.script = MAIN_MENU_SCRIPT
      }
      world.hudWidgets = widgets
      useEditor.getState().setStatus('Main menu ready — Play or use indie.flow.selectLevel(kind)')
      useEditor.getState().touch()
    },
    undo() {
      if (prevManager) {
        const m = findActorByName(MAIN_MENU_MANAGER_NAME)
        if (m) m.script = prevManager.script
      } else {
        removeActorsByName([MAIN_MENU_MANAGER_NAME])
      }
      world.hudWidgets = prevHud
      useEditor.getState().touch()
    },
  })
}

/** Draw menu buttons into the mounted HUD (devtools / bridge without Play). */
export function paintMainMenuHud() {
  const widgets = buildMainMenuHudWidgets()
  for (const w of widgets) {
    const opts = { anchor: w.anchor, x: w.x, y: w.y, size: w.size, color: w.color }
    if (w.type === 'text') hud.text(w.id, w.text, opts)
    else if (w.type === 'button') {
      const kind = w.signal?.replace('menu_select:', '') as MainMenuLevelKind | undefined
      hud.button(w.id, w.text, () => {
        if (kind) void selectLevel(kind)
      }, opts)
    }
  }
}

/** True when the current level should export with boot main-menu overlay. */
export function mainMenuBootEnabled(): boolean {
  return !!findActorByName(MAIN_MENU_MANAGER_NAME)
}