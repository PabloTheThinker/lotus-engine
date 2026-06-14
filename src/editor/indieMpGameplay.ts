import type { PawnMode } from '../engine/types'
import { world } from '../engine/World'
import {
  MP_SCORE_VAR,
  MP_SCORE_WIN,
  MP_SCOREBOARD_NAME,
  MP_TAG_TARGET,
  applyMpScoreDelta,
  mirrorMpPeerScores,
  mirrorMpTeamScores,
} from '../engine/mpGameplay'
import {
  MP_TAG_BLUE,
  MP_TAG_RED,
  MP_TEAM_SCORES_VAR,
  applyMpTeamScoreDelta,
  mpTeamsSet,
  type MpTeam,
} from '../engine/mpTeams'
import { mpKillcamOnGameWon, mpKillcamOnPlayerKilled } from '../engine/mpKillcam'
import {
  mpBroadcastTeamScores,
  mpLobbyRoom,
  mpSetGameWonRelayHandler,
  mpSetLobbyRefreshHandler,
  mpSetLobbyStartHandler,
  mpSetPeerScoresMirrorHandler,
  mpSetPlayerKilledRelayHandler,
  mpSetScoreDeltaHandler,
  mpSetTeamAssignMirrorHandler,
  mpSetTeamGameWonRelayHandler,
  mpSetTeamScoreDeltaHandler,
  mpSetTeamScoresMirrorHandler,
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
  getMpTeamScores,
  mirrorMpPeerScores,
  mirrorMpTeamScores,
  addMpScore,
  addMpTeamScore,
  applyMpScoreDelta,
  applyMpTeamScoreDelta,
} from '../engine/mpGameplay'
export { MP_TAG_RED, MP_TAG_BLUE, MP_TEAM_SCORES_VAR, mpTeamsAssign, mpTeamsGet, mpTeamsGetAll, mpTeamsAreFriendly } from '../engine/mpTeams'

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

/** Team deathmatch score script — friendly fire off, awards team score. */
export const MP_TEAMS_SCORE_SCRIPT = `// mp_teams_score — red/blue teams (host authoritative, friendly fire off)
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
  const killerId = api.mpLocalId()
  const victimId = api.mpLobbyPeers().find((id) => id !== killerId)
  if (victimId && api.mpTeamsAreFriendly(killerId, victimId)) return
  if (victimId) api.mpReportPlayerKill(victimId)
  api.addMpTeamScore(1)
}
`

/** Team scoreboard — host owns teamScores scriptVar; clients mirror via score relay. */
export const MP_TEAMS_SCOREBOARD_SCRIPT = `// mp_teams_scoreboard — team score HUD (Wave 83)
// @export winScore = 3
// @export teamScores = { red: 0, blue: 0 }
function onBeginPlay() {
  api.on('mp_game_won', (winner, score) => {
    api.log('MP team winner: ' + winner + ' (' + score + ')')
  })
  if (!api.mpIsHost()) return
  const scores = { red: 0, blue: 0, ...(vars.teamScores || {}) }
  actor.scriptVars = { ...(actor.scriptVars ?? {}), teamScores: scores }
}
function onTick(_dt) {
  let scores = { red: 0, blue: 0 } as { red: number; blue: number }
  if (api.mpIsHost()) {
    const raw = (actor.scriptVars?.teamScores ?? vars.teamScores ?? { red: 0, blue: 0 }) as {
      red: number
      blue: number
    }
    scores = { red: raw.red ?? 0, blue: raw.blue ?? 0 }
    actor.scriptVars = { ...(actor.scriptVars ?? {}), teamScores: scores }
  } else if (api.mpConnected()) {
    scores = api.getMpTeamScores()
  } else {
    const raw = (actor.scriptVars?.teamScores ?? vars.teamScores ?? { red: 0, blue: 0 }) as {
      red: number
      blue: number
    }
    scores = { red: raw.red ?? 0, blue: raw.blue ?? 0 }
  }
  const cap = vars.winScore as number
  const team = api.mpGetTeam()
  const teamLabel = team ? team.toUpperCase() + ' ' : ''
  api.hud.text(
    'mp_teams_hud',
    teamLabel + 'R:' + scores.red + ' B:' + scores.blue + ' /' + cap,
    { anchor: 'tr', x: 16, y: 16, size: 17, color: '#e8ecf0' },
  )
}
`

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
  const killerId = api.mpLocalId()
  const victimId = api.mpLobbyPeers().find((id) => id !== killerId)
  if (victimId) api.mpReportPlayerKill(victimId)
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

function buildTeamsScoreboardActor() {
  const board = buildSerializedActor({ kind: 'empty' }, [0, 2, 0])
  board.name = MP_SCOREBOARD_NAME
  board.script = MP_TEAMS_SCOREBOARD_SCRIPT
  board.scriptVars = { [MP_TEAM_SCORES_VAR]: { red: 0, blue: 0 }, winScore: MP_SCORE_WIN }
  board.syncProperties = [MP_TEAM_SCORES_VAR]
  return board
}

function buildTeamSpawn(
  name: string,
  position: [number, number, number],
  team: MpTeam,
  color: string,
) {
  const spawn = buildSerializedActor({ kind: 'playerstart' }, position)
  spawn.name = name
  spawn.pawnMode = 'thirdperson' as PawnMode
  spawn.tags = team === 'red' ? [MP_TAG_RED] : [MP_TAG_BLUE]
  spawn.script = MP_TEAMS_SCORE_SCRIPT
  spawn.material = {
    color,
    roughness: 0.75,
    metalness: 0.05,
    emissive: color,
    emissiveIntensity: 0.4,
    wireframe: false,
    opacity: 1,
    transparent: false,
  }
  if (name === 'RedHostSpawn') spawn.tags.push(MP_TAG_HOST)
  return spawn
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

const MP_TEAMS_HUD_WIDGET: HudWidget = {
  id: 'mp_teams_hud',
  type: 'text',
  text: 'R:0 B:0',
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
/**
 * Indie MP teams deathmatch — red/blue spawns, team scoreboard, friendly fire off.
 */
export function spawnIndieMpTeamsDeathmatch() {
  const floor = starterBox('MpTeamsFloor', [0, -0.1, 0], [20, 0.2, 20], '#4a5568')
  floor.material!.roughness = 0.85

  const redPad = starterBox('MpRedPad', [-6, 0.05, 0], [5, 0.1, 5], '#e5484d')
  redPad.material!.emissive = '#e5484d'
  redPad.material!.emissiveIntensity = 0.25

  const bluePad = starterBox('MpBluePad', [6, 0.05, 0], [5, 0.1, 5], '#2f80ed')
  bluePad.material!.emissive = '#2f80ed'
  bluePad.material!.emissiveIntensity = 0.25

  const redHost = buildTeamSpawn('RedHostSpawn', [-6, 0.2, 0], 'red', '#e5484d')
  const redClient = buildTeamSpawn('RedClientSpawn', [-4, 0.2, -2], 'red', '#e5484d')
  const blueHost = buildTeamSpawn('BlueHostSpawn', [6, 0.2, 0], 'blue', '#2f80ed')
  const blueClient = buildTeamSpawn('BlueClientSpawn', [4, 0.2, 2], 'blue', '#2f80ed')

  const targetA = buildTarget('MpTargetA', [0, 0.7, -5], '#e07a5f')
  const targetB = buildTarget('MpTargetB', [-2, 0.7, 3], '#81b29a')
  const targetC = buildTarget('MpTargetC', [2, 0.7, 3], '#f2cc8f')

  const scoreboard = buildTeamsScoreboardActor()
  const sun = buildSerializedActor({ kind: 'light', type: 'DirectionalLight' }, [6, 12, 4])
  sun.name = 'MpTeamsSun'

  const undoNames = [
    'MpTeamsFloor',
    'MpRedPad',
    'MpBluePad',
    'RedHostSpawn',
    'RedClientSpawn',
    'BlueHostSpawn',
    'BlueClientSpawn',
    'MpTargetA',
    'MpTargetB',
    'MpTargetC',
    MP_SCOREBOARD_NAME,
    'MpTeamsSun',
  ]

  runCommand({
    label: 'Indie MP teams deathmatch',
    execute() {
      for (const sa of [
        floor,
        redPad,
        bluePad,
        redHost,
        redClient,
        blueHost,
        blueClient,
        targetA,
        targetB,
        targetC,
        scoreboard,
        sun,
      ]) {
        new AddActorCommand(sa).execute()
      }
      world.environment.useRapierCharacter = true
      world.applyEnvironment()
      const hasHud = world.hudWidgets.some((w) => w.id === MP_TEAMS_HUD_WIDGET.id)
      if (!hasHud) world.hudWidgets.push({ ...MP_TEAMS_HUD_WIDGET })
      useEditor.getState().setStatus('Indie MP teams — red vs blue, first team to 3 wins (friendly fire off)')
      useEditor.getState().touch()
    },
    undo() {
      removeActorsByName(undoNames)
      world.hudWidgets = world.hudWidgets.filter((w) => w.id !== MP_TEAMS_HUD_WIDGET.id)
      useEditor.getState().touch()
    },
  })
}

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

function relayPlaySignal(signal: string, ...args: unknown[]) {
  world.playApi?.emit(signal, ...args)
  if (signal === 'mp_game_won') mpKillcamOnGameWon(String(args[0]))
}

/** Host applies score deltas requested by clients over the relay. */
mpSetScoreDeltaHandler((peerId, delta) => {
  applyMpScoreDelta(world.actors, peerId, delta, relayPlaySignal)
})

/** Host applies team score deltas requested by clients over the relay (Wave 83). */
mpSetTeamScoreDeltaHandler((_peerId, team, delta) => {
  applyMpTeamScoreDelta(world.actors, team, delta, relayPlaySignal, (scores, gameWon) =>
    mpBroadcastTeamScores(scores, gameWon),
  )
})

/** Clients mirror host peerScores snapshots from the score relay. */
mpSetPeerScoresMirrorHandler((scores) => {
  mirrorMpPeerScores(world.actors, scores)
})

/** Clients mirror host teamScores snapshots from the score relay (Wave 83). */
mpSetTeamScoresMirrorHandler((scores) => {
  mirrorMpTeamScores(world.actors, scores)
})

/** Clients apply host team_assign relay (Wave 83). */
mpSetTeamAssignMirrorHandler((peerId, team) => {
  mpTeamsSet(peerId, team)
})

/** Clients receive mp_game_won when host broadcasts a win on the score relay. */
mpSetGameWonRelayHandler((peerId, score) => {
  relayPlaySignal('mp_game_won', peerId, score)
})

/** Clients receive team mp_game_won when host broadcasts a team win (Wave 83). */
mpSetTeamGameWonRelayHandler((team, score) => {
  relayPlaySignal('mp_game_won', team, score)
})

/** Relay player_killed — victim client gets killcam overlay. */
mpSetPlayerKilledRelayHandler((killerId, victimId) => {
  relayPlaySignal('player_killed', killerId, victimId)
  mpKillcamOnPlayerKilled(killerId, victimId)
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