import type { PawnMode } from '../engine/types'
import { world } from '../engine/World'
import {
  MP_SCORE_VAR,
  MP_SCORE_WIN,
  MP_SCOREBOARD_NAME,
  MP_TAG_TARGET,
  applyMpScoreDelta,
  mirrorMpPeerScores,
} from '../engine/mpGameplay'
import {
  mpLobbyRoom,
  mpSetGameWonRelayHandler,
  mpSetLobbyRefreshHandler,
  mpSetLobbyStartHandler,
  mpSetPeerScoresMirrorHandler,
  mpSetScoreDeltaHandler,
} from '../engine/multiplayer'
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
  getMpPeerScores,
  mirrorMpPeerScores,
  addMpScore,
  applyMpScoreDelta,
} from '../engine/mpGameplay'

export const MP_LOBBY_MANAGER_NAME = 'MpLobbyManager'
export const MP_SPECTATOR_MANAGER_NAME = 'MpSpectatorManager'
export const MP_TAG_LOBBY = 'mp_lobby'
export const MP_TAG_SPECTATOR = 'mp_spectator'

/** Lobby manager — room browser HUD + ready-up; deathmatch spawns on lobby_start. */
export const MP_LOBBY_SCRIPT = `// mp_lobby — room browser + ready-up + matchmaking (Wave 53/58)
function refreshHud() {
  const room = api.mpLobbyRoom()
  const peers = api.mpLobbyPeers()
  const lines = peers
    .map((id) => id.slice(0, 4) + (api.mpLobbyIsReady(id) ? '✓' : '…'))
    .join('  ')
  const count = api.mpLobbyPeerReadyCount()
  const ping = api.mpPingMs()
  const pingLabel = ping != null ? ping + 'ms' : '…'
  const publicRooms = api.mpListRooms()
  const roomLines = publicRooms
    .map((r) => r.room + (r.room === room ? '●' : '') + '(' + r.peers + ')')
    .join('  ')
  api.hud.text('mp_lobby_room', 'Room ' + room + ' · ' + pingLabel, { anchor: 'tc', x: 0, y: 24, size: 18, color: '#e8ecf0' })
  api.hud.text('mp_lobby_rooms', publicRooms.length ? roomLines : 'No public rooms…', {
    anchor: 'tc',
    x: 0,
    y: 48,
    size: 13,
    color: '#7c8a9a',
  })
  api.hud.text('mp_lobby_peers', peers.length ? lines : 'Waiting for peers…', {
    anchor: 'tc',
    x: 0,
    y: 72,
    size: 15,
    color: '#9aa4b2',
  })
  api.hud.text('mp_lobby_ready', count + '/' + peers.length + ' ready', {
    anchor: 'tc',
    x: 0,
    y: 98,
    size: 14,
    color: '#81b29a',
  })
}
function onBeginPlay() {
  api.mpRefreshRooms()
  refreshHud()
  api.on('mp_lobby_refresh', refreshHud)
  const localId = api.mpLocalId()
  const toggleReady = () => {
    const next = !api.mpLobbyIsReady(localId)
    api.mpLobbySetReady(next)
    api.hud.button('mp_lobby_btn', next ? 'Unready' : 'Ready', toggleReady, {
      anchor: 'bc',
      x: 0,
      y: 72,
      size: 16,
      color: next ? '#81b29a' : '#2f80ed',
    })
    refreshHud()
  }
  api.hud.button('mp_lobby_btn', 'Ready', toggleReady, {
    anchor: 'bc',
    x: 0,
    y: 72,
    size: 16,
    color: '#2f80ed',
  })
  if (api.mpIsHost()) {
    api.hud.button('mp_lobby_start', 'Start match', () => api.mpLobbyTryStart(), {
      anchor: 'bc',
      x: 0,
      y: 120,
      size: 15,
      color: '#7c3aed',
    })
  }
}
function onTick(_dt) {
  refreshHud()
}
`

const MP_LOBBY_HUD_WIDGETS: HudWidget[] = [
  {
    id: 'mp_lobby_room',
    type: 'text',
    text: 'Room —',
    anchor: 'tc',
    x: 0,
    y: 24,
    size: 18,
    color: '#e8ecf0',
  },
  {
    id: 'mp_lobby_rooms',
    type: 'text',
    text: 'Rooms…',
    anchor: 'tc',
    x: 0,
    y: 48,
    size: 13,
    color: '#7c8a9a',
  },
  {
    id: 'mp_lobby_peers',
    type: 'text',
    text: 'Waiting…',
    anchor: 'tc',
    x: 0,
    y: 72,
    size: 15,
    color: '#9aa4b2',
  },
  {
    id: 'mp_lobby_ready',
    type: 'text',
    text: '0/0 ready',
    anchor: 'tc',
    x: 0,
    y: 98,
    size: 14,
    color: '#81b29a',
  },
  {
    id: 'mp_lobby_btn',
    type: 'button',
    text: 'Ready',
    signal: 'mp_lobby_toggle_ready',
    anchor: 'bc',
    x: 0,
    y: 72,
    size: 16,
    color: '#2f80ed',
  },
  {
    id: 'mp_lobby_start',
    type: 'button',
    text: 'Start match',
    signal: 'mp_lobby_start_btn',
    anchor: 'bc',
    x: 0,
    y: 120,
    size: 15,
    color: '#7c3aed',
  },
]

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
}
`

/** Scoreboard actor — host owns peerScores scriptVar; clients mirror via score relay. */
export const MP_SCOREBOARD_SCRIPT = `// mp_scoreboard — host score state + HUD refresh
// @export winScore = 3
// @export peerScores = {}
function onBeginPlay() {
  api.on('mp_game_won', (winnerId, score) => {
    api.log('MP winner: ' + winnerId + ' (' + score + ')')
  })
  if (!api.mpIsHost()) return
  const scores = { ...(vars.peerScores || {}) }
  scores[api.mpLocalId()] = scores[api.mpLocalId()] ?? 0
  actor.scriptVars = { ...(actor.scriptVars ?? {}), peerScores: scores }
}
function onTick(_dt) {
  let scores = {} as Record<string, number>
  if (api.mpIsHost()) {
    const raw = (actor.scriptVars?.peerScores ?? vars.peerScores ?? {}) as Record<string, number>
    scores = { ...raw }
    scores[api.mpLocalId()] = scores[api.mpLocalId()] ?? 0
    actor.scriptVars = { ...(actor.scriptVars ?? {}), peerScores: scores }
  } else if (api.mpConnected()) {
    scores = api.getMpPeerScores()
  } else {
    scores = (actor.scriptVars?.peerScores ?? vars.peerScores ?? {}) as Record<string, number>
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

const MP_LOBBY_UNDO_NAMES = ['MpLobbyFloor', 'MpLobbyHost', 'MpLobbyClient', MP_LOBBY_MANAGER_NAME, 'MpLobbySun']

/** Spectator manager — HUD + enable spectator mode before Play (Wave 68). */
export const MP_SPECTATOR_SCRIPT = `// mp_spectator — observe deathmatch without pawn spawn
function refreshHud() {
  const spec = api.mpIsSpectator()
  const peers = api.mpSpectatorPeers()
  const hostPose = api.mpHostPose()
  const follow = hostPose ? 'orbit host' : 'free fly'
  api.hud.text('mp_spec_mode', spec ? 'Spectator ON' : 'Spectator OFF', {
    anchor: 'tc',
    x: 0,
    y: 20,
    size: 18,
    color: spec ? '#81b29a' : '#9aa4b2',
  })
  api.hud.text('mp_spec_hint', 'F toggle follow · Q/E zoom · R rewind · WASD free fly', {
    anchor: 'tc',
    x: 0,
    y: 44,
    size: 13,
    color: '#7c8a9a',
  })
  api.hud.text('mp_spec_peers', peers.length ? 'Watching: ' + peers.join('  ') : 'No spectators yet', {
    anchor: 'tc',
    x: 0,
    y: 68,
    size: 14,
    color: '#9aa4b2',
  })
  const pos = hostPose ? hostPose.position : null
  const posLabel = pos ? pos.x.toFixed(1) + ',' + pos.y.toFixed(1) + ',' + pos.z.toFixed(1) : '—'
  api.hud.text('mp_spec_cam', hostPose ? follow + ' @ ' + posLabel : follow, {
    anchor: 'tc',
    x: 0,
    y: 92,
    size: 13,
    color: '#6b7c8f',
  })
}
function onBeginPlay() {
  api.mpSpectatorEnable(true)
  refreshHud()
  api.on('mp_lobby_refresh', refreshHud)
}
function onTick(_dt) {
  refreshHud()
}
`

const MP_SPECTATOR_HUD_WIDGETS: HudWidget[] = [
  {
    id: 'mp_spec_mode',
    type: 'text',
    text: 'Spectator —',
    anchor: 'tc',
    x: 0,
    y: 20,
    size: 18,
    color: '#e8ecf0',
  },
  {
    id: 'mp_spec_hint',
    type: 'text',
    text: 'F follow · Q/E zoom · R rewind',
    anchor: 'tc',
    x: 0,
    y: 44,
    size: 13,
    color: '#7c8a9a',
  },
  {
    id: 'mp_spec_peers',
    type: 'text',
    text: 'Spectators…',
    anchor: 'tc',
    x: 0,
    y: 68,
    size: 14,
    color: '#9aa4b2',
  },
  {
    id: 'mp_spec_cam',
    type: 'text',
    text: 'Camera —',
    anchor: 'tc',
    x: 0,
    y: 92,
    size: 13,
    color: '#6b7c8f',
  },
]

const MP_SPECTATOR_UNDO_NAMES = [
  'MpSpecFloor',
  'HostSpawn',
  'ClientSpawn',
  'SpectatorSpawn',
  MP_SPECTATOR_MANAGER_NAME,
  'MpTargetA',
  'MpTargetB',
  'MpTargetC',
  MP_SCOREBOARD_NAME,
  'MpSpecSun',
]

function buildLobbyManagerActor() {
  const manager = buildSerializedActor({ kind: 'empty' }, [0, 2, 0])
  manager.name = MP_LOBBY_MANAGER_NAME
  manager.tags = [MP_TAG_LOBBY]
  manager.script = MP_LOBBY_SCRIPT
  return manager
}

/**
 * Indie MP lobby greybox — room browser + ready-up HUD.
 * Deathmatch does not spawn until host relays lobby_start.
 */
export function spawnIndieMpLobby() {
  const floor = starterBox('MpLobbyFloor', [0, -0.1, 0], [14, 0.2, 14], '#3d4a5c')
  floor.material!.roughness = 0.9

  const host = buildSerializedActor({ kind: 'playerstart' }, [-4, 0.2, 0])
  host.name = 'MpLobbyHost'
  host.pawnMode = 'thirdperson' as PawnMode
  host.tags = [MP_TAG_HOST]

  const client = buildSerializedActor({ kind: 'playerstart' }, [4, 0.2, 0])
  client.name = 'MpLobbyClient'
  client.pawnMode = 'thirdperson' as PawnMode

  const manager = buildLobbyManagerActor()
  const sun = buildSerializedActor({ kind: 'light', type: 'DirectionalLight' }, [5, 10, 3])
  sun.name = 'MpLobbySun'

  runCommand({
    label: 'Indie MP lobby',
    execute() {
      for (const sa of [floor, host, client, manager, sun]) {
        new AddActorCommand(sa).execute()
      }
      world.environment.useRapierCharacter = true
      world.applyEnvironment()
      const existing = new Set(world.hudWidgets.map((w) => w.id))
      for (const w of MP_LOBBY_HUD_WIDGETS) {
        if (!existing.has(w.id)) world.hudWidgets.push({ ...w })
      }
      useEditor.getState().setStatus(`Indie MP lobby — room ${mpLobbyRoom()} · ready up then host starts`)
      useEditor.getState().touch()
    },
    undo() {
      removeActorsByName(MP_LOBBY_UNDO_NAMES)
      world.hudWidgets = world.hudWidgets.filter((w) => !MP_LOBBY_HUD_WIDGETS.some((h) => h.id === w.id))
      useEditor.getState().touch()
    },
  })
}

function transitionLobbyToDeathmatch() {
  removeActorsByName(MP_LOBBY_UNDO_NAMES)
  world.hudWidgets = world.hudWidgets.filter((w) => !MP_LOBBY_HUD_WIDGETS.some((h) => h.id === w.id))
  spawnIndieMpDeathmatch()
  world.playApi?.emit('mp_lobby_start')
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

/** Clients mirror host peerScores snapshots from the score relay. */
mpSetPeerScoresMirrorHandler((scores) => {
  mirrorMpPeerScores(world.actors, scores)
})

/** Clients receive mp_game_won when host broadcasts a win on the score relay. */
mpSetGameWonRelayHandler((peerId, score) => {
  world.playApi?.emit('mp_game_won', peerId, score)
})

/** Lobby HUD refresh when peers join or toggle ready. */
mpSetLobbyRefreshHandler(() => {
  world.playApi?.emit('mp_lobby_refresh')
})

/** All tabs transition lobby → deathmatch when host relays lobby_start. */
mpSetLobbyStartHandler(() => {
  const inLobby = [...world.actors.values()].some((a) => a.name === MP_LOBBY_MANAGER_NAME)
  if (inLobby) transitionLobbyToDeathmatch()
})

function buildSpectatorManagerActor() {
  const manager = buildSerializedActor({ kind: 'empty' }, [0, 2, 0])
  manager.name = MP_SPECTATOR_MANAGER_NAME
  manager.tags = [MP_TAG_SPECTATOR]
  manager.script = MP_SPECTATOR_SCRIPT
  return manager
}

/**
 * Indie MP spectator greybox — deathmatch arena + elevated fly spawn.
 * Enable Multiplayer + Spectator mode, then Play to observe without pawn.
 */
export function spawnIndieMpSpectator() {
  const floor = starterBox('MpSpecFloor', [0, -0.1, 0], [18, 0.2, 18], '#3d4a5c')
  floor.material!.roughness = 0.9

  const host = buildSerializedActor({ kind: 'playerstart' }, [-5, 0.2, 0])
  host.name = 'HostSpawn'
  host.pawnMode = 'thirdperson' as PawnMode
  host.tags = [MP_TAG_HOST]
  host.script = MP_SCORE_SCRIPT

  const client = buildSerializedActor({ kind: 'playerstart' }, [5, 0.2, 0])
  client.name = 'ClientSpawn'
  client.pawnMode = 'thirdperson' as PawnMode
  client.script = MP_SCORE_SCRIPT

  const spectator = buildSerializedActor({ kind: 'playerstart' }, [0, 8, 12])
  spectator.name = 'SpectatorSpawn'
  spectator.pawnMode = 'fly' as PawnMode
  spectator.tags = [MP_TAG_SPECTATOR]

  const targetA = buildTarget('MpTargetA', [0, 0.7, -4], '#e07a5f')
  const targetB = buildTarget('MpTargetB', [-3, 0.7, 2], '#81b29a')
  const targetC = buildTarget('MpTargetC', [3, 0.7, 2], '#f2cc8f')

  const scoreboard = buildScoreboardActor()
  const manager = buildSpectatorManagerActor()
  const sun = buildSerializedActor({ kind: 'light', type: 'DirectionalLight' }, [6, 12, 4])
  sun.name = 'MpSpecSun'

  runCommand({
    label: 'Indie MP spectator',
    execute() {
      for (const sa of [floor, host, client, spectator, targetA, targetB, targetC, scoreboard, manager, sun]) {
        new AddActorCommand(sa).execute()
      }
      world.environment.useRapierCharacter = true
      world.applyEnvironment()
      const existing = new Set(world.hudWidgets.map((w) => w.id))
      for (const w of MP_SPECTATOR_HUD_WIDGETS) {
        if (!existing.has(w.id)) world.hudWidgets.push({ ...w })
      }
      useEditor.getState().setStatus(
        `Indie MP spectator — enable Spectator in World Settings, Play to orbit host (F toggle follow)`,
      )
      useEditor.getState().touch()
    },
    undo() {
      removeActorsByName(MP_SPECTATOR_UNDO_NAMES)
      world.hudWidgets = world.hudWidgets.filter((w) => !MP_SPECTATOR_HUD_WIDGETS.some((h) => h.id === w.id))
      useEditor.getState().touch()
    },
  })
}