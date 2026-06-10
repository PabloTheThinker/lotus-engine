import { nextActorId } from '../engine/Actor'
import { world } from '../engine/World'
import type { ActorType, GeometryKind, SerializedActor } from '../engine/types'
import { DEFAULT_MATERIAL } from '../engine/types'
import { AddActorCommand, runCommand } from './commands'

export type AssetPayload =
  | { kind: 'mesh'; geometry: GeometryKind }
  | { kind: 'light'; type: Extract<ActorType, 'PointLight' | 'SpotLight' | 'DirectionalLight' | 'AmbientLight'> }
  | { kind: 'camera' }
  | { kind: 'empty' }
  | { kind: 'playerstart' }
  | { kind: 'imported'; assetId: string; name: string }

const LIGHT_DEFAULTS = {
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
    case 'playerstart':
      return {
        ...base,
        name: uniqueName('PlayerStart'),
        type: 'PlayerStart',
        transform: { ...base.transform, position: [position[0], 0, position[2]] },
      }
    case 'imported':
      return { ...base, name: uniqueName(payload.name), type: 'ImportedMesh', assetId: payload.assetId }
  }
}

export function spawnAsset(payload: AssetPayload, position: [number, number, number] = [0, 0.5, 0]) {
  runCommand(new AddActorCommand(buildSerializedActor(payload, position)))
}
