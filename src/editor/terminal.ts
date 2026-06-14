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
import { spawnIndieMpDeathmatch, spawnIndieMpLobby, spawnIndieMpSpectator } from './indieMpGameplay'
import { spawnIndieMpTemplate } from './indieMpTemplate'
import { exportMiniGamePreset } from './exportPlayable'
import { buildExportPackMeta, type ItchVersionChannel } from './exportPackMeta'
import { buildButlerPushCommand, storeLastItchZipName } from './itchButlerHint'
import { buildReleaseNotes } from './itchReleaseNotes'
import { exportItchUploadPack, itchPackZipFilename } from './itchUploadPack'
import { exportMiniGamePack } from './miniGameExportPack'
import { spawnMainMenu } from './mainMenuFlow'
import { spawnMiniGame } from './starterMiniGames'
import { spawnCharacterStarter, spawnFpsStarter, spawnPlatformerStarter, spawnTopDownRpgStarter } from './starterTemplates'
import {
  bakeNavMeshLayers,
  combinedNavmeshLayerMask,
  DEFAULT_GRID_NAVMESH_LAYER_MASK,
  layerMaskFromIndex,
} from '../engine/gridNavmeshBake'
import { clampGridNavLayer, spawnGridNavAgent } from '../engine/gridNavAgents'
import { lastBakeError } from '../engine/nav'
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
  /fps               Greybox FPS corridor scene
  /minigame <mode>   Playable mini-game starter (platformer|rpg|fps) with win condition
  /minigameexport <mode>  Export playable HTML for platformer|rpg|fps preset
  /exportpack <mode>      Export PWA mini-game pack (platformer|rpg|fps) with manifest + icons + meta
  /exportpackmeta <mode>  Show itch.io pack metadata JSON (platformer|rpg|fps)
  /itchpack <mode>        Download itch.io zip (index.html + meta.json + icon.png + RELEASE_NOTES.md)
  /releasenotes <mode>    Print itch.io release notes markdown (platformer|rpg|fps)
  /butlerhint <mode> [ch] Print Butler CLI push command + pack meta (ch: html|beta|demo)
  /mpstarter         Greybox indie multiplayer scene (host + client spawns, sync crates)
  /mpdeathmatch      Indie MP deathmatch (targets, scoreboard, first to 3 wins)
  /mplobby           Indie MP lobby (room browser + ready-up before deathmatch)
  /mpspectator       Indie MP spectator arena (orbit host, no pawn spawn)
  /mainmenu          Main menu → level select (Platformer, RPG, FPS, MP Deathmatch)
  /gridnavmesh [0-3] Bake Recast navmesh from grid tile layers (mask from foliage or layer arg)
  /gridnavagent [0-3] Spawn test crowd agent on grid navmesh layer (Play to tick)

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
    case '/mainmenu': {
      if (args.length) {
        return { output: null, error: 'Usage: /mainmenu', level: 'error' }
      }
      spawnMainMenu()
      return { output: 'Main menu — Play or indie.flow.selectLevel(kind)', error: null, level: 'log' }
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
    const cmds = ['/help', '/clear', '/ls', '/find', '/select', '/spawn', '/delete', '/play', '/stop', '/simulate', '/starter', '/platformer', '/rpg', '/fps', '/minigame', '/minigameexport', '/exportpack', '/exportpackmeta', '/itchpack', '/releasenotes', '/butlerhint', '/mpstarter', '/mpdeathmatch', '/mplobby', '/mpspectator', '/mainmenu', '/gridnavmesh', '/gridnavagent', '/undo', '/redo', '/pos', '/tag', '/eval']
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

/** Programmatic entry — browser devtools & external tooling. */
export function terminalExec(source: string): TerminalResult {
  const result = executeTerminalLine(source)
  const push = useEditor.getState().pushConsole
  push('cmd', `> ${source}`)
  if (result.error) push('error', result.error)
  else if (result.output) push('log', result.output)
  return result
}