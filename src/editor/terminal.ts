import { consoleSuggestions, execConsoleCommand } from './consoleCommands'
import { getPluginConsoleCommands } from './plugins'
import * as THREE from 'three'

import { world } from '../engine/World'
import { makeScriptApi } from '../engine/scripting'
import type { GeometryKind } from '../engine/types'
import { DeleteActorCommand, redo, runCommand, undo } from './commands'
import { saveMaterialFromProps } from '../engine/materialAssets'
import type { Actor } from '../engine/Actor'
import { DEFAULT_MATERIAL, type MaterialProps } from '../engine/types'
import { assignMaterialAsset, patchMaterialOverrides } from './materialCommands'
import { spawnAsset } from './spawn'
import {
  spawnIndieMpDeathmatch,
  spawnIndieMpLobby,
  spawnIndieMpSpectator,
  spawnIndieMpTeamsDeathmatch,
  spawnIndieMpCtf,
} from './indieMpGameplay'
import { spawnIndieMpTemplate } from './indieMpTemplate'
import { exportMiniGamePreset } from './exportPlayable'
import { buildExportPackMeta, type ItchVersionChannel } from './exportPackMeta'
import { buildButlerPushCommand, storeLastItchZipName } from './itchButlerHint'
import { buildReleaseNotes } from './itchReleaseNotes'
import { buildItchEmbedWidgetSections, ITCH_EMBED_WIDGET_FILENAME } from './itchEmbedWidget'
import { buildPackChangelogHtml } from './packChangelogHtml'
import { exportItchUploadPack, itchPackZipFilename } from './itchUploadPack'
import { exportMiniGamePack } from './miniGameExportPack'
import { buildRpg3dPackHTML, spawnRpg3dGame } from './rpg3dExportPack'
import { buildRpgOverworldPackHTML } from './rpgOverworldExportPack'
import { spawnRpgOverworldStarter } from './rpgOverworldStarter'
import { RPG_INTERIOR_LEVEL_KEY } from '../engine/rpgPortals'
import { spawnMainMenu } from './mainMenuFlow'
import { spawnMiniGame } from './starterMiniGames'
import { spawnRpg3dStarter } from './rpg3dStarter'
import { spawnCharacterStarter, spawnFpsStarter, spawnPlatformerStarter, spawnTopDownRpgStarter } from './starterTemplates'
import {
  bakeNavMeshLayers,
  combinedNavmeshLayerMask,
  DEFAULT_GRID_NAVMESH_LAYER_MASK,
  layerMaskFromIndex,
} from '../engine/gridNavmeshBake'
import {
  clampGridNavLayer,
  spawnGridNavAgent,
  spawnGridNavChaseAgent,
  spawnGridNavPatrolAgent,
} from '../engine/gridNavAgents'
import { gridNavPathFind, gridNavPathShowDebug } from '../engine/gridNavPathDebug'
import { lastBakeError } from '../engine/nav'
import {
  exportCloudSaveJson,
  importCloudSaveJson,
} from '../engine/cloudSaveSync'
import { setSaveContext } from '../engine/saveSystem'
import { addGold, addItem, ensurePlayerRpgActor, getGold, getItemCount, getInventory } from '../engine/rpgInventory'
import { canCraft, craft, ensureDefaultCraftingItems, findRecipe } from '../engine/rpgCrafting'
import { ensureDefaultLootTables } from '../engine/rpgLoot'
import {
  dealDamage,
  ensureCombatActor,
  ensurePlayerCombatTag,
  getActorHealth,
  getIFramesRemaining,
  isAlive,
  isInvincible,
  listDamageNumbers,
} from '../engine/rpgCombat'
import { registerEnemy } from '../engine/rpgEnemyAi'
import { buildSerializedActor } from './spawn'
import { AddActorCommand } from './commands'
import { equip, getEquipped, getEquipmentDef } from '../engine/rpgEquipment'
import { startDialogue, setRpgDialogueUiListener } from '../engine/rpgDialogue'
import { findQuestDef, getQuestState, startQuest } from '../engine/rpgQuests'
import { mountRpgDialogueUi, renderRpgDialogueUi } from './rpgDialogueUi'
import {
  attachSampleCombatOneshot,
  COMBAT_ONESHOT_ATTACK_NAME,
  getCombatRootMotionSpeed,
} from '../engine/animStateMachine'
import {
  getArmorVisualId,
  getWeaponVisualId,
  syncEquipmentVisuals,
} from '../engine/rpgEquipmentVisuals'
import {
  hidePortalLoading,
  portalCinematicOut,
  portalLabelForTarget,
  showPortalLoading,
} from '../engine/rpgPortalTransitions'
import { buyItem, canBuy, DEFAULT_SHOP_ID, ensureDefaultShops, getShop } from '../engine/rpgShop'
import { priceBreakdown, resolveBuyPrice } from '../engine/rpgShopEconomy'
import { openVendorShop, VENDOR_NPC_TAG } from '../engine/rpgVendorNpc'
import { previewRpgDamageHud } from './rpgDamageHud'
import { previewRpg3dShop } from './rpg3dHud'
import { useEditor } from './store'

const HISTORY_KEY = 'lotus-engine.terminal.history'
const MAX_HISTORY = 100

export interface TerminalResult {
  output: string | null
  error: string | null
  level: 'log' | 'error'
}

export const TERMINAL_HELP = `Vektra Terminal — in-editor command line (UE Output Log + ~ console)

SLASH COMMANDS
  /help              This reference
  /clear             Clear the output log
  /ls [filter]       List actors (name, type, tags)
  /find <name>       Find actor by name (partial match)
  /select <name>     Select actor in outliner + viewport
  /spawn <shape>     Spawn primitive at origin (box, sphere, …)
  /delete <name>     Delete actor (undoable)
  /play              Start Play In Editor
  /stop              Stop Play / Simulate
  /simulate          Start Simulate mode
  /undo  /redo       Undo / redo last editor action
  /pos <name>        Print actor world position
  /tag <name> <tag>  Add tag to actor
  /starter [mode]    Greybox CharacterBody scene (thirdperson|firstperson|fly)
  /platformer [mode] Greybox platformer scene (side|wide)
  /rpg [mode]        Greybox top-down RPG scene (small|large)
  /rpg3d [mode]      Greybox 3D third-person RPG scene (small|large)
  /fps               Greybox FPS corridor scene
  /minigame <mode>   Playable mini-game starter (platformer|rpg|fps) with win condition
  /minigameexport <mode>  Export playable HTML for platformer|rpg|fps preset
  /exportrpg              Spawn 3D RPG village + GameManager (inventory, dialogue, quests)
  /rpg3dexport            Build 3D RPG pack HTML snippet (__LOTUS_RPG_3D__ + __LOTUS_RPG_HUD__)
  /rpgoverworld           Spawn 2×2 streaming overworld + interior portal (changeScene)
  /exportpack <mode>      Export PWA mini-game pack (platformer|rpg|fps) with manifest + icons + meta
  /exportpackmeta <mode>  Show itch.io pack metadata JSON (platformer|rpg|fps)
  /itchpack <mode>        Download itch.io zip (index.html + meta.json + icon.png + RELEASE_NOTES.md + CHANGELOG.html)
  /releasenotes <mode>    Print itch.io release notes markdown (platformer|rpg|fps)
  /packchangelog <mode>   Print itch.io changelog HTML snippet (platformer|rpg|fps)
  /itchembed <mode>       Print itch.io embed widget path + HTML snippet (platformer|rpg|fps)
  /butlerhint <mode> [ch] Print Butler CLI push command + pack meta (ch: html|beta|demo)
  /mpstarter         Greybox indie multiplayer scene (host + client spawns, sync crates)
  /mpdeathmatch      Indie MP deathmatch (targets, scoreboard, first to 3 wins)
  /mplobby           Indie MP lobby (room browser + ready-up before deathmatch)
  /mpspectator       Indie MP spectator arena (orbit host, no pawn spawn)
  /mpteams           Indie MP teams deathmatch (red vs blue, friendly fire off)
  /mpctf             Indie MP capture-the-flag (teams template, flag pickup/capture)
  /mainmenu          Main menu → level select (Platformer, RPG, FPS, MP Deathmatch)
  /dialogue [treeId] Start RPG dialogue overlay (default: village_elder)
  /quest start <id>    Start RPG quest (demo: find_herbs — collect 3 Herb tags)
  /gridnavmesh [0-3] Bake Recast navmesh from grid tile layers (mask from foliage or layer arg)
  /gridnavagent [0-3] Spawn test crowd agent on grid navmesh layer (Play to tick)
  /gridnavai patrol|chase [0-3] Spawn grid nav agent with patrol or chase AI (tag: grid_nav_target)
  /gridnavpath [0-3]   Bake grid navmesh layer and find test path [0,1,0] → [8,1,8] with debug overlay
  /inventory           Demo: add Health Potion + 50 gold to player inventory (PlayerStart + GAS)
  /craft <recipeId>    Craft item from recipe (demo: health_potion — 2× herb)
  /combatanim          Attach sample Attack oneshot FSM to selected actor or PlayerStart
  /combat              Demo: spawn Enemy + deal test damage (GAS Health + nav chase)
  /equip <itemId>      Equip iron_sword / leather_helm (adds item if missing, applies GAS modifiers)
  /combatpolish        Demo i-frames + floating damage numbers on CombatTestEnemy
  /equipvisual         Equip iron_sword and attach socket weapon mesh
  /portaltrans [level] Preview portal loading label overlay
  /rootmotion          Show Attack oneshot rootMotionSpeed on PlayerStart
  /shop buy <itemId>   Buy from village_vendor (gold + inventory)
  /damagehud           Preview screen-space damage number floaters on RPG HUD
  /vendor              Spawn Vendor NPC + preview shop panel (village_vendor)
  /armorvisual         Equip leather_helm + leather_chest socket meshes
  /portalcine [level]  Slide portal cinematic + preload progress ring preview
  /shopprice <itemId>  Show quest-linked buy price breakdown (demo: herb with find_herbs)
  /cloudsave export       Print full cloud save JSON (IndexedDB checkpoints)
  /cloudsave import <json> Import cloud save JSON into IndexedDB (same level)

JAVASCRIPT (world, api, THREE, editor helpers in scope)
  world.actors.size
  find('Crate1')
  select('Sun')
  spawn('sphere', [0, 2, 0])
  createMaterial('MyMat', { color: '#e5484d' })
  assignMaterial('Box', mat.id)
  setMaterialOverrides('Box', { color: '#46a758' })
  actors().filter(a => a.type === 'StaticMesh').map(a => a.name)
  play() / stop()
  runCommand, undo, redo, useEditor

Shortcuts: \` (backtick) focus terminal · Enter run · Shift+Enter newline · ↑/↓ history · Tab complete`

const MESH_SHAPES: GeometryKind[] = ['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus', 'capsule', 'icosahedron']

export function loadTerminalHistory(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.slice(-MAX_HISTORY) : []
  } catch {
    return []
  }
}

export function saveTerminalHistory(lines: string[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(lines.slice(-MAX_HISTORY)))
}

function findActor(query: string): Actor | undefined {
  const q = query.toLowerCase()
  return (
    world.actors.get(query) ??
    [...world.actors.values()].find((a) => a.name.toLowerCase() === q) ??
    [...world.actors.values()].find((a) => a.name.toLowerCase().includes(q))
  )
}

function makeScope() {
  const api = makeScriptApi(world.actors, () => world.playClock, () => world.pawnPosition)
  const actors = () => [...world.actors.values()]
  const find = (name: string) => findActor(name)
  const select = (nameOrId: string) => {
    const a = findActor(nameOrId)
    if (!a) throw new Error(`Actor not found: ${nameOrId}`)
    useEditor.getState().select(a.id)
    useEditor.getState().touch()
    return a
  }
  const spawn = (shape: string, position: [number, number, number] = [0, 0.5, 0]) => {
    const geom = shape.toLowerCase() as GeometryKind
    if (!MESH_SHAPES.includes(geom)) throw new Error(`Unknown shape "${shape}". Try: ${MESH_SHAPES.join(', ')}`)
    spawnAsset({ kind: 'mesh', geometry: geom }, position)
    useEditor.getState().touch()
    const id = useEditor.getState().selectedId
    return id ? world.actors.get(id) : undefined
  }
  const play = () => useEditor.getState().startPlay('pie')
  const stop = () => useEditor.getState().stopPlay()
  const simulate = () => useEditor.getState().startPlay('simulate')
  const createMaterial = (name: string, props?: Partial<MaterialProps>) =>
    saveMaterialFromProps(name, { ...DEFAULT_MATERIAL, ...props })
  const assignMaterial = (nameOrId: string, materialId: string) => {
    const a = findActor(nameOrId)
    if (!a) throw new Error(`Actor not found: ${nameOrId}`)
    assignMaterialAsset(a.id, materialId)
    return a
  }
  const setMaterialOverrides = (nameOrId: string, overrides: Partial<MaterialProps>) => {
    const a = findActor(nameOrId)
    if (!a) throw new Error(`Actor not found: ${nameOrId}`)
    if (!a.materialAssetId) throw new Error(`${a.name} has no material asset — use assignMaterial first`)
    patchMaterialOverrides(a, (prev) => ({ ...prev, ...overrides }), 'Terminal material override')
    return a
  }

  return {
    world,
    api,
    THREE,
    useEditor,
    runCommand,
    undo,
    redo,
    actors,
    find,
    select,
    spawn,
    play,
    stop,
    simulate,
    createMaterial,
    assignMaterial,
    setMaterialOverrides,
  }
}

export function formatTerminalValue(value: unknown): string {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof THREE.Vector3) {
    return `Vector3(${value.x.toFixed(3)}, ${value.y.toFixed(3)}, ${value.z.toFixed(3)})`
  }
  if (value instanceof THREE.Euler) {
    return `Euler(${THREE.MathUtils.radToDeg(value.x).toFixed(1)}°, ${THREE.MathUtils.radToDeg(value.y).toFixed(1)}°, ${THREE.MathUtils.radToDeg(value.z).toFixed(1)}°)`
  }
  if (value instanceof THREE.Object3D) {
    const p = value.position
    return `${value.type} "${value.name}" @ [${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}]`
  }
  if (typeof value === 'object' && value && 'id' in value && 'name' in value && 'type' in value && 'transform' in value) {
    const a = value as Actor
    const pos = a.transform.position.map((v: number) => v.toFixed(2))
    const tags = a.tags.length ? ` tags=[${a.tags.join(',')}]` : ''
    return `Actor "${a.name}" (${a.type}) pos=[${pos.join(', ')}]${tags}`
  }
  if (value instanceof Map) {
    const rows = [...value.entries()].slice(0, 40).map(([k, v]) => `  ${String(k)}: ${formatTerminalValue(v)}`)
    const more = value.size > 40 ? `\n  … +${value.size - 40} more` : ''
    return `Map(${value.size}) {\n${rows.join('\n')}${more}\n}`
  }
  if (Array.isArray(value)) {
    if (value.length <= 20) return JSON.stringify(value, null, 1)
    return `[${value.slice(0, 20).map((v) => formatTerminalValue(v)).join(', ')} … +${value.length - 20}]`
  }
  try {
    const json = JSON.stringify(
      value,
      (_k, v) => {
        if (v instanceof THREE.Vector3) return { x: v.x, y: v.y, z: v.z }
        if (v instanceof THREE.Object3D) return v.type + ':' + v.name
        return v
      },
      1,
    )
    return json.length > 3000 ? json.slice(0, 3000) + '\n… (truncated)' : json
  } catch {
    return String(value)
  }
}

function runSlash(parts: string[]): TerminalResult {
  const cmd = parts[0]?.toLowerCase()
  const args = parts.slice(1)

  switch (cmd) {
    case '/help':
    case '/?':
      return { output: TERMINAL_HELP, error: null, level: 'log' }
    case '/clear':
      useEditor.getState().clearConsole()
      return { output: null, error: null, level: 'log' }
    case '/ls':
    case '/list': {
      const filter = args.join(' ').toLowerCase()
      const rows = [...world.actors.values()]
        .filter((a) => !filter || a.name.toLowerCase().includes(filter) || a.type.toLowerCase().includes(filter) || a.tags.some((t) => t.toLowerCase().includes(filter)))
        .map((a) => {
          const p = a.transform.position.map((v) => v.toFixed(1))
          const tags = a.tags.length ? ` [${a.tags.join(', ')}]` : ''
          return `  ${a.name.padEnd(22)} ${a.type.padEnd(16)} (${p.join(', ')})${tags}`
        })
      return { output: rows.length ? `${rows.length} actors:\n${rows.join('\n')}` : 'No actors match.', error: null, level: 'log' }
    }
    case '/find': {
      const q = args.join(' ')
      if (!q) return { output: null, error: 'Usage: /find <name>', level: 'error' }
      const matches = [...world.actors.values()].filter((a) => a.name.toLowerCase().includes(q.toLowerCase()))
      if (!matches.length) return { output: null, error: `No actor matching "${q}"`, level: 'error' }
      return { output: matches.map((a) => formatTerminalValue(a)).join('\n'), error: null, level: 'log' }
    }
    case '/select': {
      const a = findActor(args.join(' '))
      if (!a) return { output: null, error: `Actor not found: ${args.join(' ')}`, level: 'error' }
      useEditor.getState().select(a.id)
      useEditor.getState().touch()
      return { output: `Selected ${a.name}`, error: null, level: 'log' }
    }
    case '/spawn': {
      const shape = args[0]
      if (!shape) return { output: null, error: `Usage: /spawn <${MESH_SHAPES.join('|')}>`, level: 'error' }
      const geom = shape.toLowerCase() as GeometryKind
      if (!MESH_SHAPES.includes(geom)) return { output: null, error: `Unknown shape "${shape}"`, level: 'error' }
      spawnAsset({ kind: 'mesh', geometry: geom }, [0, 0.5, 0])
      useEditor.getState().touch()
      return { output: `Spawned ${geom}`, error: null, level: 'log' }
    }
    case '/delete': {
      const a = findActor(args.join(' '))
      if (!a) return { output: null, error: `Actor not found: ${args.join(' ')}`, level: 'error' }
      runCommand(new DeleteActorCommand(a.id))
      return { output: `Deleted ${a.name}`, error: null, level: 'log' }
    }
    case '/play':
      useEditor.getState().startPlay('pie')
      return { output: '▶ Play In Editor', error: null, level: 'log' }
    case '/stop':
      useEditor.getState().stopPlay()
      return { output: '■ Stopped', error: null, level: 'log' }
    case '/simulate':
      useEditor.getState().startPlay('simulate')
      return { output: '≡ Simulating', error: null, level: 'log' }
    case '/starter': {
      const mode = (args[0] ?? 'thirdperson').toLowerCase()
      if (!['thirdperson', 'firstperson', 'fly'].includes(mode)) {
        return { output: null, error: 'Usage: /starter thirdperson|firstperson|fly', level: 'error' }
      }
      spawnCharacterStarter(mode as 'thirdperson' | 'firstperson' | 'fly')
      return { output: `Character starter: ${mode}`, error: null, level: 'log' }
    }
    case '/platformer': {
      const mode = (args[0] ?? 'side').toLowerCase()
      if (!['side', 'wide'].includes(mode)) {
        return { output: null, error: 'Usage: /platformer side|wide', level: 'error' }
      }
      spawnPlatformerStarter(mode as 'side' | 'wide')
      return { output: `Platformer starter: ${mode}`, error: null, level: 'log' }
    }
    case '/rpg': {
      const mode = (args[0] ?? 'small').toLowerCase()
      if (!['small', 'large'].includes(mode)) {
        return { output: null, error: 'Usage: /rpg small|large', level: 'error' }
      }
      spawnTopDownRpgStarter(mode as 'small' | 'large')
      return { output: `Top-down RPG starter: ${mode}`, error: null, level: 'log' }
    }
    case '/rpg3d': {
      const mode = (args[0] ?? 'small').toLowerCase()
      if (!['small', 'large'].includes(mode)) {
        return { output: null, error: 'Usage: /rpg3d small|large', level: 'error' }
      }
      spawnRpg3dStarter(mode as 'small' | 'large')
      return { output: `3D RPG starter: ${mode}`, error: null, level: 'log' }
    }
    case '/fps': {
      if (args.length) {
        return { output: null, error: 'Usage: /fps', level: 'error' }
      }
      spawnFpsStarter()
      return { output: 'FPS starter', error: null, level: 'log' }
    }
    case '/minigame': {
      const mode = (args[0] ?? '').toLowerCase()
      if (!['platformer', 'rpg', 'fps'].includes(mode)) {
        return { output: null, error: 'Usage: /minigame platformer|rpg|fps', level: 'error' }
      }
      spawnMiniGame(mode as 'platformer' | 'rpg' | 'fps')
      return { output: `Mini-game: ${mode} — press Play to win`, error: null, level: 'log' }
    }
    case '/minigameexport': {
      const mode = (args[0] ?? '').toLowerCase()
      if (!['platformer', 'rpg', 'fps'].includes(mode)) {
        return { output: null, error: 'Usage: /minigameexport platformer|rpg|fps', level: 'error' }
      }
      exportMiniGamePreset(mode as 'platformer' | 'rpg' | 'fps')
      return { output: `Exported mini-game preset: ${mode}`, error: null, level: 'log' }
    }
    case '/exportrpg': {
      if (args.length) {
        return { output: null, error: 'Usage: /exportrpg', level: 'error' }
      }
      spawnRpg3dGame()
      return {
        output:
          '3D RPG scene ready — press Play. Export pack: /rpg3dexport or indie.rpg3d.exportPack()',
        error: null,
        level: 'log',
      }
    }
    case '/rpg3dexport': {
      if (args.length) {
        return { output: null, error: 'Usage: /rpg3dexport', level: 'error' }
      }
      spawnRpg3dGame()
      const html = buildRpg3dPackHTML()
      const hasRpg3d = html.includes('__LOTUS_RPG_3D__')
      const hasRpgHud = html.includes('__LOTUS_RPG_HUD__')
      const snippet = html.slice(0, 480).replace(/\s+/g, ' ')
      return {
        output: `3D RPG pack HTML (${html.length} bytes)\n__LOTUS_RPG_3D__: ${hasRpg3d}\n__LOTUS_RPG_HUD__: ${hasRpgHud}\nSnippet: ${snippet}…`,
        error: null,
        level: 'log',
      }
    }
    case '/rpgoverworld': {
      if (args.length) {
        return { output: null, error: 'Usage: /rpgoverworld', level: 'error' }
      }
      spawnRpgOverworldStarter()
      const html = buildRpgOverworldPackHTML()
      const hasOverworld = html.includes('__LOTUS_RPG_OVERWORLD__')
      const hasStreaming = html.includes('__LOTUS_STREAMING__ = true')
      return {
        output:
          `RPG overworld ready — 2×2 cells, streaming on. Interior linked: ${RPG_INTERIOR_LEVEL_KEY}.\n` +
          `Press Play, walk to Portal_Interior → api.changeScene('${RPG_INTERIOR_LEVEL_KEY}').\n` +
          `Export: indie.rpgOverworld.exportPack() · __LOTUS_RPG_OVERWORLD__: ${hasOverworld} · streaming: ${hasStreaming}`,
        error: null,
        level: 'log',
      }
    }
    case '/exportpack': {
      const mode = (args[0] ?? '').toLowerCase()
      if (!['platformer', 'rpg', 'fps'].includes(mode)) {
        return { output: null, error: 'Usage: /exportpack platformer|rpg|fps', level: 'error' }
      }
      exportMiniGamePack(mode as 'platformer' | 'rpg' | 'fps')
      return { output: `Exported mini-game pack: ${mode} (with itch.io meta)`, error: null, level: 'log' }
    }
    case '/exportpackmeta': {
      const mode = (args[0] ?? '').toLowerCase()
      if (!['platformer', 'rpg', 'fps'].includes(mode)) {
        return { output: null, error: 'Usage: /exportpackmeta platformer|rpg|fps', level: 'error' }
      }
      const meta = buildExportPackMeta(mode as 'platformer' | 'rpg' | 'fps')
      return { output: JSON.stringify(meta, null, 2), error: null, level: 'log' }
    }
    case '/itchpack': {
      const mode = (args[0] ?? '').toLowerCase()
      if (!['platformer', 'rpg', 'fps'].includes(mode)) {
        return { output: null, error: 'Usage: /itchpack platformer|rpg|fps', level: 'error' }
      }
      exportItchUploadPack(mode as 'platformer' | 'rpg' | 'fps')
      return { output: `Exported itch.io zip: ${mode}-lotus-pack.zip`, error: null, level: 'log' }
    }
    case '/releasenotes': {
      const mode = (args[0] ?? '').toLowerCase()
      if (!['platformer', 'rpg', 'fps'].includes(mode)) {
        return { output: null, error: 'Usage: /releasenotes platformer|rpg|fps', level: 'error' }
      }
      return { output: buildReleaseNotes(mode as 'platformer' | 'rpg' | 'fps'), error: null, level: 'log' }
    }
    case '/packchangelog': {
      const mode = (args[0] ?? '').toLowerCase()
      if (!['platformer', 'rpg', 'fps'].includes(mode)) {
        return { output: null, error: 'Usage: /packchangelog platformer|rpg|fps', level: 'error' }
      }
      return { output: buildPackChangelogHtml(mode as 'platformer' | 'rpg' | 'fps'), error: null, level: 'log' }
    }
    case '/itchembed': {
      const mode = (args[0] ?? '').toLowerCase()
      if (!['platformer', 'rpg', 'fps'].includes(mode)) {
        return { output: null, error: 'Usage: /itchembed platformer|rpg|fps', level: 'error' }
      }
      const mgMode = mode as 'platformer' | 'rpg' | 'fps'
      const snippet = buildItchEmbedWidgetSections(mgMode)
      return {
        output: `Widget file: ${ITCH_EMBED_WIDGET_FILENAME}\nEmbed snippet:\n${snippet}`,
        error: null,
        level: 'log',
      }
    }
    case '/butlerhint': {
      const mode = (args[0] ?? '').toLowerCase()
      if (!['platformer', 'rpg', 'fps'].includes(mode)) {
        return { output: null, error: 'Usage: /butlerhint platformer|rpg|fps [html|beta|demo]', level: 'error' }
      }
      const channelArg = (args[1] ?? '').toLowerCase()
      const itchChannels = ['html', 'beta', 'demo'] as const
      let channel: ItchVersionChannel | undefined
      if (channelArg) {
        if (!itchChannels.includes(channelArg as ItchVersionChannel)) {
          return { output: null, error: 'Usage: /butlerhint platformer|rpg|fps [html|beta|demo]', level: 'error' }
        }
        channel = channelArg as ItchVersionChannel
      }
      const mgMode = mode as 'platformer' | 'rpg' | 'fps'
      const meta = buildExportPackMeta(mgMode, channel)
      const zipName = itchPackZipFilename(mgMode)
      const cmd = buildButlerPushCommand(meta, zipName, 'user', 'game', channel)
      storeLastItchZipName(zipName)
      return {
        output: `${cmd}\n\n${JSON.stringify(meta, null, 2)}`,
        error: null,
        level: 'log',
      }
    }
    case '/mpstarter': {
      if (args.length) {
        return { output: null, error: 'Usage: /mpstarter', level: 'error' }
      }
      spawnIndieMpTemplate()
      return { output: 'Indie MP starter — enable Multiplayer in World Settings, then Play', error: null, level: 'log' }
    }
    case '/mpdeathmatch': {
      if (args.length) {
        return { output: null, error: 'Usage: /mpdeathmatch', level: 'error' }
      }
      spawnIndieMpDeathmatch()
      return { output: 'Indie MP deathmatch — first to 3 wins (Fire / KeyF)', error: null, level: 'log' }
    }
    case '/mplobby': {
      if (args.length) {
        return { output: null, error: 'Usage: /mplobby', level: 'error' }
      }
      spawnIndieMpLobby()
      return { output: 'Indie MP lobby — ready up, then host starts deathmatch', error: null, level: 'log' }
    }
    case '/mpspectator': {
      if (args.length) {
        return { output: null, error: 'Usage: /mpspectator', level: 'error' }
      }
      spawnIndieMpSpectator()
      return {
        output: 'Indie MP spectator — enable Spectator in World Settings, Play to observe',
        error: null,
        level: 'log',
      }
    }
    case '/mpteams': {
      if (args.length) {
        return { output: null, error: 'Usage: /mpteams', level: 'error' }
      }
      spawnIndieMpTeamsDeathmatch()
      return {
        output: 'Indie MP teams — red vs blue, first team to 3 wins (friendly fire off)',
        error: null,
        level: 'log',
      }
    }
    case '/mpctf': {
      if (args.length) {
        return { output: null, error: 'Usage: /mpctf', level: 'error' }
      }
      spawnIndieMpCtf()
      return {
        output: 'Indie MP CTF — grab enemy flag (E), return to your pad to score',
        error: null,
        level: 'log',
      }
    }
    case '/mainmenu': {
      if (args.length) {
        return { output: null, error: 'Usage: /mainmenu', level: 'error' }
      }
      spawnMainMenu()
      return { output: 'Main menu — Play or indie.flow.selectLevel(kind)', error: null, level: 'log' }
    }
    case '/dialogue': {
      const treeId = args[0] ?? 'village_elder'
      mountRpgDialogueUi(document.body)
      setRpgDialogueUiListener((snap) => renderRpgDialogueUi(snap, document.body))
      const ok = startDialogue(treeId)
      if (!ok) {
        return { output: null, error: `Unknown dialogue tree: ${treeId}`, level: 'error' }
      }
      return { output: `Dialogue started: ${treeId}`, error: null, level: 'log' }
    }
    case '/gridnavmesh': {
      let mask: number
      if (args.length > 1) {
        return { output: null, error: 'Usage: /gridnavmesh [0-3]', level: 'error' }
      }
      if (args[0] !== undefined) {
        const layer = parseInt(args[0], 10)
        if (!Number.isFinite(layer) || layer < 0 || layer > 3) {
          return { output: null, error: 'Usage: /gridnavmesh [0-3]', level: 'error' }
        }
        mask = layerMaskFromIndex(layer)
      } else {
        mask = combinedNavmeshLayerMask(world.actors) || DEFAULT_GRID_NAVMESH_LAYER_MASK
      }
      const maskLabel = `0b${mask.toString(2).padStart(4, '0')}`
      void bakeNavMeshLayers(world.actors, mask).then((ok) => {
        useEditor.getState().setStatus(
          ok ? `Grid navmesh baked (${maskLabel})` : `Grid navmesh bake failed: ${lastBakeError ?? 'unknown'}`,
        )
        useEditor.getState().touch()
      })
      return { output: `Grid navmesh bake started (${maskLabel})`, error: null, level: 'log' }
    }
    case '/gridnavagent': {
      let layer = 0
      if (args.length > 1) {
        return { output: null, error: 'Usage: /gridnavagent [0-3]', level: 'error' }
      }
      if (args[0] !== undefined) {
        const parsed = parseInt(args[0], 10)
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 3) {
          return { output: null, error: 'Usage: /gridnavagent [0-3]', level: 'error' }
        }
        layer = clampGridNavLayer(parsed)
      }
      const id = `grid_nav_agent_L${layer}`
      const pos: [number, number, number] = [0, 1, 0]
      const target: [number, number, number] = [8, 1, 8]
      void spawnGridNavAgent(world.actors, id, layer, pos, target).then((ok) => {
        useEditor.getState().setStatus(
          ok
            ? `Grid nav agent ${id} on layer ${layer} — Play to tick crowd`
            : `Grid nav agent spawn failed: ${lastBakeError ?? 'bake failed'}`,
        )
        useEditor.getState().touch()
      })
      return {
        output: `Grid nav agent spawn started on layer ${layer} (${id} → [8,1,8])`,
        error: null,
        level: 'log',
      }
    }
    case '/quest': {
      const sub = (args[0] ?? '').toLowerCase()
      const id = args[1] ?? ''
      if (sub === 'start') {
        if (!id) return { output: null, error: 'Usage: /quest start <id>', level: 'error' }
        const def = findQuestDef(id)
        if (!def) return { output: null, error: `Unknown quest: ${id}`, level: 'error' }
        const ok = startQuest(id)
        if (!ok) {
          return { output: null, error: `Quest not started (already active or completed): ${id}`, level: 'error' }
        }
        const state = getQuestState(id)
        const obj = state?.objectives[0]
        return {
          output: [
            `Quest started: ${def.title} (${id})`,
            obj ? `  ${obj.description} (0/${obj.count})` : '',
            'Press Play — collect Herb-tagged actors or use api.updateQuestObjective',
            'Bridge: lotus.rpg.quests.start / getState',
          ]
            .filter(Boolean)
            .join('\n'),
          error: null,
          level: 'log',
        }
      }
      return { output: null, error: 'Usage: /quest start <id>', level: 'error' }
    }
    case '/inventory': {
      if (args.length) {
        return { output: null, error: 'Usage: /inventory', level: 'error' }
      }
      const player = ensurePlayerRpgActor(world.playerStart())
      if (!player) {
        return { output: null, error: 'No PlayerStart — place one or run /rpg small', level: 'error' }
      }
      addItem(player, 'health_potion', 1)
      addGold(player, 50)
      const inv = getInventory(player)
      const filled = inv.slots.filter(Boolean).length
      return {
        output: [
          `RPG inventory demo → ${player.name}`,
          `  health_potion ×${getItemCount(player, 'health_potion')}`,
          `  gold: ${getGold(player)}`,
          `  slots used: ${filled}/${inv.slots.length}`,
          'Scripts: api.addItem / api.getGold · bridge: lotus.rpg.inventory',
        ].join('\n'),
        error: null,
        level: 'log',
      }
    }
    case '/combatanim': {
      if (args.length) {
        return { output: null, error: 'Usage: /combatanim', level: 'error' }
      }
      const selectedId = useEditor.getState().selectedId
      const selected = selectedId ? world.actors.get(selectedId) : undefined
      const canUseSelected =
        selected &&
        (selected.type === 'PlayerStart' ||
          selected.type === 'StaticMesh' ||
          selected.type === 'CustomMesh' ||
          !!selected.mesh)
      const actor =
        (canUseSelected ? selected : undefined) ??
        ensurePlayerRpgActor(world.playerStart()) ??
        world.playerStart()
      if (!actor) {
        return { output: null, error: 'No selected actor or PlayerStart — select a mesh or run /starter', level: 'error' }
      }
      const result = attachSampleCombatOneshot(actor)
      if (!result.ok) {
        return { output: null, error: result.error ?? 'Failed to attach combat oneshot', level: 'error' }
      }
      useEditor.getState().touch()
      return {
        output: [
          `Combat oneshot → ${actor.name}`,
          `  FSM: Idle + ${COMBAT_ONESHOT_ATTACK_NAME} (kind=oneshot, clip=${result.clipName})`,
          'Press Play — api.meleeAttack / lotus.anim.combatOneshot(actorId) triggers montage',
          'Bridge: lotus.anim.combatOneshot · lotus.anim.attachSampleOneshot',
        ].join('\n'),
        error: null,
        level: 'log',
      }
    }
    case '/combat': {
      if (args.length) {
        return { output: null, error: 'Usage: /combat', level: 'error' }
      }
      const player = ensurePlayerCombatTag(world.playerStart())
      if (!player) {
        return { output: null, error: 'No PlayerStart — place one or run /starter thirdperson', level: 'error' }
      }
      const enemyName = 'CombatTestEnemy'
      let enemy = [...world.actors.values()].find((a) => a.name === enemyName)
      if (!enemy) {
        const sa = buildSerializedActor({ kind: 'mesh', geometry: 'capsule' }, [3, 0.9, 0])
        sa.name = enemyName
        sa.tags = ['Enemy']
        sa.attributeSetId = 'default'
        new AddActorCommand(sa).execute()
        enemy = [...world.actors.values()].find((a) => a.name === enemyName)
      }
      if (!enemy) {
        return { output: null, error: 'Failed to spawn CombatTestEnemy', level: 'error' }
      }
      ensureCombatActor(enemy)
      const beforeEnemy = getActorHealth(enemy) ?? 0
      const beforePlayer = getActorHealth(player) ?? 0
      dealDamage(enemy, 25, player)
      dealDamage(player, 10, enemy)
      const afterEnemy = getActorHealth(enemy) ?? 0
      const afterPlayer = getActorHealth(player) ?? 0
      void registerEnemy(enemy, world.actors).then((ok) => {
        useEditor.getState().setStatus(
          ok
            ? `${enemyName} registered — Play to see navmesh chase (Player tag)`
            : 'Enemy spawned; nav chase registers on Play (bake /gridnavmesh first)',
        )
        useEditor.getState().touch()
      })
      return {
        output: [
          `Combat demo → ${enemyName} (Enemy) vs ${player.name} (Player)`,
          `  enemy HP: ${beforeEnemy} → ${afterEnemy} (alive: ${isAlive(enemy)})`,
          `  player HP: ${beforePlayer} → ${afterPlayer} (alive: ${isAlive(player)})`,
          'Scripts: api.dealDamage / api.meleeAttack / api.rangedAttack',
          'Bridge: lotus.rpg.combat · lotus.rpg.enemyAi.register',
        ].join('\n'),
        error: null,
        level: 'log',
      }
    }
    case '/craft': {
      const recipeId = args[0]?.trim()
      if (!recipeId || args.length > 1) {
        return { output: null, error: 'Usage: /craft <recipeId>  (e.g. health_potion)', level: 'error' }
      }
      const player = ensurePlayerRpgActor(world.playerStart())
      if (!player) {
        return { output: null, error: 'No PlayerStart — place one or run /rpg3d small', level: 'error' }
      }
      ensureDefaultCraftingItems()
      ensureDefaultLootTables()
      const recipe = findRecipe(recipeId)
      if (!recipe) {
        return { output: null, error: `Unknown recipe "${recipeId}"`, level: 'error' }
      }
      for (const input of recipe.inputs) {
        if (!getItemCount(player, input.itemId)) addItem(player, input.itemId, input.quantity)
      }
      if (!canCraft(player, recipe.id)) {
        const need = recipe.inputs.map((i) => `${i.quantity}× ${i.itemId}`).join(', ')
        return { output: null, error: `Cannot craft ${recipe.id} — need: ${need}`, level: 'error' }
      }
      const before = getItemCount(player, recipe.output.itemId)
      const ok = craft(player, recipe.id)
      if (!ok) {
        return { output: null, error: `Failed to craft "${recipe.id}"`, level: 'error' }
      }
      const after = getItemCount(player, recipe.output.itemId)
      const inputs = recipe.inputs.map((i) => `${i.quantity}× ${i.itemId}`).join(' + ')
      return {
        output: [
          `Crafted ${recipe.name} → ${player.name}`,
          `  recipe: ${inputs} → ${recipe.output.quantity}× ${recipe.output.itemId}`,
          `  ${recipe.output.itemId}: ${before} → ${after}`,
          'Scripts: api.craft / api.canCraft · bridge: lotus.rpg.crafting',
        ].join('\n'),
        error: null,
        level: 'log',
      }
    }
    case '/combatpolish': {
      if (args.length) {
        return { output: null, error: 'Usage: /combatpolish', level: 'error' }
      }
      const player = ensurePlayerCombatTag(world.playerStart())
      if (!player) {
        return { output: null, error: 'No PlayerStart — run /starter thirdperson', level: 'error' }
      }
      const enemyName = 'PolishTestEnemy'
      let enemy = [...world.actors.values()].find((a) => a.name === enemyName)
      if (!enemy) {
        const sa = buildSerializedActor({ kind: 'mesh', geometry: 'capsule' }, [2, 0.9, 0])
        sa.name = enemyName
        sa.tags = ['Enemy']
        sa.attributeSetId = 'default'
        new AddActorCommand(sa).execute()
        enemy = [...world.actors.values()].find((a) => a.name === enemyName)
      }
      if (!enemy) return { output: null, error: 'Failed to spawn polish enemy', level: 'error' }
      ensureCombatActor(enemy)
      const hp0 = getActorHealth(player) ?? 0
      dealDamage(player, 20, enemy)
      const hp1 = getActorHealth(player) ?? 0
      const iframeBlocked = dealDamage(player, 20, enemy)
      const hp2 = getActorHealth(player) ?? 0
      const nums = listDamageNumbers()
      return {
        output: [
          `Combat polish → ${player.name} (Player i-frames) vs ${enemyName}`,
          `  HP: ${hp0} → ${hp1} → ${hp2} (2nd hit blocked: ${!iframeBlocked}, iframeSec≈${getIFramesRemaining(player).toFixed(2)})`,
          `  invincible: ${isInvincible(player)} · damage numbers queued: ${nums.length}`,
          'Bridge: lotus.rpg.combat.polish',
        ].join('\n'),
        error: null,
        level: 'log',
      }
    }
    case '/equipvisual': {
      if (args.length) {
        return { output: null, error: 'Usage: /equipvisual', level: 'error' }
      }
      const player = ensurePlayerRpgActor(world.playerStart())
      if (!player) {
        return { output: null, error: 'No PlayerStart — run /starter thirdperson', level: 'error' }
      }
      const def = getEquipmentDef('iron_sword')
      if (!def) return { output: null, error: 'iron_sword not registered', level: 'error' }
      if (!getItemCount(player, def.id)) addItem(player, def.id, 1)
      if (!equip(player, def.id)) {
        return { output: null, error: 'Failed to equip iron_sword', level: 'error' }
      }
      syncEquipmentVisuals(player)
      const visual = getWeaponVisualId(player)
      return {
        output: [
          `Equipment visual → ${player.name}`,
          `  socket mesh: ${visual ?? 'none'}`,
          'Bridge: lotus.rpg.equipment.visuals',
        ].join('\n'),
        error: null,
        level: 'log',
      }
    }
    case '/portaltrans': {
      const levelKey = args[0]?.trim() || RPG_INTERIOR_LEVEL_KEY
      if (args.length > 1) {
        return { output: null, error: 'Usage: /portaltrans [interior|overworld]', level: 'error' }
      }
      const label = portalLabelForTarget(levelKey)
      showPortalLoading(label)
      window.setTimeout(() => hidePortalLoading(), 900)
      return {
        output: [
          `Portal transition preview → ${levelKey}`,
          `  label: ${label}`,
          'Bridge: lotus.rpg.portals.transitions',
        ].join('\n'),
        error: null,
        level: 'log',
      }
    }
    case '/rootmotion': {
      if (args.length) {
        return { output: null, error: 'Usage: /rootmotion', level: 'error' }
      }
      const player = ensurePlayerRpgActor(world.playerStart())
      if (!player) {
        return { output: null, error: 'No PlayerStart — run /starter thirdperson', level: 'error' }
      }
      const result = attachSampleCombatOneshot(player)
      if (!result.ok) {
        return { output: null, error: result.error ?? 'Failed to attach combat oneshot', level: 'error' }
      }
      const speed = getCombatRootMotionSpeed(player)
      return {
        output: [
          `Root motion stub → ${player.name}`,
          `  Attack rootMotionSpeed: ${speed} u/s (tick during Play oneshot)`,
          'Bridge: lotus.anim.getRootMotionSpeed · lotus.anim.isRootMotionActive',
        ].join('\n'),
        error: null,
        level: 'log',
      }
    }
    case '/damagehud': {
      if (args.length) {
        return { output: null, error: 'Usage: /damagehud', level: 'error' }
      }
      const count = previewRpgDamageHud([
        { amount: 15, x: 320, y: 240 },
        { amount: 42, x: 480, y: 180, crit: true },
      ])
      return {
        output: [
          'Damage HUD preview → screen-space floaters',
          `  rendered: ${count} numbers`,
          'Bridge: lotus.rpg.hud3d.previewDamage · tickDamage during Play',
        ].join('\n'),
        error: null,
        level: 'log',
      }
    }
    case '/vendor': {
      if (args.length) {
        return { output: null, error: 'Usage: /vendor', level: 'error' }
      }
      const vendorName = 'VillageVendor'
      let vendor = [...world.actors.values()].find((a) => a.name === vendorName)
      if (!vendor) {
        const sa = buildSerializedActor({ kind: 'mesh', geometry: 'capsule' }, [-2, 0.9, 2])
        sa.name = vendorName
        sa.tags = [VENDOR_NPC_TAG]
        sa.scriptVars = { shopId: DEFAULT_SHOP_ID, greeting: 'Fine wares for brave adventurers!' }
        new AddActorCommand(sa).execute()
        vendor = [...world.actors.values()].find((a) => a.name === vendorName)
      }
      if (!vendor) return { output: null, error: 'Failed to spawn vendor', level: 'error' }
      const player = ensurePlayerRpgActor(world.playerStart())
      if (!player) {
        return { output: null, error: 'No PlayerStart — run /starter thirdperson', level: 'error' }
      }
      ensureDefaultShops()
      const shop = getShop(DEFAULT_SHOP_ID)
      if (!shop) return { output: null, error: 'Default shop missing', level: 'error' }
      if (!getGold(player)) addGold(player, 50)
      const listings = shop.listings.map((l) => {
        const price = resolveBuyPrice(player, shop.id, l.itemId)
        return {
          itemId: l.itemId,
          name: l.itemId,
          price,
          canAfford: getGold(player) >= price,
        }
      })
      previewRpg3dShop(true, vendorName, String(vendor.scriptVars?.greeting ?? ''), getGold(player), listings)
      openVendorShop(vendor)
      return {
        output: [
          `Vendor NPC → ${vendorName} (${VENDOR_NPC_TAG})`,
          `  shop: ${DEFAULT_SHOP_ID} · listings: ${listings.length}`,
          'Bridge: lotus.rpg.vendor · lotus.rpg.hud3d.previewShop',
        ].join('\n'),
        error: null,
        level: 'log',
      }
    }
    case '/armorvisual': {
      if (args.length) {
        return { output: null, error: 'Usage: /armorvisual', level: 'error' }
      }
      const player = ensurePlayerRpgActor(world.playerStart())
      if (!player) {
        return { output: null, error: 'No PlayerStart — run /starter thirdperson', level: 'error' }
      }
      for (const id of ['leather_helm', 'leather_chest']) {
        const def = getEquipmentDef(id)
        if (!def) continue
        if (!getItemCount(player, id)) addItem(player, id, 1)
        equip(player, id)
      }
      syncEquipmentVisuals(player)
      return {
        output: [
          `Armor visuals → ${player.name}`,
          `  head: ${getArmorVisualId(player, 'head') ?? 'none'}`,
          `  chest: ${getArmorVisualId(player, 'chest') ?? 'none'}`,
          'Bridge: lotus.rpg.equipment.visuals.attachArmor',
        ].join('\n'),
        error: null,
        level: 'log',
      }
    }
    case '/portalcine': {
      const levelKey = args[0]?.trim() || 'interior'
      if (args.length > 1) {
        return { output: null, error: 'Usage: /portalcine [interior|overworld]', level: 'error' }
      }
      void portalCinematicOut(levelKey, { preloadSteps: 5 }).then(() => hidePortalLoading())
      return {
        output: [
          `Portal cinematic → ${levelKey}`,
          `  slide + preload ring (see overlay)`,
          'Bridge: lotus.rpg.portals.transitions.cinematicOut',
        ].join('\n'),
        error: null,
        level: 'log',
      }
    }
    case '/shopprice': {
      const itemId = args[0]?.trim() || 'herb'
      if (args.length > 1) {
        return { output: null, error: 'Usage: /shopprice <itemId>  (e.g. herb)', level: 'error' }
      }
      const player = ensurePlayerRpgActor(world.playerStart())
      if (!player) {
        return { output: null, error: 'No PlayerStart — run /starter thirdperson', level: 'error' }
      }
      ensureDefaultShops()
      startQuest('find_herbs')
      const breakdown = priceBreakdown(player, DEFAULT_SHOP_ID, itemId)
      if (!breakdown) {
        return { output: null, error: `No listing for ${itemId}`, level: 'error' }
      }
      return {
        output: [
          `Shop price → ${itemId} (find_herbs active)`,
          `  base: ${breakdown.base}g → resolved: ${breakdown.resolved}g`,
          `  questMult: ${breakdown.questMult} · repMult: ${breakdown.repMult.toFixed(3)}`,
          'Bridge: lotus.rpg.shop.economy',
        ].join('\n'),
        error: null,
        level: 'log',
      }
    }
    case '/shop': {
      const sub = args[0]?.toLowerCase()
      const itemId = args[1]?.trim()
      if (sub !== 'buy' || !itemId || args.length > 2) {
        return { output: null, error: 'Usage: /shop buy <itemId>  (e.g. herb)', level: 'error' }
      }
      const player = ensurePlayerRpgActor(world.playerStart())
      if (!player) {
        return { output: null, error: 'No PlayerStart — run /starter thirdperson', level: 'error' }
      }
      ensureDefaultShops()
      const shop = getShop(DEFAULT_SHOP_ID)
      if (!shop) return { output: null, error: 'Default shop missing', level: 'error' }
      if (!getGold(player)) addGold(player, 100)
      const goldBefore = getGold(player)
      const countBefore = getItemCount(player, itemId)
      if (!canBuy(player, DEFAULT_SHOP_ID, itemId)) {
        return { output: null, error: `Cannot buy ${itemId} at ${shop.name}`, level: 'error' }
      }
      const ok = buyItem(player, DEFAULT_SHOP_ID, itemId)
      if (!ok) return { output: null, error: `Buy failed for ${itemId}`, level: 'error' }
      return {
        output: [
          `Shop buy → ${shop.name}`,
          `  ${itemId}: ${countBefore} → ${getItemCount(player, itemId)}`,
          `  gold: ${goldBefore} → ${getGold(player)}`,
          'Bridge: lotus.rpg.shop',
        ].join('\n'),
        error: null,
        level: 'log',
      }
    }
    case '/equip': {
      const itemId = args[0]?.trim()
      if (!itemId || args.length > 1) {
        return { output: null, error: 'Usage: /equip <itemId>  (e.g. iron_sword, leather_helm)', level: 'error' }
      }
      const player = ensurePlayerRpgActor(world.playerStart())
      if (!player) {
        return { output: null, error: 'No PlayerStart — place one or run /rpg3d small', level: 'error' }
      }
      const def = getEquipmentDef(itemId)
      if (!def) {
        return { output: null, error: `Unknown equipment item "${itemId}"`, level: 'error' }
      }
      if (!getItemCount(player, def.id)) addItem(player, def.id, 1)
      const ok = equip(player, def.id)
      if (!ok) {
        return { output: null, error: `Failed to equip "${def.id}"`, level: 'error' }
      }
      const equipped = getEquipped(player)
      const mods = def.modifiers.map((m) => `${m.attribute}${m.value >= 0 ? '+' : ''}${m.value}`).join(', ')
      return {
        output: [
          `Equipped ${def.name} → ${player.name} (${def.slot})`,
          `  modifiers: ${mods || 'none'}`,
          `  slots: weapon=${equipped.weapon ?? '—'} head=${equipped.head ?? '—'}`,
          'Scripts: api.equip / api.getEquipped · bridge: lotus.rpg.equipment',
        ].join('\n'),
        error: null,
        level: 'log',
      }
    }
    case '/cloudsave': {
      const sub = args[0]?.toLowerCase()
      if (sub !== 'export' && sub !== 'import') {
        return { output: null, error: 'Usage: /cloudsave export|import [json]', level: 'error' }
      }
      const env = world.environment
      setSaveContext({
        levelName: world.levelName,
        enabled: env.saveSlotsEnabled === true,
        cloudBackup: env.cloudSaveBackup === true,
        crossLevelSaves: env.crossLevelSaves === true,
      })
      if (sub === 'export') {
        if (args.length > 1) {
          return { output: null, error: 'Usage: /cloudsave export', level: 'error' }
        }
        void exportCloudSaveJson()
          .then((doc) => useEditor.getState().pushConsole('log', JSON.stringify(doc)))
          .catch((e) =>
            useEditor.getState().pushConsole('error', e instanceof Error ? e.message : String(e)),
          )
        return { output: 'Exporting cloud save JSON…', error: null, level: 'log' }
      }
      const raw = args.slice(1).join(' ').trim()
      if (!raw) {
        return { output: null, error: 'Usage: /cloudsave import <json>', level: 'error' }
      }
      void importCloudSaveJson(raw)
        .then((result) =>
          useEditor.getState().pushConsole(
            'log',
            `Cloud save import — ${result.merged} merged, ${result.skipped} skipped (${result.level})`,
          ),
        )
        .catch((e) =>
          useEditor.getState().pushConsole('error', e instanceof Error ? e.message : String(e)),
        )
      return { output: 'Importing cloud save JSON…', error: null, level: 'log' }
    }
    case '/gridnavai': {
      const behavior = args[0]?.toLowerCase()
      if (behavior !== 'patrol' && behavior !== 'chase') {
        return { output: null, error: 'Usage: /gridnavai patrol|chase [0-3]', level: 'error' }
      }
      let layer = 0
      if (args.length > 2) {
        return { output: null, error: 'Usage: /gridnavai patrol|chase [0-3]', level: 'error' }
      }
      if (args[1] !== undefined) {
        const parsed = parseInt(args[1], 10)
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 3) {
          return { output: null, error: 'Usage: /gridnavai patrol|chase [0-3]', level: 'error' }
        }
        layer = clampGridNavLayer(parsed)
      }
      const id = `grid_nav_ai_${behavior}_L${layer}`
      const pos: [number, number, number] = [0, 1, 0]
      const spawn =
        behavior === 'patrol'
          ? spawnGridNavPatrolAgent(world.actors, id, layer, pos)
          : spawnGridNavChaseAgent(world.actors, id, layer, pos)
      void spawn.then((ok) => {
        useEditor.getState().setStatus(
          ok
            ? `Grid nav AI ${id} (${behavior}) on layer ${layer} — tag chase targets with grid_nav_target`
            : `Grid nav AI spawn failed: ${lastBakeError ?? 'bake failed'}`,
        )
        useEditor.getState().touch()
      })
      return {
        output: `Grid nav AI ${behavior} spawn started on layer ${layer} (${id})`,
        error: null,
        level: 'log',
      }
    }
    case '/gridnavpath': {
      let layer = 0
      if (args.length > 1) {
        return { output: null, error: 'Usage: /gridnavpath [0-3]', level: 'error' }
      }
      if (args[0] !== undefined) {
        const parsed = parseInt(args[0], 10)
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 3) {
          return { output: null, error: 'Usage: /gridnavpath [0-3]', level: 'error' }
        }
        layer = clampGridNavLayer(parsed)
      }
      const from: [number, number, number] = [0, 1, 0]
      const to: [number, number, number] = [8, 1, 8]
      gridNavPathShowDebug(true)
      void gridNavPathFind(world.actors, layer, from, to).then((polyline) => {
        const pts = polyline?.length ?? 0
        useEditor.getState().setStatus(
          polyline
            ? `Grid nav path on layer ${layer}: ${pts} waypoints [0,1,0] → [8,1,8]`
            : `Grid nav path failed on layer ${layer}: ${lastBakeError ?? 'no path'}`,
        )
        useEditor.getState().touch()
      })
      return {
        output: `Grid nav path find started on layer ${layer} ([0,1,0] → [8,1,8])`,
        error: null,
        level: 'log',
      }
    }
    case '/undo':
      undo()
      return { output: 'Undo', error: null, level: 'log' }
    case '/redo':
      redo()
      return { output: 'Redo', error: null, level: 'log' }
    case '/pos': {
      const a = findActor(args.join(' '))
      if (!a) return { output: null, error: `Actor not found: ${args.join(' ')}`, level: 'error' }
      const p = a.root.getWorldPosition(new THREE.Vector3())
      return { output: `${a.name}: [${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}]`, error: null, level: 'log' }
    }
    case '/tag': {
      const [name, ...tagParts] = args
      const tag = tagParts.join(' ').trim()
      if (!name || !tag) return { output: null, error: 'Usage: /tag <actor> <tag>', level: 'error' }
      const a = findActor(name)
      if (!a) return { output: null, error: `Actor not found: ${name}`, level: 'error' }
      if (!a.tags.includes(tag)) {
        const prev = [...a.tags]
        runCommand({
          label: `Tag ${a.name}`,
          execute: () => a.tags.push(tag),
          undo: () => (a.tags = prev),
        })
      }
      return { output: `${a.name} tags: [${a.tags.join(', ')}]`, error: null, level: 'log' }
    }
    case '/eval': {
      const js = args.join(' ')
      if (!js) return { output: null, error: 'Usage: /eval <javascript>', level: 'error' }
      return executeJavaScript(js)
    }
    default:
      return { output: null, error: `Unknown command "${cmd}". Type /help`, level: 'error' }
  }
}

function executeJavaScript(source: string): TerminalResult {
  const scope = makeScope()
  const keys = Object.keys(scope)
  const values = Object.values(scope)
  try {
    let result: unknown
    try {
      const expr = new Function(...keys, `"use strict"; return (${source})`)
      result = expr(...values)
    } catch {
      const stmt = new Function(...keys, `"use strict"; ${source}`)
      result = stmt(...values)
    }
    useEditor.getState().touch()
    const formatted = formatTerminalValue(result)
    return { output: formatted || null, error: null, level: 'log' }
  } catch (err) {
    const e = err as Error
    return { output: null, error: e.stack?.split('\n').slice(0, 4).join('\n') ?? e.message, level: 'error' }
  }
}

/** Execute one terminal line (slash command or JavaScript). */
export function executeTerminalLine(source: string): TerminalResult {
  // UE console commands (stat fps, stat unit, slomo, t.MaxFPS, r.ScreenPercentage)
  {
    const ueHandled = execConsoleCommand(source)
    if (ueHandled !== null) return { output: ueHandled, error: null, level: 'log' }
  }

  const trimmed = source.trim()
  if (!trimmed) return { output: null, error: null, level: 'log' }
  if (trimmed.startsWith('/')) {
    return runSlash(trimmed.split(/\s+/))
  }
  return executeJavaScript(trimmed)
}

/** Tab-completion candidates for the current partial input. */
export function terminalCompletions(partial: string): string[] {
  // UE console commands first
  {
    const ue = consoleSuggestions(partial)
    if (ue.length) return ue
  }

  const actorNames = [...world.actors.values()].map((a) => `"${a.name}"`)
  const pluginCmds = getPluginConsoleCommands().map((c) => `${c.name} `)
  const builtins = [
    'world',
    'world.actors',
    'world.actors.size',
    'world.levelName',
    'world.playing',
    'api',
    'api.log',
    'api.getActor',
    'api.getActorsByTag',
    'actors()',
    'find(',
    'select(',
    'spawn(',
    'play()',
    'stop()',
    'simulate()',
    'useEditor.getState()',
    'runCommand',
    'undo()',
    'redo()',
    '/help',
    '/ls',
    '/find ',
    '/select ',
    '/spawn box',
    '/spawn sphere',
    '/play',
    '/stop',
    '/undo',
    '/redo',
  ]
  const slashMatch = partial.match(/^(\/\w*)$/)
  if (slashMatch) {
    const cmds = ['/help', '/clear', '/ls', '/find', '/select', '/spawn', '/delete', '/play', '/stop', '/simulate', '/starter', '/platformer', '/rpg', '/rpg3d', '/fps', '/minigame', '/minigameexport', '/exportrpg', '/rpg3dexport', '/rpgoverworld', '/exportpack', '/exportpackmeta', '/itchpack', '/releasenotes', '/packchangelog', '/itchembed', '/butlerhint', '/mpstarter', '/mpdeathmatch', '/mplobby', '/mpspectator', '/mpteams', '/mpctf', '/mainmenu', '/dialogue', '/quest', '/inventory', '/combatanim', '/combat', '/combatpolish', '/equip', '/equipvisual', '/portaltrans', '/rootmotion', '/shop', '/damagehud', '/vendor', '/armorvisual', '/portalcine', '/shopprice', '/craft', '/gridnavmesh', '/gridnavagent', '/gridnavai', '/gridnavpath', '/cloudsave', '/undo', '/redo', '/pos', '/tag', '/eval']
    return cmds.filter((c) => c.startsWith(partial))
  }
  const all = [...builtins, ...pluginCmds, ...actorNames]
  const lastToken = partial.split(/[\s;,(]+/).pop() ?? partial
  if (!lastToken) return []
  return all.filter((c) => c.toLowerCase().startsWith(lastToken.toLowerCase()) && c !== lastToken).slice(0, 12)
}

/** Apply a completion by replacing the last token in the input. */
export function applyCompletion(input: string, completion: string): string {
  const slash = input.match(/^(\s*)(\/\w*)$/)
  if (slash) return slash[1] + completion
  const m = input.match(/^([\s\S]*)([\w."'/()]*)$/)
  if (!m) return completion
  const prefix = m[1]
  const token = m[2]
  if (!token) return prefix + completion
  if (completion.startsWith(token)) return prefix + completion
  return prefix + completion
}

function pushTerminalResult(source: string, result: TerminalResult): TerminalResult {
  const push = useEditor.getState().pushConsole
  push('cmd', `> ${source}`)
  if (result.error) push('error', result.error)
  else if (result.output) push('log', result.output)
  return result
}

/** Programmatic entry — browser devtools & external tooling. */
export function terminalExec(source: string): TerminalResult {
  return pushTerminalResult(source, executeTerminalLine(source))
}