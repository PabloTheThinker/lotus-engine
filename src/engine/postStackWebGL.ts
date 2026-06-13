import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js'
import type { PostFxSettings } from './renderBackend'

export interface WebGLPostStack {
  composer: EffectComposer
  renderPass: RenderPass
  bloomPass: UnrealBloomPass
  ssaoPass: SSAOPass | null
  fxaaPass: ShaderPass | null
  setSize: (w: number, h: number) => void
  applySettings: (post: {
    bloomEnabled: boolean
    bloomStrength: number
    bloomThreshold: number
    bloomRadius: number
    exposure: number
  }) => void
  dispose: () => void
}

export function createWebGLPostStack(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
  fx: PostFxSettings,
): WebGLPostStack {
  const floatOk = renderer.capabilities.isWebGL2 && !!renderer.extensions.get('EXT_color_buffer_float')
  const composerTarget = new THREE.WebGLRenderTarget(width, height, {
    type: floatOk ? THREE.HalfFloatType : THREE.UnsignedByteType,
  })
  const composer = new EffectComposer(renderer, composerTarget)
  const renderPass = new RenderPass(scene, camera)
  composer.addPass(renderPass)

  let ssaoPass: SSAOPass | null = null
  if (fx.ssao) {
    ssaoPass = new SSAOPass(scene, camera, width, height)
    ssaoPass.kernelRadius = 8
    ssaoPass.minDistance = 0.002
    ssaoPass.maxDistance = 0.12
    composer.addPass(ssaoPass)
  }

  const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.35, 0.6, 0.9)
  composer.addPass(bloomPass)

  let fxaaPass: ShaderPass | null = null
  if (fx.fxaa) {
    fxaaPass = new ShaderPass(FXAAShader)
    composer.addPass(fxaaPass)
  }

  composer.addPass(new OutputPass())

  return {
    composer,
    renderPass,
    bloomPass,
    ssaoPass,
    fxaaPass,
    setSize(w, h) {
      composer.setSize(w, h)
      bloomPass.resolution.set(w, h)
      if (ssaoPass) ssaoPass.setSize(w, h)
      if (fxaaPass) {
        const pr = renderer.getPixelRatio()
        fxaaPass.material.uniforms.resolution.value.x = 1 / (w * pr)
        fxaaPass.material.uniforms.resolution.value.y = 1 / (h * pr)
      }
    },
    applySettings(post) {
      bloomPass.enabled = post.bloomEnabled
      bloomPass.strength = post.bloomStrength
      bloomPass.threshold = post.bloomThreshold
      bloomPass.radius = post.bloomRadius
      renderer.toneMappingExposure = post.exposure
    },
    dispose() {
      composerTarget.dispose()
      composer.dispose()
    },
  }
}