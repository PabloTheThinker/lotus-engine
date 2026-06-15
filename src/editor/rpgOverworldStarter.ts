/** Wave 98 (v5.29–v5.33) — 2×2 cell overworld greybox + interior level link. */

import type { PawnMode, SerializedActor, SerializedLevel, StreamingSettings } from '../engine/types'
import { DEFAULT_ENVIRONMENT, DEFAULT_STREAMING } from '../engine/types'
import {
  PORTAL_INTERIOR_TAG,
  PORTAL_OVERWORLD_TAG,
  RPG_INTERIOR_LEVEL_KEY,
  RPG_OVERWORLD_LEVEL_KEY,
} from '../engine/rpgPortals'
import { sanitizeLevelKey, world } from '../engine/World'
import { AddActorCommand, runCommand } from './commands'
import { buildSerializedActor } from './spawn'
import { useEditor } from './store'

export const RPG_OVERWORLD_MANAGER_NAME = 'RpgOverworldManager'
export const RPG_OVERWORLD_GRID_SIZE = 64
export const PORTAL_INTERIOR_NAME = 'Portal_Interior'
export const PORTAL_OVERWORLD_NAME = 'Portal_Overworld'

export const RPG_OVERWORLD_STREAMING: StreamingSettings = {
  enabled: true,
  gridSize: RPG_OVERWORLD_GRID_SIZE,
  loadRadius: 1,
  exportByCell: true,
}

const CELL_DEFS: { key: string; cx: number; cz: number; color: string; label: string }[] = [
  { key: '0,0', cx: 0, cz: 0, color: '#4d6b55', label: 'Meadow' },
  { key: '1,0', cx: 1, cz: 0, color: '#3d5a4a', label: 'Forest' },
  { key: '0,1', cx: 0, cz: 1, color: '#3a5568', label: 'Lake' },
  { key: '1,1', cx: 1, cz: 1, color: '#5b6b7a', label: 'Village' },
]

function cellCenter(cx: number, cz: number): [number, number, number] {
  const g = RPG_OVERWORLD_GRID_SIZE
  return [cx * g + g * 0.5, 0, cz * g + g * 0.5]
}

function withStreamCell(sa: SerializedActor, cx: number, cz: number): SerializedActor {
  return { ...sa, streamCell: [cx, cz] }
}

function starterBox(
  name: string,
  position: [number, number, number],
  scale: [number, number, number],
  color = '#5b6b7a',
  streamCell?: [number, number],
): SerializedActor {
  const box = buildSerializedActor({ kind: 'mesh', geometry: 'box' }, position)
  box.name = name
  box.transform.scale = scale
  box.material = {
    ...box.material!,
    color,
    roughness: 0.82,
    metalness: 0.05,
    emissive: '#000000',
    emissiveIntensity: 1,
    wireframe: false,
    opacity: 1,
    transparent: false,
  }
  box.physics = { mode: 'static', mass: 1, friction: 0.6, restitution: 0 }
  return streamCell ? withStreamCell(box, streamCell[0], streamCell[1]) : box
}

function portalTrigger(
  name: string,
  position: [number, number, number],
  scale: [number, number, number],
  tag: string,
  targetLevel: string,
  streamCell?: [number, number],
): SerializedActor {
  const trig = buildSerializedActor({ kind: 'trigger' }, position)
  trig.name = name
  trig.transform.scale = scale
  trig.tags = [tag]
  trig.scriptVars = { targetLevel }
  return streamCell ? withStreamCell(trig, streamCell[0], streamCell[1]) : trig
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

function buildOverworldManager(): SerializedActor {
  const mgr = buildSerializedActor({ kind: 'empty' }, [0, 0, 0])
  mgr.name = RPG_OVERWORLD_MANAGER_NAME
  mgr.tags = ['rpgoverworld']
  return mgr
}

/** Interior level snapshot — small room with return portal. */
export function buildRpgInteriorLevel(): SerializedLevel {
  const floor = starterBox('InteriorFloor', [0, -0.1, 0], [12, 0.2, 12], '#4a5568')
  const walls = [
    starterBox('InteriorWallN', [0, 1.5, -6], [12, 3, 0.3], '#5b6b7a'),
    starterBox('InteriorWallS', [0, 1.5, 6], [12, 3, 0.3], '#5b6b7a'),
    starterBox('InteriorWallW', [-6, 1.5, 0], [0.3, 3, 12], '#5b6b7a'),
    starterBox('InteriorWallE', [6, 1.5, 0], [0.3, 3, 12], '#5b6b7a'),
  ]
  const portal = portalTrigger(
    PORTAL_OVERWORLD_NAME,
    [0, 1, 4.5],
    [3, 2, 2],
    PORTAL_OVERWORLD_TAG,
    RPG_OVERWORLD_LEVEL_KEY,
  )
  const start = buildSerializedActor({ kind: 'playerstart' }, [0, 0.2, 0])
  start.name = 'InteriorPlayerStart'
  start.pawnMode = 'thirdperson' as PawnMode
  const sun = buildSerializedActor({ kind: 'light', type: 'DirectionalLight' }, [4, 10, 6])
  sun.name = 'InteriorSun'

  return {
    engine: 'lotus',
    version: 4,
    name: 'Interior',
    environment: {
      ...DEFAULT_ENVIRONMENT,
      useRapierCharacter: true,
      rpgCameraRig: true,
    },
    streaming: { ...DEFAULT_STREAMING, enabled: false, exportByCell: false },
    actors: [floor, ...walls, portal, start, sun],
  }
}

function linkInteriorLevel(level = buildRpgInteriorLevel()) {
  const key = sanitizeLevelKey(RPG_INTERIOR_LEVEL_KEY)
  const link = { name: key, level: JSON.parse(JSON.stringify(level)) as SerializedLevel }
  const idx = world.levelLinks.findIndex((l) => sanitizeLevelKey(l.name) === key)
  if (idx >= 0) world.levelLinks[idx] = link
  else world.levelLinks.push(link)
  return key
}

/** Spawn 2×2 overworld greybox with streaming + interior portal link. */
export function spawnRpgOverworldStarter() {
  const terrain: SerializedActor[] = []
  const markers: SerializedActor[] = []

  for (const cell of CELL_DEFS) {
    const [x, , z] = cellCenter(cell.cx, cell.cz)
    const cellCoord: [number, number] = [cell.cx, cell.cz]
    terrain.push(
      starterBox(`OverworldCell_${cell.key}`, [x, -0.1, z], [60, 0.2, 60], cell.color, cellCoord),
    )
    markers.push(
      starterBox(`OverworldMarker_${cell.key}`, [x, 1.2, z], [2, 2.4, 2], '#6b7280', cellCoord),
    )
  }

  const [vx, , vz] = cellCenter(1, 1)
  const villageCell: [number, number] = [1, 1]
  const cottage = starterBox(
    'OverworldCottage',
    [vx - 8, 1.2, vz - 4],
    [5, 2.4, 4],
    '#6b5b4a',
    villageCell,
  )
  const portal = portalTrigger(
    PORTAL_INTERIOR_NAME,
    [vx, 1, vz + 6],
    [4, 2, 3],
    PORTAL_INTERIOR_TAG,
    RPG_INTERIOR_LEVEL_KEY,
    villageCell,
  )

  const start = buildSerializedActor({ kind: 'playerstart' }, cellCenter(0, 0))
  start.name = 'OverworldPlayerStart'
  start.transform.position[1] = 0.2
  start.pawnMode = 'thirdperson' as PawnMode

  const sun = buildSerializedActor({ kind: 'light', type: 'DirectionalLight' }, [32, 24, 16])
  sun.name = 'OverworldSun'
  const manager = buildOverworldManager()

  const undoNames = [
    ...terrain.map((t) => t.name),
    ...markers.map((m) => m.name),
    'OverworldCottage',
    PORTAL_INTERIOR_NAME,
    'OverworldPlayerStart',
    'OverworldSun',
    RPG_OVERWORLD_MANAGER_NAME,
  ]

  const prevStreaming = { ...world.streaming }
  const prevLevelName = world.levelName
  const prevLinks = JSON.parse(JSON.stringify(world.levelLinks)) as typeof world.levelLinks

  runCommand({
    label: 'RPG overworld starter (2×2 streaming)',
    execute() {
      for (const sa of [...terrain, ...markers, cottage, portal, start, sun, manager]) {
        new AddActorCommand(sa).execute()
      }
      world.streaming = { ...RPG_OVERWORLD_STREAMING }
      world.levelName = 'Overworld'
      world.environment.useRapierCharacter = true
      world.environment.rpgCameraRig = true
      world.environment.crossLevelSaves = true
      world.applyEnvironment()
      linkInteriorLevel()
      useEditor.getState().setStatus('RPG overworld: 2×2 cells + interior link')
      useEditor.getState().touch()
    },
    undo() {
      removeActorsByName(undoNames)
      world.streaming = prevStreaming
      world.levelName = prevLevelName
      world.levelLinks = prevLinks
      useEditor.getState().touch()
    },
  })
}

/** Register or replace the linked interior snapshot for export / PIE scene switching. */
export function linkRpgInteriorLevel(level?: SerializedLevel) {
  return linkInteriorLevel(level ?? buildRpgInteriorLevel())
}