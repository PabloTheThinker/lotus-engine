import type { PawnMode } from '../engine/types'
import { world } from '../engine/World'
import {
  MP_SCORE_VAR,
  MP_SCORE_WIN,
  MP_SCOREBOARD_NAME,
  MP_TAG_TARGET,
  applyMpScoreDelta,
} from '../engine/mpGameplay'
import { mpSetScoreDeltaHandler } from '../engine/multiplayer'
import { AddActorCommand, runCommand } from './commands'
import { buildSerializedActor } from './spawn'
import { useEditor } from './store'
import { MP_TAG_HOST } from './indieMpTemplate'
import type { HudWidget } from '../engine/types'

export {
  MP_TAG_TARGET,
  MP_SCORE_WIN,
  MP_SCOREBOARD_NAME,
  MP_SCORE_VAR,
  findMpScoreboard,
  getMpScore,
  addMpScore,
  applyMpScoreDelta,
} from '../engine/mpGameplay'

/** PlayerStart script — Fire raycast vs mp_target → api.addMpScore(1). */
export const MP_SCORE_SCRIPT = `// mp_score — deathmatch lite (host authoritative)
// @export winScore = 3
function onTick(_dt) {
  if (!api.mpConnected()) return
  if (!api.actionJustPressed('Fire')) return
  const pos = api.pawnPosition()
  if (!pos) return
  const yaw = api.pawnYaw()
  const pitch = api.pawnPitch()
  const cosP = Math.cos(pitch)
  const dir = [-Math.sin(yaw) * cosP, Math.sin(pitch), -Math.cos(yaw) * cosP]
  const origin = [pos.x, pos.y + 1.4, pos.z]
  const hit = api.raycast(origin, dir, 80)
  if (!hit || !hit.actor.tags.includes('mp_target')) return
  api.addMpScore(1)
  api.on('mp_game_won', (winnerId, score) => {
    api.log('MP winner: ' + winnerId + ' (' + score + ')')
  })
}
`

/** Scoreboard actor — host owns peerScores scriptVar, replicated to clients. */
export const MP_SCOREBOARD_SCRIPT = `// mp_scoreboard — host score state + HUD refresh
// @export winScore = 3
// @export peerScores = {}
function onBeginPlay() {
  if (!api.mpIsHost()) return
  const scores = { ...(vars.peerScores || {}) }
  scores[api.mpLocalId()] = scores[api.mpLocalId()] ?? 0
  actor.scriptVars = { ...(actor.scriptVars ?? {}), peerScores: scores }
}
function onTick(_dt) {
  const scores = (actor.scriptVars?.peerScores ?? vars.peerScores ?? {}) as Record<string, number>
  if (api.mpIsHost()) {
    const merged = { ...scores }
    merged[api.mpLocalId()] = merged[api.mpLocalId()] ?? 0
    actor.scriptVars = { ...(actor.scriptVars ?? {}), peerScores: merged }
  }
  const lines = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([id, s]) => id.slice(0, 4) + ':' + s)
    .join('  ')
  const cap = vars.winScore as number
  api.hud.text('mp_score_hud', lines ? 'DM ' + lines + ' /' + cap : 'DM —', {
    anchor: 'tr',
    x: 16,
    y: 16,
    size: 17,
    color: '#e8ecf0',
  })
}
`

function starterBox(
  name: string,
  position: [number, number, number],
  scale: [number, number, number],
  color = '#5b6b7a',
) {
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

function buildScoreboardActor() {
  const board = buildSerializedActor({ kind: 'empty' }, [0, 2, 0])
  board.name = MP_SCOREBOARD_NAME
  board.script = MP_SCOREBOARD_SCRIPT
  board.scriptVars = { [MP_SCORE_VAR]: {}, winScore: MP_SCORE_WIN }
  board.syncProperties = [MP_SCORE_VAR]
  return board
}

function buildTarget(name: string, position: [number, number, number], color: string) {
  const target = starterBox(name, position, [0.9, 1.4, 0.9], color)
  target.tags = [MP_TAG_TARGET]
  target.material!.emissive = color
  target.material!.emissiveIntensity = 0.35
  return target
}

const MP_SCORE_HUD_WIDGET: HudWidget = {
  id: 'mp_score_hud',
  type: 'text',
  text: 'DM —',
  anchor: 'tr',
  x: 16,
  y: 16,
  size: 17,
  color: '#e8ecf0',
}

/**
 * Indie MP deathmatch greybox — floor, spawns with MP_SCORE_SCRIPT,
 * mp_target dummies, scoreboard actor, score HUD widget.
 */
export function spawnIndieMpDeathmatch() {
  const floor = starterBox('MpDmFloor', [0, -0.1, 0], [18, 0.2, 18], '#4a5568')
  floor.material!.roughness = 0.85

  const host = buildSerializedActor({ kind: 'playerstart' }, [-5, 0.2, 0])
  host.name = 'HostSpawn'
  host.pawnMode = 'thirdperson' as PawnMode
  host.tags = [MP_TAG_HOST]
  host.script = MP_SCORE_SCRIPT

  const client = buildSerializedActor({ kind: 'playerstart' }, [5, 0.2, 0])
  client.name = 'ClientSpawn'
  client.pawnMode = 'thirdperson' as PawnMode
  client.script = MP_SCORE_SCRIPT

  const targetA = buildTarget('MpTargetA', [0, 0.7, -4], '#e07a5f')
  const targetB = buildTarget('MpTargetB', [-3, 0.7, 2], '#81b29a')
  const targetC = buildTarget('MpTargetC', [3, 0.7, 2], '#f2cc8f')

  const scoreboard = buildScoreboardActor()
  const sun = buildSerializedActor({ kind: 'light', type: 'DirectionalLight' }, [6, 12, 4])

  const undoNames = [
    'MpDmFloor',
    'HostSpawn',
    'ClientSpawn',
    'MpTargetA',
    'MpTargetB',
    'MpTargetC',
    MP_SCOREBOARD_NAME,
    'DirectionalLight',
  ]

  runCommand({
    label: 'Indie MP deathmatch',
    execute() {
      for (const sa of [floor, host, client, targetA, targetB, targetC, scoreboard, sun]) {
        new AddActorCommand(sa).execute()
      }
      world.environment.useRapierCharacter = true
      world.applyEnvironment()
      const hasHud = world.hudWidgets.some((w) => w.id === MP_SCORE_HUD_WIDGET.id)
      if (!hasHud) world.hudWidgets.push({ ...MP_SCORE_HUD_WIDGET })
      useEditor.getState().setStatus('Indie MP deathmatch — first to 3 wins (Fire / KeyF)')
      useEditor.getState().touch()
    },
    undo() {
      removeActorsByName(undoNames)
      world.hudWidgets = world.hudWidgets.filter((w) => w.id !== MP_SCORE_HUD_WIDGET.id)
      useEditor.getState().touch()
    },
  })
}

/** Host applies score deltas requested by clients over the relay. */
mpSetScoreDeltaHandler((peerId, delta) => {
  applyMpScoreDelta(world.actors, peerId, delta, (signal, ...args) => world.playApi?.emit(signal, ...args))
})