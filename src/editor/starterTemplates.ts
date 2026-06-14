import type { PawnMode } from '../engine/types'
import { world } from '../engine/World'
import { AddActorCommand, runCommand } from './commands'
import { buildSerializedActor } from './spawn'
import { useEditor } from './store'

export type CharacterStarterMode = 'firstperson' | 'thirdperson' | 'fly'
export type PlatformerStarterMode = 'side' | 'wide'

/** Greybox CharacterBody starter — floor, player start, sun (Godot template analog). */
export function spawnCharacterStarter(mode: CharacterStarterMode = 'thirdperson') {
  const floor = buildSerializedActor({ kind: 'mesh', geometry: 'box' }, [0, -0.1, 0])
  floor.name = 'StarterFloor'
  floor.transform.scale = [20, 0.2, 20]
  floor.material = { ...floor.material!, color: '#4a5568', roughness: 0.85, metalness: 0.05, emissive: '#000000', emissiveIntensity: 1, wireframe: false, opacity: 1, transparent: false }
  floor.physics = { mode: 'static', mass: 1, friction: 0.6, restitution: 0.1 }

  const start = buildSerializedActor({ kind: 'playerstart' }, [0, 0.2, 4])
  start.name = 'StarterPlayerStart'
  start.pawnMode = mode as PawnMode

  const sun = buildSerializedActor({ kind: 'light', type: 'DirectionalLight' }, [6, 12, 4])

  runCommand({
    label: `Character starter (${mode})`,
    execute() {
      for (const sa of [floor, start, sun]) new AddActorCommand(sa).execute()
      world.environment.useRapierCharacter = mode !== 'fly'
      world.applyEnvironment()
      useEditor.getState().setStatus(`Character starter: ${mode}`)
      useEditor.getState().touch()
    },
    undo() {
      for (const name of ['StarterFloor', 'StarterPlayerStart', 'DirectionalLight']) {
        const a = [...world.actors.values()].find((x) => x.name === name)
        if (a) world.removeActor(a.id)
      }
      useEditor.getState().touch()
    },
  })
}

function platformBox(
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

/** Greybox platformer starter — ground, stepping platforms, player start (Rapier character). */
export function spawnPlatformerStarter(mode: PlatformerStarterMode = 'side') {
  const floor = platformBox('PlatformerFloor', [0, -0.1, 0], mode === 'wide' ? [24, 0.2, 12] : [18, 0.2, 6], '#3d4a56')
  const platforms =
    mode === 'wide'
      ? [
          platformBox('PlatA', [-6, 0.8, 0], [4, 0.4, 3]),
          platformBox('PlatB', [0, 1.6, 0], [4, 0.4, 3]),
          platformBox('PlatC', [6, 2.4, 0], [4, 0.4, 3]),
        ]
      : [
          platformBox('PlatA', [-4, 0.8, 0], [3, 0.4, 2.5]),
          platformBox('PlatB', [0, 1.6, 0], [3, 0.4, 2.5]),
          platformBox('PlatC', [4, 2.4, 0], [3, 0.4, 2.5]),
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
      for (const name of ['PlatformerFloor', 'PlatA', 'PlatB', 'PlatC', 'PlatformerPlayerStart', 'DirectionalLight']) {
        const a = [...world.actors.values()].find((x) => x.name === name)
        if (a) world.removeActor(a.id)
      }
      useEditor.getState().touch()
    },
  })
}