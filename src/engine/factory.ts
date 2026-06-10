import * as THREE from 'three'
import { Actor, nextActorId } from './Actor'
import type { ActorType, CameraProps, GeometryKind, LightProps, MaterialProps } from './types'
import { DEFAULT_MATERIAL, DEFAULT_PHYSICS } from './types'

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
