// Core type definitions for the Vektra Engine — mirrors Unreal's gameplay framework vocabulary.

export type ActorType =
  | 'StaticMesh'
  | 'ImportedMesh'
  | 'PointLight'
  | 'SpotLight'
  | 'DirectionalLight'
  | 'AmbientLight'
  | 'Camera'
  | 'PlayerStart'
  | 'Empty'
  | 'Folder'
  | 'PostProcessVolume'

/** UE EComponentMobility — how an actor may change at runtime. */
export type Mobility = 'static' | 'stationary' | 'movable'

export const DEFAULT_MOBILITY: Record<ActorType, Mobility> = {
  StaticMesh: 'static',
  ImportedMesh: 'static',
  PointLight: 'stationary',
  SpotLight: 'stationary',
  DirectionalLight: 'stationary',
  AmbientLight: 'stationary',
  Camera: 'movable',
  PlayerStart: 'movable',
  Empty: 'movable',
  Folder: 'static',
  PostProcessVolume: 'movable',
}

/** UE PostProcessVolume overrides — blended when the camera is inside the volume. */
export interface PostProcessProps {
  enabled: boolean
  /** UE "Infinite Extent (Unbound)" — affects the whole level regardless of position. */
  infiniteExtent: boolean
  blendRadius: number
  priority: number
  bloomEnabled?: boolean
  bloomStrength?: number
  bloomThreshold?: number
  bloomRadius?: number
  exposure?: number
}

export const DEFAULT_POST_PROCESS: PostProcessProps = {
  enabled: true,
  infiniteExtent: false,
  blendRadius: 100,
  priority: 0,
  bloomStrength: 0.35,
  bloomThreshold: 1.5,
  bloomRadius: 0.5,
  exposure: 0.85,
}

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

// Physics — the Chaos analog, backed by Rapier. Runs only during Play.
export type PhysicsMode = 'none' | 'static' | 'dynamic'
export interface PhysicsProps {
  mode: PhysicsMode
  mass: number
  friction: number
  restitution: number
}

export const DEFAULT_PHYSICS: PhysicsProps = {
  mode: 'none',
  mass: 1,
  friction: 0.5,
  restitution: 0.2,
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
  physics?: PhysicsProps
  assetId?: string
  behaviors: Behavior[]
  castShadow?: boolean
  receiveShadow?: boolean
  /** per-actor JavaScript (onBeginPlay / onTick hooks) */
  script?: string
  /** visual scripting graph — compiles into the script slot */
  blueprint?: import('./blueprint').BlueprintGraph
  /** PlayerStart only: which pawn the player possesses */
  pawnMode?: PawnMode
  /** UE mobility — static/stationary/movable */
  mobility?: Mobility
  /** UE-style actor tags for filtering and gameplay queries */
  tags?: string[]
  /** PostProcessVolume only */
  postProcess?: PostProcessProps
}

export type PawnMode = 'fly' | 'firstperson' | 'thirdperson'

export interface EnvironmentSettings {
  background: string
  fogEnabled: boolean
  fogColor: string
  fogDensity: number
  // sky atmosphere (UE SkyAtmosphere analog)
  skyEnabled: boolean
  sunElevation: number // degrees above horizon
  sunAzimuth: number // degrees
  // post-processing
  bloomEnabled: boolean
  bloomStrength: number
  bloomThreshold: number
  bloomRadius: number
  exposure: number
}

export const DEFAULT_ENVIRONMENT: EnvironmentSettings = {
  background: '#15181d',
  fogEnabled: false,
  fogColor: '#15181d',
  fogDensity: 0.02,
  skyEnabled: true,
  sunElevation: 35,
  sunAzimuth: 45,
  bloomEnabled: true,
  bloomStrength: 0.2,
  bloomThreshold: 2.0,
  bloomRadius: 0.4,
  exposure: 0.75,
}

export interface SerializedLevel {
  engine: 'vektra'
  version: 1 | 2 | 3
  name: string
  environment: EnvironmentSettings
  // imported glTF binaries, base64-encoded, keyed by assetId
  assets?: Record<string, { name: string; data: string }>
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
