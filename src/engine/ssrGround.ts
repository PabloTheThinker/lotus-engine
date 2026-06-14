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