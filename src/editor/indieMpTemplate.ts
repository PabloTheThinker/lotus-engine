import type { PawnMode } from '../engine/types'
import { loadMPSettings, saveMPSettings } from '../engine/multiplayer'
import { world } from '../engine/World'
import { AddActorCommand, runCommand } from './commands'
import { buildSerializedActor } from './spawn'
import { useEditor } from './store'

/** Gameplay tags for the indie multiplayer greybox demo. */
export const MP_TAG_HOST = 'mp_host'
export const MP_TAG_SYNC = 'mp_sync'

/** Host PlayerStart script — logs role; host drives mp_sync crate count on Jump. */
export const MP_HOST_SCRIPT = `// mp_host — indie MP template host spawn
function onBeginPlay() {
  api.log(api.mpIsHost() ? 'MP host ready' : 'MP client — host sync pending')
}
function onTick(_dt) {
  if (!api.mpIsHost()) return
  if (api.actionJustPressed('Jump')) {
    const n = api.getActorsByTag('mp_sync').length
    api.log('Host sync crates: ' + n)
  }
}
`

/** Sync-spawn crate script — host rotates; clients interpolate via syncProperties. */
export const MP_SYNC_SCRIPT = `// mp_sync — sync-spawn demo (host authority)
// @export spinSpeed = 1.2
function onTick(dt) {
  if (!api.mpIsHost()) return
  actor.root.rotation.y += dt * vars.spinSpeed
}
`

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

function syncCrate(
  name: string,
  position: [number, number, number],
  color: string,
): ReturnType<typeof buildSerializedActor> {
  const crate = starterBox(name, position, [1, 1, 1], color)
  crate.tags = [MP_TAG_SYNC]
  crate.syncSpawn = true
  crate.syncProperties = ['position', 'rotation']
  crate.script = MP_SYNC_SCRIPT
  return crate
}

function removeActorsByName(names: string[]) {
  for (const name of names) {
    const a = [...world.actors.values()].find((x) => x.name === name)
    if (a) world.removeActor(a.id)
  }
}

/** Enable multiplayer + room in localStorage (World Settings → Multiplayer). */
export function configureIndieMpSettings(room = 'indie-mp') {
  const prev = loadMPSettings()
  saveMPSettings({ ...prev, enabled: true, room })
}

/**
 * Greybox indie multiplayer template — floor, HostSpawn + ClientSpawn,
 * sync-spawn tagged crates (mp_sync), directional sun.
 */
export function spawnIndieMpTemplate() {
  const floor = starterBox('MpFloor', [0, -0.1, 0], [16, 0.2, 16], '#4a5568')
  floor.material!.roughness = 0.85

  const host = buildSerializedActor({ kind: 'playerstart' }, [-4, 0.2, 0])
  host.name = 'HostSpawn'
  host.pawnMode = 'thirdperson' as PawnMode
  host.tags = [MP_TAG_HOST]
  host.script = MP_HOST_SCRIPT

  const client = buildSerializedActor({ kind: 'playerstart' }, [4, 0.2, 0])
  client.name = 'ClientSpawn'
  client.pawnMode = 'thirdperson' as PawnMode

  const crateA = syncCrate('MpCrateA', [-2, 0.5, -3], '#6b8cae')
  const crateB = syncCrate('MpCrateB', [2, 0.5, 3], '#8cae6b')

  const sun = buildSerializedActor({ kind: 'light', type: 'DirectionalLight' }, [6, 12, 4])

  const undoNames = ['MpFloor', 'HostSpawn', 'ClientSpawn', 'MpCrateA', 'MpCrateB', 'DirectionalLight']

  runCommand({
    label: 'Indie MP starter',
    execute() {
      for (const sa of [floor, host, client, crateA, crateB, sun]) new AddActorCommand(sa).execute()
      world.environment.useRapierCharacter = true
      world.applyEnvironment()
      useEditor.getState().setStatus('Indie MP starter — enable Multiplayer in World Settings, then Play')
      useEditor.getState().touch()
    },
    undo() {
      removeActorsByName(undoNames)
      useEditor.getState().touch()
    },
  })
}