import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js'
import { SSRPass } from 'three/addons/postprocessing/SSRPass.js'
import type { PostFxSettings } from './renderBackend'
import { createSSGIPass, updateSSGIPass } from './postStackSSGI'
import type { SSGISettings } from './ssgiPreset'

export interface WebGLPostStack {
  composer: EffectComposer
  renderPass: RenderPass
  bloomPass: UnrealBloomPass
  ssaoPass: SSAOPass | null
  ssrPass: SSRPass | null
  fxaaPass: ShaderPass | null
  ssgiPass: ShaderPass | null
  setSize: (w: number, h: number) => void
  applySSGI: (settings: SSGISettings) => void
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
  ssgi?: SSGISettings,
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

  let ssrPass: SSRPass | null = null
  if (fx.ssr) {
    ssrPass = new SSRPass({
      renderer,
      scene,
      camera,
      width,
      height,
      selects: null,
      isBouncing: false,
      groundReflector: null,
    })
    composer.addPass(ssrPass)
  }

  const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.35, 0.6, 0.9)
  composer.addPass(bloomPass)

  const ssgiPass = ssgi ? createSSGIPass(ssgi) : null
  if (ssgiPass) composer.addPass(ssgiPass)

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
    ssrPass,
    fxaaPass,
    ssgiPass,
    applySSGI(settings) {
      updateSSGIPass(ssgiPass, settings)
    },
    setSize(w, h) {
      composer.setSize(w, h)
      bloomPass.resolution.set(w, h)
      if (ssaoPass) ssaoPass.setSize(w, h)
      if (ssrPass) ssrPass.setSize(w, h)
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