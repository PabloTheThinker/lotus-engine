// Core type definitions for the Vektra Engine — mirrors Unreal's gameplay framework vocabulary.

export type ActorType =
  | 'StaticMesh'
  | 'ImportedMesh'
  | 'PointLight'
  | 'SpotLight'
  | 'DirectionalLight'
  | 'AmbientLight'
  | 'RectLight'
  | 'Camera'
  | 'PlayerStart'
  | 'Empty'
  | 'Folder'
  | 'PostProcessVolume'
  | 'ParticleEmitter'
  | 'FoliageLayer'
  | 'Landscape'
  | 'TriggerVolume'
  | 'ReflectionProbe'
  | 'CustomMesh'

/** UE EComponentMobility — how an actor may change at runtime. */
export type Mobility = 'static' | 'stationary' | 'movable'

export const DEFAULT_MOBILITY: Record<ActorType, Mobility> = {
  StaticMesh: 'static',
  ImportedMesh: 'static',
  PointLight: 'stationary',
  SpotLight: 'stationary',
  DirectionalLight: 'stationary',
  AmbientLight: 'stationary',
  RectLight: 'stationary',
  Camera: 'movable',
  PlayerStart: 'movable',
  Empty: 'movable',
  Folder: 'static',
  PostProcessVolume: 'movable',
  ParticleEmitter: 'movable',
  FoliageLayer: 'static',
  Landscape: 'static',
  TriggerVolume: 'movable',
  ReflectionProbe: 'stationary',
  CustomMesh: 'static',
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
  // rect light
  width?: number
  height?: number
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
  /** Chaos-lite destruction: shatter into fragments on hard impact */
  breakable?: boolean
  breakThreshold?: number
  /** collision layer (0-7) and bitmask of layers this collides with */
  layer?: number
  collidesWith?: number
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
  /** saved @export variable overrides */
  scriptVars?: Record<string, unknown>
  /** visual scripting graph — compiles into the script slot */
  blueprint?: import('./blueprint').BlueprintGraph
  /** PlayerStart only: which pawn the player possesses */
  pawnMode?: PawnMode
  /** UE mobility — static/stationary/movable */
  mobility?: Mobility
  /** UE-style actor tags for filtering and gameplay queries */
  tags?: string[]
  /** distance streaming: hide beyond this range from the camera (0 = never) */
  cullDistance?: number
  /** PostProcessVolume only */
  postProcess?: PostProcessProps
  /** ParticleEmitter only */
  particles?: import('./particles').ParticleProps
  /** FoliageLayer only */
  foliage?: FoliageProps
  /** Landscape only */
  landscape?: LandscapeProps
  /** ReflectionProbe only */
  probe?: { radius: number }
  /** CustomMesh (CSG results) — packed geometry */
  customGeometry?: { positions: number[]; normals: number[]; index?: number[] }
  /** animation clip to play at BeginPlay */
  autoPlayClip?: string
  /** material node graph */
  materialGraph?: import('./materialGraph').MaterialGraph
}

/** Landscape — UE heightmap terrain. heights is (resolution+1)^2 floats. */
export interface LandscapeProps {
  size: number
  resolution: number
  color: string
  heights: number[]
  /** 4 paint layers (UE weight-blended layers, color-based) */
  layerColors?: [string, string, string, string]
  /** per-vertex layer weights, 4 per vertex */
  weights?: number[]
}

export type SculptTool = 'raise' | 'lower' | 'smooth' | 'flatten' | 'paint'

/** Foliage — UE Foliage mode analog: painted InstancedMesh scatter. */
export interface FoliageProps {
  geometry: GeometryKind
  color: string
  density: number
  brushRadius: number
  scaleMin: number
  scaleMax: number
  /** packed instances: [x, y, z, scale, rotY] */
  instances: number[][]
  /** GridMap mode: snap painting to integer cells, one instance per cell */
  snap?: boolean
}

export const DEFAULT_FOLIAGE: FoliageProps = {
  geometry: 'cone',
  color: '#3f7d44',
  density: 6,
  brushRadius: 2.5,
  scaleMin: 0.6,
  scaleMax: 1.6,
  instances: [],
}

export type PawnMode = 'fly' | 'firstperson' | 'thirdperson' | 'vehicle'

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
  /** master Sequencer timeline */
  sequence?: import('./sequencer').Sequence
  /** data assets (UE DataTables) — name → arbitrary JSON */
  data?: Record<string, unknown>
  /** imported audio clips, base64 */
  sounds?: Record<string, string>
  /** authored HUD widgets (UMG designer) */
  hud?: HudWidget[]
}

/** UMG-lite authored widget */
export interface HudWidget {
  id: string
  type: 'text' | 'bar' | 'button'
  text: string
  anchor: 'tl' | 'tr' | 'bl' | 'br' | 'center'
  x: number
  y: number
  size: number
  color: string
  /** buttons: signal emitted on click */
  signal?: string
  /** bars: initial fraction */
  value?: number
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
