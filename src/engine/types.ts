// Core type definitions for the Vektra Engine — mirrors Unreal's gameplay framework vocabulary.

export type ActorType =
  | 'StaticMesh'
  | 'PointLight'
  | 'SpotLight'
  | 'DirectionalLight'
  | 'AmbientLight'
  | 'Camera'
  | 'Empty'

export type GeometryKind =
  | 'box'
  | 'sphere'
  | 'cylinder'
  | 'cone'
  | 'plane'
  | 'torus'
  | 'capsule'
  | 'icosahedron'

export interface MaterialProps {
  color: string
  roughness: number
  metalness: number
  emissive: string
  emissiveIntensity: number
  wireframe: boolean
  opacity: number
  transparent: boolean
}

export interface LightProps {
  color: string
  intensity: number
  // point / spot
  distance?: number
  decay?: number
  // spot
  angle?: number
  penumbra?: number
  castShadow?: boolean
}

export interface CameraProps {
  fov: number
  near: number
  far: number
}

// Tick behaviors — the scripting layer that runs during Play-In-Editor.
export type Behavior =
  | { type: 'rotator'; speedX: number; speedY: number; speedZ: number }
  | { type: 'bobber'; amplitude: number; frequency: number }
  | { type: 'orbiter'; radius: number; speed: number }

export interface TransformSnapshot {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
}

export interface SerializedActor {
  id: string
  name: string
  type: ActorType
  parentId: string | null
  visible: boolean
  transform: TransformSnapshot
  geometry?: GeometryKind
  material?: MaterialProps
  light?: LightProps
  camera?: CameraProps
  behaviors: Behavior[]
  castShadow?: boolean
  receiveShadow?: boolean
}

export interface SerializedLevel {
  engine: 'vektra'
  version: 1
  name: string
  environment: {
    background: string
    fogEnabled: boolean
    fogColor: string
    fogDensity: number
  }
  actors: SerializedActor[]
}

export const DEFAULT_MATERIAL: MaterialProps = {
  color: '#9da4ae',
  roughness: 0.6,
  metalness: 0.1,
  emissive: '#000000',
  emissiveIntensity: 1,
  wireframe: false,
  opacity: 1,
  transparent: false,
}
