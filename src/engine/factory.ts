import * as THREE from 'three'
import { Actor, nextActorId } from './Actor'
import { ParticleSystem, DEFAULT_PARTICLES } from './particles'
import type { ActorType, CameraProps, GeometryKind, LightProps, MaterialProps } from './types'
import { DEFAULT_FOLIAGE, DEFAULT_MATERIAL, DEFAULT_PHYSICS, DEFAULT_POST_PROCESS } from './types'
import type { FoliageProps } from './types'

export function buildGeometry(kind: GeometryKind): THREE.BufferGeometry {
  switch (kind) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1)
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 32, 16)
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
    case 'cone':
      return new THREE.ConeGeometry(0.5, 1, 32)
    case 'plane':
      return new THREE.PlaneGeometry(1, 1, 1, 1)
    case 'torus':
      return new THREE.TorusGeometry(0.5, 0.2, 16, 48)
    case 'capsule':
      return new THREE.CapsuleGeometry(0.3, 0.6, 8, 16)
    case 'icosahedron':
      return new THREE.IcosahedronGeometry(0.5, 0)
  }
}

export function buildMaterial(props: MaterialProps): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(props.color),
    roughness: props.roughness,
    metalness: props.metalness,
    emissive: new THREE.Color(props.emissive),
    emissiveIntensity: props.emissiveIntensity,
    wireframe: props.wireframe,
    opacity: props.opacity,
    transparent: props.transparent,
  })
}

export function applyMaterialProps(mat: THREE.MeshStandardMaterial, props: MaterialProps) {
  mat.color.set(props.color)
  mat.roughness = props.roughness
  mat.metalness = props.metalness
  mat.emissive.set(props.emissive)
  mat.emissiveIntensity = props.emissiveIntensity
  mat.wireframe = props.wireframe
  mat.opacity = props.opacity
  mat.transparent = props.transparent || props.opacity < 1
  mat.needsUpdate = true
}

export function createStaticMeshActor(kind: GeometryKind, name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'StaticMesh')
  actor.geometryKind = kind
  actor.materialProps = { ...DEFAULT_MATERIAL }
  actor.physicsProps = { ...DEFAULT_PHYSICS }
  const mesh = new THREE.Mesh(buildGeometry(kind), buildMaterial(actor.materialProps))
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.actorId = id
  if (kind === 'plane') mesh.rotation.x = -Math.PI / 2
  actor.mesh = mesh
  actor.root.add(mesh)
  return actor
}

const DEFAULT_LIGHT: Record<string, LightProps> = {
  RectLight: { color: '#ffffff', intensity: 8, width: 3, height: 2 },
  PointLight: { color: '#ffffff', intensity: 10, distance: 0, decay: 2, castShadow: true },
  SpotLight: { color: '#ffffff', intensity: 20, distance: 0, decay: 2, angle: 0.5, penumbra: 0.3, castShadow: true },
  DirectionalLight: { color: '#ffffff', intensity: 2, castShadow: true },
  AmbientLight: { color: '#404a5a', intensity: 1 },
}

export function createLightActor(type: ActorType, name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, type)
  const props = { ...DEFAULT_LIGHT[type] }
  actor.lightProps = props

  let light: THREE.Light
  let helper: THREE.Object3D | undefined
  switch (type) {
    case 'PointLight': {
      const l = new THREE.PointLight(props.color, props.intensity, props.distance, props.decay)
      l.castShadow = !!props.castShadow
      helper = new THREE.PointLightHelper(l, 0.3)
      light = l
      break
    }
    case 'SpotLight': {
      const l = new THREE.SpotLight(props.color, props.intensity, props.distance, props.angle, props.penumbra, props.decay)
      l.castShadow = !!props.castShadow
      l.target.position.set(0, -1, 0)
      helper = new THREE.SpotLightHelper(l)
      light = l
      break
    }
    case 'DirectionalLight': {
      const l = new THREE.DirectionalLight(props.color, props.intensity)
      l.castShadow = !!props.castShadow
      l.shadow.mapSize.set(2048, 2048)
      l.shadow.camera.left = -20
      l.shadow.camera.right = 20
      l.shadow.camera.top = 20
      l.shadow.camera.bottom = -20
      helper = new THREE.DirectionalLightHelper(l, 0.5)
      light = l
      break
    }
    case 'RectLight': {
      const l = new THREE.RectAreaLight(props.color, props.intensity, props.width ?? 3, props.height ?? 2)
      l.lookAt(0, -1, 0)
      helper = new THREE.Mesh(
        new THREE.PlaneGeometry(props.width ?? 3, props.height ?? 2),
        new THREE.MeshBasicMaterial({ color: props.color, wireframe: true }),
      )
      helper.rotation.x = -Math.PI / 2
      light = l
      break
    }
    default:
      light = new THREE.AmbientLight(props.color, props.intensity)
  }

  light.userData.actorId = id
  actor.light = light
  actor.root.add(light)
  if (light instanceof THREE.SpotLight) actor.root.add(light.target)
  if (helper) {
    helper.userData.isHelper = true
    actor.lightHelper = helper
    actor.root.add(helper)
  }
  return actor
}

export function createCameraActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'Camera')
  const props: CameraProps = { fov: 60, near: 0.1, far: 2000 }
  actor.cameraProps = props
  const cam = new THREE.PerspectiveCamera(props.fov, 16 / 9, props.near, props.far)
  cam.userData.actorId = id
  actor.camera = cam
  actor.root.add(cam)
  const helper = new THREE.CameraHelper(cam)
  helper.userData.isHelper = true
  actor.cameraHelper = helper
  return actor
}

export function createEmptyActor(name: string, id = nextActorId()): Actor {
  return new Actor(id, name, 'Empty')
}

/** ParticleEmitter — Niagara/CPUParticles3D analog with editor preview. */
export function createParticleEmitterActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'ParticleEmitter')
  actor.particleProps = { ...DEFAULT_PARTICLES }
  const system = new ParticleSystem(actor.particleProps)
  system.points.userData.actorId = id
  actor.particleSystem = system
  actor.root.add(system.points)
  // editor pick proxy + icon
  const proxy = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xf5a623, wireframe: true }),
  )
  proxy.userData.actorId = id
  proxy.userData.isEditorOnly = true
  actor.mesh = proxy
  actor.root.add(proxy)
  return actor
}

const FOLIAGE_CAP = 4000
const _fm = new THREE.Matrix4()
const _fq = new THREE.Quaternion()
const _fe = new THREE.Euler()
const _fs = new THREE.Vector3()
const _fp = new THREE.Vector3()

/** Sync an InstancedMesh from a foliage layer's packed instance list. */
export function rebuildFoliage(actor: Actor) {
  const mesh = actor.foliageMesh
  const props = actor.foliageProps
  if (!mesh || !props) return
  const count = Math.min(props.instances.length, FOLIAGE_CAP)
  for (let i = 0; i < count; i++) {
    const [x, y, z, sc, rotY] = props.instances[i]
    _fp.set(x, y, z)
    _fe.set(0, rotY, 0)
    _fq.setFromEuler(_fe)
    _fs.setScalar(sc)
    _fm.compose(_fp, _fq, _fs)
    mesh.setMatrixAt(i, _fm)
  }
  mesh.count = count
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
}

/** FoliageLayer — UE Foliage mode analog: paintable instanced scatter. */
export function createFoliageLayerActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'FoliageLayer')
  actor.foliageProps = { ...DEFAULT_FOLIAGE, instances: [] }
  buildFoliageMesh(actor)
  return actor
}

/** (re)create the instanced mesh after geometry/color changes */
export function buildFoliageMesh(actor: Actor) {
  const props = actor.foliageProps as FoliageProps
  if (actor.foliageMesh) {
    actor.foliageMesh.removeFromParent()
    actor.foliageMesh.geometry.dispose()
    ;(actor.foliageMesh.material as THREE.Material).dispose()
  }
  const geo = buildGeometry(props.geometry)
  const mat = new THREE.MeshStandardMaterial({ color: props.color, roughness: 0.85 })
  const mesh = new THREE.InstancedMesh(geo, mat, FOLIAGE_CAP)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.actorId = actor.id
  mesh.userData.isFoliage = true
  mesh.count = 0
  actor.foliageMesh = mesh
  actor.root.add(mesh)
  rebuildFoliage(actor)
}

/** Folder — UE World Outliner organizational node (no renderable components). */
export function createFolderActor(name: string, id = nextActorId()): Actor {
  return new Actor(id, name, 'Folder')
}

/** PostProcessVolume — local post-stack overrides when the camera is inside. */
export function createPostProcessVolumeActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'PostProcessVolume')
  actor.postProcessProps = { ...DEFAULT_POST_PROCESS }
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x9b59b6,
      wireframe: true,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
  )
  box.userData.isHelper = true
  box.userData.isEditorOnly = true
  actor.volumeHelper = box
  actor.root.add(box)
  return actor
}

/** ReflectionProbe — bakes a local cubemap and feeds nearby PBR materials. */
export function createReflectionProbeActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'ReflectionProbe')
  actor.probeProps = { radius: 8 }
  const gizmo = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x56b3c9, wireframe: true }),
  )
  gizmo.userData.actorId = id
  gizmo.userData.isEditorOnly = true
  actor.mesh = gizmo
  actor.root.add(gizmo)
  return actor
}

/** CustomMesh — arbitrary geometry (CSG results) with PBR material. */
export function createCustomMeshActor(
  name: string,
  geom: { positions: number[]; normals: number[]; index?: number[] },
  id = nextActorId(),
): Actor {
  const actor = new Actor(id, name, 'CustomMesh')
  actor.customGeometry = geom
  actor.materialProps = { ...DEFAULT_MATERIAL }
  actor.physicsProps = { ...DEFAULT_PHYSICS }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(geom.positions, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(geom.normals, 3))
  if (geom.index) g.setIndex(geom.index)
  g.computeBoundingSphere()
  const mesh = new THREE.Mesh(g, buildMaterial(actor.materialProps))
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.actorId = id
  actor.mesh = mesh
  actor.root.add(mesh)
  return actor
}

/** TriggerVolume — unit box volume emitting enter:/exit: signals for the pawn. */
export function createTriggerVolumeActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'TriggerVolume')
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x46a758, wireframe: true, transparent: true, opacity: 0.5, depthWrite: false }),
  )
  box.userData.actorId = id
  box.userData.isEditorOnly = true
  actor.mesh = box
  actor.root.add(box)
  return actor
}

/** PlayerStart — where the pawn spawns when Play begins (UE PlayerStart). */
export function createPlayerStartActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'PlayerStart')
  const capsule = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, 1.1, 4, 12),
    new THREE.MeshBasicMaterial({ color: 0x2f80ed, wireframe: true }),
  )
  capsule.position.y = 0.9
  capsule.userData.actorId = id
  capsule.userData.isEditorOnly = true
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0.9, 0), 1, 0xf5a623, 0.3, 0.2)
  arrow.userData.isHelper = true
  actor.mesh = capsule // makes it pickable in the viewport
  actor.root.add(capsule, arrow)
  return actor
}

/** Wrap a loaded glTF scene in an actor. */
export function createImportedMeshActor(
  name: string,
  assetId: string,
  gltfScene: THREE.Object3D,
  id = nextActorId(),
): Actor {
  const actor = new Actor(id, name, 'ImportedMesh')
  actor.assetId = assetId
  actor.physicsProps = { ...DEFAULT_PHYSICS }
  gltfScene.traverse((o) => {
    o.userData.actorId = id
    if (o instanceof THREE.Mesh) {
      o.castShadow = true
      o.receiveShadow = true
      // expose ONE mesh for bounding-box physics; picking traverses anyway
      if (!actor.mesh) actor.mesh = o
    }
  })
  actor.root.add(gltfScene)
  return actor
}
