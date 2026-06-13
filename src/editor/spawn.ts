import { nextActorId } from '../engine/Actor'
import { world } from '../engine/World'
import type { ActorType, GeometryKind, SerializedActor } from '../engine/types'
import { DEFAULT_MATERIAL } from '../engine/types'
import { DEFAULT_PARTICLES } from '../engine/particles'
import { DEFAULT_FOLIAGE, DEFAULT_LABEL3D } from '../engine/types'
import { DEFAULT_LANDSCAPE } from '../engine/landscape'
import { DEFAULT_WATER } from '../engine/water'
import { DEFAULT_PCG } from '../engine/pcg'
import { emptyPCGGraph } from '../engine/pcgGraph'
import { AddActorCommand, runCommand } from './commands'
import { getPluginNodeType } from './plugins'

export type AssetPayload =
  | { kind: 'mesh'; geometry: GeometryKind }
  | { kind: 'light'; type: Extract<ActorType, 'PointLight' | 'SpotLight' | 'DirectionalLight' | 'AmbientLight' | 'RectLight'> }
  | { kind: 'camera' }
  | { kind: 'empty' }
  | { kind: 'folder' }
  | { kind: 'postprocess' }
  | { kind: 'particles' }
  | { kind: 'foliage' }
  | { kind: 'landscape' }
  | { kind: 'trigger' }
  | { kind: 'soundemitter' }
  | { kind: 'gridmap' }
  | { kind: 'probe' }
  | { kind: 'water' }
  | { kind: 'pcg' }
  | { kind: 'playerstart' }
  | { kind: 'label3d' }
  | { kind: 'imported'; assetId: string; name: string }
  | { kind: 'plugin-node'; nodeType: string }

const LIGHT_DEFAULTS = {
  RectLight: { color: '#ffffff', intensity: 8, width: 3, height: 2 },
  PointLight: { color: '#ffffff', intensity: 10, distance: 0, decay: 2, castShadow: true },
  SpotLight: { color: '#ffffff', intensity: 20, distance: 0, decay: 2, angle: 0.5, penumbra: 0.3, castShadow: true },
  DirectionalLight: { color: '#ffffff', intensity: 2, castShadow: true },
  AmbientLight: { color: '#404a5a', intensity: 1 },
} as const

function uniqueName(base: string): string {
  const names = new Set([...world.actors.values()].map((a) => a.name))
  if (!names.has(base)) return base
  let i = 2
  while (names.has(`${base}${i}`)) i += 1
  return `${base}${i}`
}

export function buildSerializedActor(payload: AssetPayload, position: [number, number, number]): SerializedActor {
  const id = nextActorId()
  const base: Omit<SerializedActor, 'name' | 'type'> = {
    id,
    parentId: null,
    visible: true,
    transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
    behaviors: [],
  }
  switch (payload.kind) {
    case 'mesh': {
      const label = payload.geometry.charAt(0).toUpperCase() + payload.geometry.slice(1)
      return {
        ...base,
        name: uniqueName(label),
        type: 'StaticMesh',
        geometry: payload.geometry,
        material: { ...DEFAULT_MATERIAL },
        castShadow: true,
        receiveShadow: true,
      }
    }
    case 'light':
      return {
        ...base,
        name: uniqueName(payload.type),
        type: payload.type,
        light: { ...LIGHT_DEFAULTS[payload.type] },
        // lights spawn raised so they actually illuminate something
        transform: { ...base.transform, position: [position[0], Math.max(position[1], 3), position[2]] },
      }
    case 'camera':
      return {
        ...base,
        name: uniqueName('Camera'),
        type: 'Camera',
        camera: { fov: 60, near: 0.1, far: 2000 },
        transform: { ...base.transform, position: [position[0], Math.max(position[1], 2), position[2] + 6] },
      }
    case 'empty':
      return { ...base, name: uniqueName('Empty'), type: 'Empty' }
    case 'folder':
      return { ...base, name: uniqueName('Folder'), type: 'Folder' }
    case 'postprocess': {
      const sa: SerializedActor = {
        ...base,
        name: uniqueName('PostProcessVolume'),
        type: 'PostProcessVolume',
        transform: { ...base.transform, position: [position[0], Math.max(position[1], 2), position[2]], scale: [8, 4, 8] },
        postProcess: { enabled: true, infiniteExtent: false, blendRadius: 100, priority: 0, bloomStrength: 0.35, exposure: 0.85 },
      }
      return sa
    }
    case 'particles':
      return {
        ...base,
        name: uniqueName('Emitter'),
        type: 'ParticleEmitter',
        particles: { ...DEFAULT_PARTICLES },
        transform: { ...base.transform, position: [position[0], Math.max(position[1], 1), position[2]] },
      }
    case 'foliage':
      return {
        ...base,
        name: uniqueName('Foliage'),
        type: 'FoliageLayer',
        foliage: { ...DEFAULT_FOLIAGE, instances: [] },
        transform: { ...base.transform, position: [0, 0, 0] },
      }
    case 'landscape': {
      const res = DEFAULT_LANDSCAPE.resolution
      return {
        ...base,
        name: uniqueName('Landscape'),
        type: 'Landscape',
        landscape: { ...DEFAULT_LANDSCAPE, heights: new Array((res + 1) * (res + 1)).fill(0) },
        transform: { ...base.transform, position: [0, 0, 0] },
      }
    }
    case 'gridmap':
      return {
        ...base,
        name: uniqueName('GridMap'),
        type: 'FoliageLayer',
        foliage: { ...DEFAULT_FOLIAGE, geometry: 'box', color: '#7a8699', density: 1, brushRadius: 0.4, scaleMin: 1, scaleMax: 1, instances: [], snap: true },
        transform: { ...base.transform, position: [0, 0, 0] },
      }
    case 'probe':
      return {
        ...base,
        name: uniqueName('ReflectionProbe'),
        type: 'ReflectionProbe',
        probe: { radius: 8 },
        transform: { ...base.transform, position: [position[0], Math.max(position[1], 2), position[2]] },
      }
    case 'water':
      return {
        ...base,
        name: uniqueName('Water'),
        type: 'Water',
        water: { ...DEFAULT_WATER },
        transform: { ...base.transform, position: [position[0], 0.3, position[2]] },
      }
    case 'pcg':
      return {
        ...base,
        name: uniqueName('PCGVolume'),
        type: 'PCGVolume',
        pcg: { ...DEFAULT_PCG },
        pcgGraph: emptyPCGGraph(),
        transform: { ...base.transform, position: [position[0], Math.max(position[1], 2), position[2]], scale: [20, 6, 20] },
      }
    case 'trigger':
      return {
        ...base,
        name: uniqueName('Trigger'),
        type: 'TriggerVolume',
        trigger: { reverbPreset: '' },
        transform: { ...base.transform, position: [position[0], Math.max(position[1], 1), position[2]], scale: [3, 2, 3] },
      }
    case 'soundemitter':
      return {
        ...base,
        name: uniqueName('SoundEmitter'),
        type: 'SoundEmitter',
        soundEmitter: { metaSoundName: '', volume: 1, loop: false, autoPlay: true, spatial: true },
        transform: { ...base.transform, position: [position[0], Math.max(position[1], 1), position[2]] },
      }
    case 'playerstart':
      return {
        ...base,
        name: uniqueName('PlayerStart'),
        type: 'PlayerStart',
        transform: { ...base.transform, position: [position[0], 0, position[2]] },
      }
    case 'label3d':
      return {
        ...base,
        name: uniqueName('Label3D'),
        type: 'Label3D',
        label3D: { ...DEFAULT_LABEL3D },
        transform: { ...base.transform, position: [position[0], Math.max(position[1], 1.5), position[2]] },
      }
    case 'imported':
      return { ...base, name: uniqueName(payload.name), type: 'ImportedMesh', assetId: payload.assetId }
    case 'plugin-node': {
      const def = getPluginNodeType(payload.nodeType)
      if (!def) throw new Error(`Unknown plugin node type: ${payload.nodeType}`)
      return def.factory(position)
    }
  }
}

/** live drag payload — dataTransfer can't be read during dragover */
export const dragGhost: { payload: AssetPayload | null } = { payload: null }

export function spawnAsset(payload: AssetPayload, position: [number, number, number] = [0, 0.5, 0]) {
  runCommand(new AddActorCommand(buildSerializedActor(payload, position)))
}
