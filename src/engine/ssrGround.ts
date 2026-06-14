import * as THREE from 'three'
import { ReflectorForSSRPass } from 'three/addons/objects/ReflectorForSSRPass.js'

/** Wave 21 — SSR ground reflector plane (WebGL SSRPass + scene grounding). */

export interface SSRGroundHandle {
  reflector: ReflectorForSSRPass
  dispose: () => void
}

export function createSSRGroundReflector(size = 120): SSRGroundHandle {
  const geo = new THREE.PlaneGeometry(size, size)
  const reflector = new ReflectorForSSRPass(geo, {
    clipBias: 0.003,
    textureWidth: 512,
    textureHeight: 512,
    color: 0x888888,
  })
  reflector.rotation.x = -Math.PI / 2
  reflector.position.y = 0
  reflector.userData.isSSRGround = true
  reflector.userData.isEditorOnly = true
  return {
    reflector,
    dispose: () => {
      geo.dispose()
      reflector.getRenderTarget().dispose()
      reflector.material.dispose()
    },
  }
}

export interface TSLSSRGroundHandle {
  mesh: THREE.Mesh
  dispose: () => void
}

/** Wave 22 — TSL reflector ground plane for WebGPU SSR tier. */
export async function createTSLSSRGroundMesh(size = 120): Promise<TSLSSRGroundHandle> {
  const webgpu = await import('three/webgpu')
  const tsl = await import('three/tsl')
  const reflectorFn = (tsl as { reflector: () => { target: THREE.Object3D } & unknown }).reflector
  const groundReflector = reflectorFn()
  const geo = new THREE.PlaneGeometry(size, size)
  const MeshBasicNodeMaterial = (webgpu as {
    MeshBasicNodeMaterial: new () => THREE.Material & { colorNode?: unknown; dispose: () => void }
  }).MeshBasicNodeMaterial
  const mat = new MeshBasicNodeMaterial()
  mat.colorNode = groundReflector
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0
  mesh.userData.isSSRGround = true
  mesh.userData.isEditorOnly = true
  mesh.add(groundReflector.target)
  return {
    mesh,
    dispose: () => {
      geo.dispose()
      mat.dispose()
    },
  }
}

/** Attach or remove SSR ground reflector on a scene. */
export function syncSSRGroundReflector(
  scene: THREE.Scene,
  enabled: boolean,
  existing: SSRGroundHandle | null,
): SSRGroundHandle | null {
  if (!enabled) {
    if (existing) {
      scene.remove(existing.reflector)
      existing.dispose()
    }
    return null
  }
  if (existing) return existing
  const handle = createSSRGroundReflector()
  scene.add(handle.reflector)
  return handle
}

/** Sync TSL ground reflector mesh (WebGPU tier). */
export async function syncTSLSSRGround(
  scene: THREE.Scene,
  enabled: boolean,
  existing: TSLSSRGroundHandle | null,
): Promise<TSLSSRGroundHandle | null> {
  if (!enabled) {
    if (existing) {
      scene.remove(existing.mesh)
      existing.dispose()
    }
    return null
  }
  if (existing) return existing
  const handle = await createTSLSSRGroundMesh()
  scene.add(handle.mesh)
  return handle
}