import type { PawnMode } from '../engine/types'
import { world } from '../engine/World'
import { AddActorCommand, runCommand } from './commands'
import { buildSerializedActor } from './spawn'
import { useEditor } from './store'

export type CharacterStarterMode = 'firstperson' | 'thirdperson' | 'fly'
export type PlatformerStarterMode = 'side' | 'wide'
export type TopDownRpgStarterMode = 'small' | 'large'

function starterBox(
  name: string,
  position: [number, number, number],
  scale: [number, number, number],
  color = '#5b6b7a',
): ReturnType<typeof buildSerializedActor> {
  const box = buildSerializedActor({ kind: 'mesh', geometry: 'box' }, position)
  box.name = name
  box.transform.scale = scale
  box.material = {
    ...box.material!,
    color,
    roughness: 0.8,
    metalness: 0.05,
    emissive: '#000000',
    emissiveIntensity: 1,
    wireframe: false,
    opacity: 1,
    transparent: false,
  }
  box.physics = { mode: 'static', mass: 1, friction: 0.6, restitution: 0 }
  return box
}

function removeActorsByName(names: string[]) {
  for (const name of names) {
    const a = [...world.actors.values()].find((x) => x.name === name)
    if (a) world.removeActor(a.id)
  }
}

/** Greybox CharacterBody starter — floor, player start, sun (Godot template analog). */
export function spawnCharacterStarter(mode: CharacterStarterMode = 'thirdperson') {
  const floor = starterBox('StarterFloor', [0, -0.1, 0], [20, 0.2, 20], '#4a5568')
  floor.material!.roughness = 0.85
  floor.physics!.restitution = 0.1

  const start = buildSerializedActor({ kind: 'playerstart' }, [0, 0.2, 4])
  start.name = 'StarterPlayerStart'
  start.pawnMode = mode as PawnMode

  const sun = buildSerializedActor({ kind: 'light', type: 'DirectionalLight' }, [6, 12, 4])

  runCommand({
    label: `Character starter (${mode})`,
    execute() {
      for (const a of [...world.actors.values()]) {
        if (a.type === 'PlayerStart' && a.name !== start.name) world.removeActor(a.id)
      }
      for (const sa of [floor, start, sun]) new AddActorCommand(sa).execute()
      world.environment.useRapierCharacter = mode !== 'fly'
      world.applyEnvironment()
      useEditor.getState().setStatus(`Character starter: ${mode}`)
      useEditor.getState().touch()
    },
    undo() {
      removeActorsByName(['StarterFloor', 'StarterPlayerStart', 'DirectionalLight'])
      useEditor.getState().touch()
    },
  })
}

/** Greybox platformer starter — ground, stepping platforms, player start (Rapier character). */
export function spawnPlatformerStarter(mode: PlatformerStarterMode = 'side') {
  const floor = starterBox('PlatformerFloor', [0, -0.1, 0], mode === 'wide' ? [24, 0.2, 12] : [18, 0.2, 6], '#3d4a56')
  const platforms =
    mode === 'wide'
      ? [
          starterBox('PlatA', [-6, 0.8, 0], [4, 0.4, 3]),
          starterBox('PlatB', [0, 1.6, 0], [4, 0.4, 3]),
          starterBox('PlatC', [6, 2.4, 0], [4, 0.4, 3]),
        ]
      : [
          starterBox('PlatA', [-4, 0.8, 0], [3, 0.4, 2.5]),
          starterBox('PlatB', [0, 1.6, 0], [3, 0.4, 2.5]),
          starterBox('PlatC', [4, 2.4, 0], [3, 0.4, 2.5]),
        ]
  const start = buildSerializedActor({ kind: 'playerstart' }, [mode === 'wide' ? -8 : -6, 0.2, 0])
  start.name = 'PlatformerPlayerStart'
  start.pawnMode = 'thirdperson'
  const sun = buildSerializedActor({ kind: 'light', type: 'DirectionalLight' }, [4, 10, 6])

  runCommand({
    label: `Platformer starter (${mode})`,
    execute() {
      for (const sa of [floor, ...platforms, start, sun]) new AddActorCommand(sa).execute()
      world.environment.useRapierCharacter = true
      world.applyEnvironment()
      useEditor.getState().setStatus(`Platformer starter: ${mode}`)
      useEditor.getState().touch()
    },
    undo() {
      removeActorsByName(['PlatformerFloor', 'PlatA', 'PlatB', 'PlatC', 'PlatformerPlayerStart', 'DirectionalLight'])
      useEditor.getState().touch()
    },
  })
}

function npcMarker(name: string, position: [number, number, number]): ReturnType<typeof buildSerializedActor> {
  const empty = buildSerializedActor({ kind: 'empty' }, position)
  empty.name = name
  empty.tags = ['NPC']
  return empty
}

function questTrigger(
  name: string,
  position: [number, number, number],
  scale: [number, number, number],
): ReturnType<typeof buildSerializedActor> {
  const trig = buildSerializedActor({ kind: 'trigger' }, position)
  trig.name = name
  trig.transform.scale = scale
  return trig
}

/** Greybox top-down RPG starter — floor, obstacles, tagged NPC markers, PlayerStart, sun, quest trigger. */
export function spawnTopDownRpgStarter(mode: TopDownRpgStarterMode = 'small') {
  const large = mode === 'large'
  const floor = starterBox('RpgFloor', [0, -0.1, 0], large ? [32, 0.2, 32] : [16, 0.2, 16], '#3d5a4a')
  const obstacles = large
    ? [
        starterBox('RpgWallN', [0, 1, -14], [28, 2, 0.6], '#4a5568'),
        starterBox('RpgWallS', [0, 1, 14], [28, 2, 0.6], '#4a5568'),
        starterBox('RpgWallW', [-14, 1, 0], [0.6, 2, 28], '#4a5568'),
        starterBox('RpgWallE', [14, 1, 0], [0.6, 2, 28], '#4a5568'),
        starterBox('RpgObstacleA', [-8, 0.75, -6], [3, 1.5, 3], '#5b6b7a'),
        starterBox('RpgObstacleB', [7, 0.75, 4], [4, 1.5, 2.5], '#5b6b7a'),
        starterBox('RpgObstacleC', [-3, 0.5, 8], [5, 1, 2], '#5b6b7a'),
        starterBox('RpgObstacleD', [9, 0.5, -9], [2.5, 1, 4], '#5b6b7a'),
      ]
    : [
        starterBox('RpgWallN', [0, 1, -7], [14, 2, 0.6], '#4a5568'),
        starterBox('RpgWallS', [0, 1, 7], [14, 2, 0.6], '#4a5568'),
        starterBox('RpgWallW', [-7, 1, 0], [0.6, 2, 14], '#4a5568'),
        starterBox('RpgWallE', [7, 1, 0], [0.6, 2, 14], '#4a5568'),
        starterBox('RpgObstacleA', [-4, 0.75, -2], [2, 1.5, 2], '#5b6b7a'),
        starterBox('RpgObstacleB', [3, 0.75, 3], [2.5, 1.5, 2], '#5b6b7a'),
      ]
  const npcs = large
    ? [npcMarker('RpgNpcA', [-6, 0, -3]), npcMarker('RpgNpcB', [5, 0, 2]), npcMarker('RpgNpcC', [-2, 0, 6]), npcMarker('RpgNpcD', [8, 0, -5])]
    : [npcMarker('RpgNpcA', [-3, 0, -1]), npcMarker('RpgNpcB', [3, 0, 3])]
  const start = buildSerializedActor({ kind: 'playerstart' }, [0, 0.2, large ? 10 : 5])
  start.name = 'RpgPlayerStart'
  start.pawnMode = 'thirdperson'
  const sun = buildSerializedActor({ kind: 'light', type: 'DirectionalLight' }, [8, 14, 6])
  const quest = questTrigger('RpgQuestZone', [0, 1, 0], large ? [10, 2, 10] : [6, 2, 6])

  const undoNames = [
    'RpgFloor',
    ...obstacles.map((o) => o.name),
    ...npcs.map((n) => n.name),
    'RpgPlayerStart',
    'DirectionalLight',
    'RpgQuestZone',
  ]

  runCommand({
    label: `Top-down RPG starter (${mode})`,
    execute() {
      for (const sa of [floor, ...obstacles, ...npcs, start, sun, quest]) new AddActorCommand(sa).execute()
      world.environment.useRapierCharacter = true
      world.applyEnvironment()
      useEditor.getState().setStatus(`Top-down RPG starter: ${mode}`)
      useEditor.getState().touch()
    },
    undo() {
      removeActorsByName(undoNames)
      useEditor.getState().touch()
    },
  })
}

function fpsLight(name: string, position: [number, number, number]): ReturnType<typeof buildSerializedActor> {
  const light = buildSerializedActor({ kind: 'light', type: 'PointLight' }, position)
  light.name = name
  light.light!.intensity = 14
  light.light!.distance = 18
  return light
}

/** Greybox FPS starter — corridor boxes, first-person PlayerStart, point lights (Rapier character). */
export function spawnFpsStarter() {
  const floor = starterBox('FpsFloor', [0, -0.1, 0], [6, 0.2, 28], '#2d3748')
  const walls = [
    starterBox('FpsWallL1', [-3, 1.5, -6], [0.4, 3, 12], '#4a5568'),
    starterBox('FpsWallR1', [3, 1.5, -6], [0.4, 3, 12], '#4a5568'),
    starterBox('FpsWallL2', [-3, 1.5, 8], [0.4, 3, 10], '#4a5568'),
    starterBox('FpsWallR2', [3, 1.5, 8], [0.4, 3, 10], '#4a5568'),
    starterBox('FpsWallEnd', [0, 1.5, 13], [6, 3, 0.4], '#4a5568'),
    starterBox('FpsWallRoom', [1.5, 1.5, 2], [0.4, 3, 4], '#5b6b7a'),
    starterBox('FpsCrateA', [-1.2, 0.4, 6], [0.8, 0.8, 0.8], '#6b7280'),
    starterBox('FpsCrateB', [1.4, 0.5, 9], [1, 1, 1], '#6b7280'),
  ]
  const start = buildSerializedActor({ kind: 'playerstart' }, [0, 0.2, -12])
  start.name = 'FpsPlayerStart'
  start.pawnMode = 'firstperson'
  const lights = [fpsLight('FpsLight1', [0, 2.5, -4]), fpsLight('FpsLight2', [0, 2.5, 4]), fpsLight('FpsLight3', [0, 2.5, 10])]

  const undoNames = ['FpsFloor', ...walls.map((w) => w.name), 'FpsPlayerStart', ...lights.map((l) => l.name)]

  runCommand({
    label: 'FPS starter',
    execute() {
      for (const sa of [floor, ...walls, start, ...lights]) new AddActorCommand(sa).execute()
      world.environment.useRapierCharacter = true
      world.applyEnvironment()
      useEditor.getState().setStatus('FPS starter')
      useEditor.getState().touch()
    },
    undo() {
      removeActorsByName(undoNames)
      useEditor.getState().touch()
    },
  })
}