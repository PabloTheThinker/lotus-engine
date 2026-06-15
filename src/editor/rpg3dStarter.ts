import type { PawnMode } from '../engine/types'
import { world } from '../engine/World'
import { AddActorCommand, runCommand } from './commands'
import { buildSerializedActor } from './spawn'
import { useEditor } from './store'

export type Rpg3dStarterMode = 'small' | 'large'

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
    roughness: 0.82,
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

function villageProp(
  name: string,
  position: [number, number, number],
  scale: [number, number, number],
  color: string,
): ReturnType<typeof buildSerializedActor> {
  const prop = starterBox(name, position, scale, color)
  prop.material!.roughness = 0.75
  return prop
}

/** 3D third-person RPG greybox — uneven terrain, village props, spring-arm camera. */
export function spawnRpg3dStarter(mode: Rpg3dStarterMode = 'small') {
  const large = mode === 'large'
  const terrain = large
    ? [
        starterBox('Rpg3dGround', [0, -0.1, 0], [36, 0.2, 36], '#3d5a4a'),
        starterBox('Rpg3dPathA', [-6, 0.15, 4], [8, 0.3, 3], '#4a5d52'),
        starterBox('Rpg3dStepA', [-2, 0.45, 0], [4, 0.5, 2.5], '#5a6b62'),
        starterBox('Rpg3dStepB', [2, 0.85, -2], [4, 0.5, 2.5], '#5a6b62'),
        starterBox('Rpg3dStepC', [6, 1.25, -5], [4, 0.5, 2.5], '#5a6b62'),
        starterBox('Rpg3dHill', [12, 1.4, -10], [10, 2.8, 8], '#4d6b55'),
        starterBox('Rpg3dRidge', [-12, 0.9, -8], [7, 1.8, 5], '#4d6b55'),
        starterBox('Rpg3dBridge', [0, 0.55, -8], [5, 0.25, 2], '#6b7280'),
      ]
    : [
        starterBox('Rpg3dGround', [0, -0.1, 0], [18, 0.2, 18], '#3d5a4a'),
        starterBox('Rpg3dPathA', [-3, 0.15, 3], [6, 0.3, 2.5], '#4a5d52'),
        starterBox('Rpg3dStepA', [0, 0.45, 0], [3, 0.5, 2], '#5a6b62'),
        starterBox('Rpg3dStepB', [3, 0.85, -2], [3, 0.5, 2], '#5a6b62'),
        starterBox('Rpg3dHill', [6, 1.1, -5], [6, 2.2, 5], '#4d6b55'),
      ]

  const props = large
    ? [
        villageProp('Rpg3dCottageA', [-10, 1.2, 6], [5, 2.4, 4], '#6b5b4a'),
        villageProp('Rpg3dCottageB', [-5, 1.2, 10], [4, 2.4, 3.5], '#7a6a58'),
        villageProp('Rpg3dWell', [4, 0.55, 8], [1.2, 1.1, 1.2], '#4a5568'),
        villageProp('Rpg3dCart', [8, 0.35, 5], [2, 0.7, 1.4], '#8b7355'),
        villageProp('Rpg3dFenceA', [-8, 0.45, 2], [0.2, 0.9, 6], '#5c4a3a'),
        villageProp('Rpg3dFenceB', [10, 0.45, 0], [0.2, 0.9, 8], '#5c4a3a'),
        villageProp('Rpg3dShrine', [14, 1.6, -12], [2.5, 3.2, 2.5], '#4a5568'),
      ]
    : [
        villageProp('Rpg3dCottageA', [-5, 1.2, 5], [4, 2.4, 3.5], '#6b5b4a'),
        villageProp('Rpg3dWell', [2, 0.55, 6], [1.2, 1.1, 1.2], '#4a5568'),
        villageProp('Rpg3dFenceA', [-4, 0.45, 1], [0.2, 0.9, 4], '#5c4a3a'),
      ]

  const npcs = large
    ? [
        npcMarker('Rpg3dNpcA', [-7, 0.2, 7]),
        npcMarker('Rpg3dNpcB', [3, 0.2, 9]),
        npcMarker('Rpg3dNpcC', [11, 1.5, -8]),
        npcMarker('Rpg3dNpcD', [-11, 0.2, -4]),
      ]
    : [npcMarker('Rpg3dNpcA', [-4, 0.2, 4]), npcMarker('Rpg3dNpcB', [5, 0.2, 3])]

  const start = buildSerializedActor({ kind: 'playerstart' }, [0, 0.2, large ? 12 : 7])
  start.name = 'Rpg3dPlayerStart'
  start.pawnMode = 'thirdperson' as PawnMode

  const sun = buildSerializedActor({ kind: 'light', type: 'DirectionalLight' }, [10, 16, 8])
  const quest = questTrigger('Rpg3dQuestZone', [large ? 12 : 6, 1.5, large ? -10 : -4], large ? [8, 3, 8] : [5, 3, 5])

  const undoNames = [
    ...terrain.map((t) => t.name),
    ...props.map((p) => p.name),
    ...npcs.map((n) => n.name),
    'Rpg3dPlayerStart',
    'DirectionalLight',
    'Rpg3dQuestZone',
  ]

  runCommand({
    label: `3D RPG starter (${mode})`,
    execute() {
      for (const sa of [...terrain, ...props, ...npcs, start, sun, quest]) new AddActorCommand(sa).execute()
      world.environment.useRapierCharacter = true
      world.environment.rpgCameraRig = true
      world.applyEnvironment()
      useEditor.getState().setStatus(`3D RPG starter: ${mode}`)
      useEditor.getState().touch()
    },
    undo() {
      removeActorsByName(undoNames)
      useEditor.getState().touch()
    },
  })
}