// Core type definitions for Lotus Engine — mirrors Unreal's gameplay framework vocabulary.

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
  | 'SoundEmitter'
  | 'ReflectionProbe'
  | 'CustomMesh'
  | 'Water'
  | 'PCGVolume'
  | 'Label3D'
  | 'Widget3D'
  | 'Timer'
  | 'RayCast3D'
  | 'Path3D'
  | 'PathFollow3D'
  | 'Area3D'

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
  SoundEmitter: 'movable',
  ReflectionProbe: 'stationary',
  CustomMesh: 'static',
  Water: 'static',
  PCGVolume: 'static',
  Label3D: 'movable',
  Widget3D: 'movable',
  Timer: 'movable',
  RayCast3D: 'movable',
  Path3D: 'movable',
  PathFollow3D: 'movable',
  Area3D: 'movable',
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
  /** Wave 24 — CineCamera DOF overrides (when dofOverride, ignores world post stack defaults). */
  dofOverride?: boolean
  dofFocusDistance?: number
  dofFocalLength?: number
  dofBokehScale?: number
  dofFocus?: number
  dofAperture?: number
  /** Cinematic focus pull during play — lerps focus distance over duration from play start. */
  dofFocusPull?: boolean
  dofFocusPullFrom?: number
  dofFocusPullTo?: number
  dofFocusPullDuration?: number
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
  /** Voronoi fracture strain multiplier (Wave 12) */
  fractureStrain?: number
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
  /** Nested prefab reference (Wave 12) — instantiate nested prefab instead of inline actors */
  prefabRef?: string
  /** Visual behavior tree graph */
  btGraph?: import('./btGraph').BTGraph
  btAutoRun?: boolean
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
  /** Godot groups — scene-wide membership for api.getActorsInGroup */
  groups?: string[]
  /** GAS-lite: attribute set asset id (localStorage) */
  attributeSetId?: string
  /** GAS-lite: ability asset ids assigned to this actor */
  abilityIds?: string[]
  /** distance streaming: hide beyond this range from the camera (0 = never) */
  cullDistance?: number
  /** world-partition cell [cx, cz] — auto-assigned from position on save */
  streamCell?: [number, number]
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
  /** Water only */
  water?: WaterProps
  /** PCGVolume only */
  pcg?: PCGProps
  /** PCGVolume node graph (v0.61) */
  pcgGraph?: import('./pcgGraph').PCGGraph
  /** CustomMesh (CSG results) — packed geometry */
  customGeometry?: { positions: number[]; normals: number[]; index?: number[] }
  /** animation clip to play at BeginPlay */
  autoPlayClip?: string
  /** authored animation state machine (FSM) */
  animStateMachine?: import('./animStateMachine').AnimStateMachine
  /** 1D blend space — locomotion-style clip blending */
  blendSpace1D?: import('./animStateMachine').BlendSpace1D
  /** 2D blend space — speed×direction style clip blending */
  blendSpace2D?: import('./animStateMachine').BlendSpace2D
  /** runtime animation parameters (speed, direction, etc.) */
  animParams?: Record<string, number>
  /** Wave 40 — 1D blend param driven by this @export script var */
  blendScriptVarLink?: string
  /** Wave 45 — 2D blend paramX driven by this @export script var */
  blendScriptVarLinkX?: string
  /** Wave 45 — 2D blend paramY driven by this @export script var */
  blendScriptVarLinkY?: string
  /** material node graph */
  materialGraph?: import('./materialGraph').MaterialGraph
  /** cpu = fast per-object; gpu = per-pixel shader graph */
  materialGraphMode?: import('./materialGraph').MaterialGraphMode
  /** shared material asset (UE Material) — base props live in localStorage */
  materialAssetId?: string
  /** per-instance material overrides (UE Material Instance) */
  materialOverrides?: Partial<MaterialProps>
  /** prefab instance root: source prefab name */
  prefabSource?: string
  /** maps to the original prefab actor id (all actors in an instance subtree) */
  prefabActorId?: string
  /** prefab instance root only: per-actor overrides keyed by original prefab id */
  prefabOverrides?: Record<string, Partial<SerializedActor>>
  /** TriggerVolume only */
  trigger?: TriggerProps
  /** SoundEmitter only */
  soundEmitter?: SoundEmitterProps
  /** Label3D only — billboard text plane */
  label3D?: Label3DProps
  /** Widget3D only — interactive HTML in world space */
  widget3D?: Widget3DProps
  /** Timer only — Godot Timer node */
  timer?: TimerProps
  /** RayCast3D only — per-frame scene ray */
  rayCast?: RayCastProps
  /** Path3D only — editable spline waypoints */
  path3D?: Path3DProps
  /** PathFollow3D only — slides along a Path3D actor */
  pathFollow?: PathFollowProps
  /** Area3D only — overlap volume for any actors (Godot Area3D) */
  area3D?: Area3DProps
  /** MultiplayerSynchronizer-lite: property names to replicate (position, rotation, visible, script var names) */
  syncProperties?: string[]
  replicateGAS?: boolean
  /** MultiplayerSpawner-lite: host replicates spawn/despawn of this actor during Play */
  syncSpawn?: boolean
  /** Network owner peer id — empty/undefined = host-owned */
  netOwnerId?: string
  /** Client predicts transform locally; host sync reconciles (snap if error > threshold) */
  clientPredicted?: boolean
  /** Godot SkeletonIK3D-lite — two-bone chains toward actor or world targets */
  ikTargets?: IKTarget[]
  /** Head LookAt toward actor or world position */
  lookAtTarget?: LookAtTarget
  /** Baked AO (approx) — hemisphere raycast, not Lightmass */
  bakedAO?: boolean
  /** Per-mesh vertex color arrays (traversal order) from bakeAO */
  bakedAOMeshes?: number[][]
  /** AO Map Bake (UV2, approx) — texture aoMap, not Lightmass */
  bakedAOMap?: boolean
  /** AO map resolution used during bakeAOMapUV2 */
  bakedAOMapSize?: number
  /** Per-mesh flattened AO map grayscale 0–1 (traversal order) */
  bakedAOMapMeshes?: number[][]
  /** aoMapIntensity applied on MeshStandardMaterial */
  aoMapIntensity?: number
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
  /** Wave 11 — splat texture paint instead of vertex colors */
  useSplatMap?: boolean
  splatResolution?: number
}

/** Rapier impulse joint (Wave 11 physics joints editor). */
export type PhysicsJointType = 'fixed' | 'revolute' | 'prismatic' | 'spherical'

export interface PhysicsJointDef {
  id: string
  type: PhysicsJointType
  bodyA: string
  bodyB: string
  anchorA: [number, number, number]
  anchorB: [number, number, number]
  axis?: [number, number, number]
}

export type SculptTool = 'raise' | 'lower' | 'smooth' | 'flatten' | 'paint'

/** Water — Gerstner-lite animated surface */
export interface WaterProps {
  size: number
  color: string
  opacity: number
  waveHeight: number
  waveLength: number
  speed: number
}

/** PCG-lite — procedural scatter volume (sample → filter → spawn) */
export interface PCGProps {
  geometry: GeometryKind
  color: string
  density: number // instances per 10x10 area
  seed: number
  scaleMin: number
  scaleMax: number
  maxSlopeDeg: number
  alignToNormal: boolean
}

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
  /** GridMap brush radius in cells (0 = single cell) */
  gridBrushSize?: number
  /** Active TileMap layer index (0–3) */
  activeGridLayer?: number
  /** Per-layer packed cells — same tuple as instances */
  gridLayers?: Record<number, number[][]>
  /** 4-neighbor autotile variant refresh on paint (snap mode) */
  gridAutotile?: boolean
  /** Tile-kind neighbor rules + corner sprites when painting/rebuilding (snap mode) */
  gridAutotileRules?: boolean
  /** Per-layer viewport visibility (layers 0–3; default all visible) */
  gridLayerVisibility?: boolean[]
  /** Viewport hover preview of 4-neighbor autotile bitmask on active layer */
  gridAutotilePreview?: boolean
  /** Sprite-sheet UV per cell from autotile rule (snap mode) */
  gridAutotileAtlas?: boolean
  /** Atlas grid columns (default 4) */
  gridAtlasCols?: number
  /** Atlas grid rows (default 4) */
  gridAtlasRows?: number
  /** Custom autotile sheet asset id (localStorage `autotileSheets`) */
  gridAtlasSheetId?: string
  /** Atlas slot index → autotile mask index override (manual tile mapping) */
  gridAtlasTileMap?: Record<number, number>
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

/** Two-bone IK limb chain (glTF humanoid / Mixamo naming). */
export type IKChain = 'leftLeg' | 'rightLeg' | 'leftArm' | 'rightArm'

export interface IKTarget {
  chain: IKChain
  targetActorId?: string
  targetPosition?: [number, number, number]
}

/** Optional head LookAt target — applied after limb IK each frame. */
export interface LookAtTarget {
  targetActorId?: string
  targetPosition?: [number, number, number]
}

/** TriggerVolume — optional reverb zone preset applied while the pawn is inside. */
export type ReverbPreset = '' | 'room' | 'hall' | 'cave'

export interface TriggerProps {
  reverbPreset?: ReverbPreset
}

/** Timer — Godot Timer node: wait, one-shot/loop, autostart, timeout signal. */
export interface TimerProps {
  wait: number
  oneShot: boolean
  autostart: boolean
  paused: boolean
}

export const DEFAULT_TIMER: TimerProps = {
  wait: 1,
  oneShot: true,
  autostart: false,
  paused: false,
}

/** RayCast3D — persistent per-frame ray with hit/clear signals. */
export interface RayCastProps {
  enabled: boolean
  length: number
  /** Local-space cast direction (normalized at runtime). Default -Z. */
  localDirection: [number, number, number]
  /** Exclude this actor's own meshes from hits */
  excludeSelf: boolean
}

export const DEFAULT_RAY_CAST: RayCastProps = {
  enabled: true,
  length: 10,
  localDirection: [0, 0, -1],
  excludeSelf: true,
}

/** Path3D — Catmull-Rom spline through local waypoints. */
export interface Path3DProps {
  waypoints: [number, number, number][]
  closed: boolean
}

/** PathFollow3D — advances along a Path3D actor by progress or speed. */
export interface PathFollowProps {
  /** Path3D actor name to follow */
  pathActorName: string
  progress: number
  /** World units per second along curve (0 = manual progress only) */
  speed: number
  loop: boolean
  autoplay: boolean
  /** Rotate follower to face path tangent */
  rotateToPath: boolean
}

export const DEFAULT_PATH_FOLLOW: PathFollowProps = {
  pathActorName: '',
  progress: 0,
  speed: 2,
  loop: false,
  autoplay: false,
  rotateToPath: true,
}

/** Area3D — non-solid overlap volume (Godot body_entered / body_exited). */
export interface Area3DProps {
  enabled: boolean
  /** Only actors in these groups (empty = monitor all) */
  monitorGroups: string[]
}

export const DEFAULT_AREA3D: Area3DProps = {
  enabled: true,
  monitorGroups: [],
}

/** Distance attenuation curve — normalized distance 0 (min) → 1 (max). */
export type AttenuationCurve = 'linear' | 'inverse' | 'inverseSquare' | 'custom'

export interface AttenuationSettings {
  falloff?: AttenuationCurve
  minDistance?: number
  maxDistance?: number
  /** distance→volume points (0–1 normalized distance) */
  customCurve?: [number, number][]
}

export const DEFAULT_ATTENUATION: AttenuationSettings = {
  falloff: 'inverse',
  minDistance: 1,
  maxDistance: 80,
  customCurve: [
    [0, 1],
    [1, 0],
  ],
}

/** SoundEmitter — plays a MetaSound (or imported sound) at this actor's position. */
export interface SoundEmitterProps {
  metaSoundName: string
  volume: number
  loop: boolean
  autoPlay: boolean
  spatial: boolean
  falloff?: AttenuationCurve
  minDistance?: number
  maxDistance?: number
  customCurve?: [number, number][]
}

export const DEFAULT_SOUND_EMITTER: SoundEmitterProps = {
  metaSoundName: '',
  volume: 1,
  loop: false,
  autoPlay: true,
  spatial: true,
  falloff: 'inverse',
  minDistance: 1,
  maxDistance: 80,
  customCurve: [
    [0, 1],
    [1, 0],
  ],
}

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
  /** Niagara backend: cpu (default) | gpu (opt-in WebGPU tier) */
  particleBackend?: 'cpu' | 'gpu'
  /** Material graph preview backend: glsl (default) | tsl */
  materialBackend?: 'glsl' | 'tsl'
  /** Fixed physics tick rate (Godot _physics_process analog). Default 60 Hz. */
  fixedPhysicsHz?: number
  /** Rendering backend: webgl (default) | webgpu (quality tier) */
  renderBackend?: 'webgl' | 'webgpu'
  /** Post FXAA pass (default true on WebGPU tier) */
  postFxaa?: boolean
  /** Screen-space ambient occlusion */
  postSsao?: boolean
  /** Depth of field (stub — Wave 11 full TSL) */
  postDof?: boolean
  /** WebGL DOF stub vignette focus (0–1, radial) */
  postDofFocus?: number
  /** WebGL DOF stub vignette aperture (0–0.2) */
  postDofAperture?: number
  /** TSL DOF focus distance in world units */
  postDofFocusDistance?: number
  /** TSL DOF focal length in world units */
  postDofFocalLength?: number
  /** TSL DOF bokeh scale (unitless) */
  postDofBokehScale?: number
  /** Temporal AA — WebGPU tier only */
  postTaa?: boolean
  /** Screen-space reflections (Wave 11, honest Lumen skip) */
  postSsr?: boolean
  /** SSR quality preset — Wave 20 parity across WebGL + TSL tiers */
  postSsrPreset?: 'off' | 'low' | 'medium' | 'high'
  /** Wave 21 — ground plane reflector for SSR (WebGL SSRPass) */
  postSsrGround?: boolean
  /** LightProbeGrid interior GI approx (Wave 11) */
  lightProbeGrid?: boolean
  /** Screen-space global illumination approx (Wave 12, WebGPU opt-in) */
  postSsgi?: boolean
  postSsgiPreset?: 'off' | 'low' | 'medium' | 'high'
  /** Wave 25 — lift/gamma/gain color grading stub */
  postColorGrading?: boolean
  postLift?: [number, number, number]
  postGamma?: [number, number, number]
  postGain?: [number, number, number]
  /** Wave 26 — ACES filmic tonemap on WebGPU TSL post stack */
  postAces?: boolean
  /** Wave 27 — exposure-linked lift/gamma/gain preset */
  postColorGradingPreset?: 'off' | 'neutral' | 'cinematic' | 'highContrast'
  /** Wave 28 — per-preset ACES tonemap when a grading preset is active */
  postPresetAces?: Partial<Record<'neutral' | 'cinematic' | 'highContrast', boolean>>
  /** Wave 29 — LUT upload stub (stores filename; identity LUT applied) */
  postGradingLutName?: string
  /** Wave 30 — LUT blend strength when uploaded (0–1) */
  postGradingLutStrength?: number
  /** Wave 31 — decoded LUT cube size (from .cube/.3dl) */
  postGradingLutSize?: number
  /** Wave 32 — persisted LUT RGBA (base64) + atlas dims for level save / export */
  postGradingLutData?: string
  postGradingLutAtlasW?: number
  postGradingLutAtlasH?: number
  postGradingLutFormat?: 'cube' | '3dl' | 'png'
  /** Wave 29 — A/B preset compare blend (0 = A, 1 = B) */
  postGradingCompareT?: number
  postGradingCompareA?: 'neutral' | 'cinematic' | 'highContrast'
  postGradingCompareB?: 'neutral' | 'cinematic' | 'highContrast'
  /** Use Rapier kinematic character for first/third person pawn */
  useRapierCharacter?: boolean
  /** Rapier raycast vehicle for pawn vehicle mode (Wave 11) */
  useRaycastVehicle?: boolean
  /** Merge static meshes at export via BatchedMesh payloads */
  exportBatchStatic?: boolean
  /** Wave 39 — on-screen touch stick + jump (auto on touch devices when unset) */
  touchControls?: boolean
  /** Wave 44 — Gamepad API stick + face buttons (auto when a pad is connected when unset) */
  gamepadControls?: boolean
  /** Wave 49 — touch HUD joystick + action button layout preset */
  touchLayoutPreset?: 'compact' | 'wide' | 'fps'
  /** Wave 64 — vibration on Fire / Interact / Jump (PWA Vibration API; default on when unset) */
  touchHaptics?: boolean
  /** Wave 65 — localStorage save slots + export __LOTUS_SAVES__ */
  saveSlotsEnabled?: boolean
}

/** Grid-chunked world streaming (UE World Partition analog). */
export interface StreamingSettings {
  enabled: boolean
  /** meters per grid cell (default 64) */
  gridSize: number
  /** load actors in cells within this Chebyshev radius of the camera */
  loadRadius: number
  /** export playable splits actors into per-cell JSON for api.loadCell */
  exportByCell: boolean
}

export const DEFAULT_STREAMING: StreamingSettings = {
  enabled: true,
  gridSize: 64,
  loadRadius: 2,
  exportByCell: false,
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
  particleBackend: 'cpu',
  materialBackend: 'glsl',
  fixedPhysicsHz: 60,
  renderBackend: 'webgl',
  postFxaa: true,
  postSsao: false,
  postDof: false,
  postDofFocus: 0.45,
  postDofAperture: 0.035,
  postDofFocusDistance: 5,
  postDofFocalLength: 2,
  postDofBokehScale: 1.2,
  postTaa: false,
  postSsr: false,
  postSsrPreset: 'medium',
  postSsrGround: false,
  lightProbeGrid: false,
  postSsgi: false,
  postSsgiPreset: 'off',
  postColorGrading: false,
  postLift: [0, 0, 0],
  postGamma: [1, 1, 1],
  postGain: [1, 1, 1],
  postAces: false,
  postColorGradingPreset: 'off',
  useRapierCharacter: true,
  useRaycastVehicle: false,
  exportBatchStatic: false,
}

/** Editor viewport camera bookmark — Shift+0-9 set, 0-9 recall (per level). */
export interface CameraBookmark {
  position: [number, number, number]
  quaternion: [number, number, number, number]
}

/** Label3D — canvas-textured billboard text plane in the 3D scene. */
export interface Label3DProps {
  text: string
  fontSize: number
  color: string
  background: string
  padding: number
  billboard: boolean
}

export const DEFAULT_LABEL3D: Label3DProps = {
  text: 'Label',
  fontSize: 48,
  color: '#ffffff',
  background: '#000000aa',
  padding: 12,
  billboard: true,
}

/** Widget3D — CSS3D world-space HTML widget (UE Widget Component analog). */
export interface Widget3DProps {
  /** Raw HTML content (ignored when hudWidgetId is set). */
  html: string
  /** Optional authored HUD widget id — renders that widget's markup in 3D. */
  hudWidgetId?: string
  /** World-space width in meters. */
  width: number
  /** World-space height in meters. */
  height: number
  /** Face the active camera (CSS3DSprite in editor, canvas billboard in export). */
  billboard: boolean
  opacity: number
}

export const DEFAULT_WIDGET3D: Widget3DProps = {
  html: `<div style="padding:12px;background:#1a1d24;border:1px solid #3a4150;border-radius:8px;color:#e8eaed;font:14px system-ui,sans-serif;text-align:center;">
  <button style="padding:8px 16px;background:#2f80ed;color:#fff;border:none;border-radius:6px;cursor:pointer;">Interact</button>
</div>`,
  width: 2,
  height: 1,
  billboard: true,
  opacity: 1,
}

/** Linked level entry — embedded JSON for export / PIE scene switching. */
export interface LevelLink {
  /** manifest key (e.g. dungeon) — used by api.loadLevel('dungeon') */
  name: string
  level: SerializedLevel
}

export interface SerializedLevel {
  engine: 'lotus' | 'vektra'
  version: 1 | 2 | 3 | 4
  name: string
  environment: EnvironmentSettings
  // imported glTF binaries, base64-encoded, keyed by assetId
  assets?: Record<string, { name: string; data: string }>
  /** Asset pipeline v2 — IndexedDB blob refs (id → meta); binaries in IDB */
  assetBlobRefs?: Record<string, { name: string; mime?: string; compression?: string }>
  /** Export-only merged static mesh batches */
  batchedMeshes?: object[]
  actors: SerializedActor[]
  /** master Sequencer timeline */
  sequence?: import('./sequencer').Sequence
  /** data assets (UE DataTables) — name → arbitrary JSON */
  data?: Record<string, unknown>
  /** imported audio clips, base64 */
  sounds?: Record<string, string>
  /** per-imported-sound attenuation defaults */
  soundAttenuation?: Record<string, AttenuationSettings>
  /** authored HUD widgets (UMG designer) */
  hud?: HudWidget[]
  /** HDRI environment (base64 .hdr) — overrides the sky when set */
  hdri?: string
  /** bundled linked levels for multi-level export + api.loadLevel */
  levelLinks?: LevelLink[]
  /** grid-chunked streaming settings */
  streaming?: StreamingSettings
  /** per-level editor camera bookmarks (slots 0–9) */
  cameraBookmarks?: (CameraBookmark | null)[]
  /** Rapier impulse joints (Wave 11) */
  physicsJoints?: PhysicsJointDef[]
}

/** CSS properties keyable on authored HUD widgets (sequencer tracks). */
export type SeqHudProperty = 'opacity' | 'left' | 'top' | 'width' | 'color'

/** UMG-lite authored widget */
export interface HudWidget {
  id: string
  type: 'text' | 'bar' | 'button'
  text: string
  anchor: 'tl' | 'tr' | 'bl' | 'br' | 'center' | 'tc' | 'bc'
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
