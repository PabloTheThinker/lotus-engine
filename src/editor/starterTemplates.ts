import type { PawnMode } from '../engine/types'
import { world } from '../engine/World'
import { AddActorCommand, runCommand } from './commands'
import { buildSerializedActor } from './spawn'
import { useEditor } from './store'

export type CharacterStarterMode = 'firstperson' | 'thirdperson' | 'fly'

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