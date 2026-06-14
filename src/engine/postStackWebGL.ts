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
import { applySSRToWebGLPass, getSSRSettings, type SSRSettings } from './ssrPreset'
import type { EnvironmentSettings } from './types'
import { createDOFStubPass, updateDOFStubPass, type DOFStubSettings } from './postStackDOF'
import { createColorGradingPass, updateColorGradingPass, type ColorGradingSettings } from './postStackColorGrading'
import { createSSRGroundReflector, type SSRGroundHandle } from './ssrGround'

export interface WebGLPostStack {
  composer: EffectComposer
  renderPass: RenderPass
  bloomPass: UnrealBloomPass
  ssaoPass: SSAOPass | null
  ssrPass: SSRPass | null
  fxaaPass: ShaderPass | null
  ssgiPass: ShaderPass | null
  dofPass: ShaderPass | null
  colorGradingPass: ShaderPass | null
  ssrGround: SSRGroundHandle | null
  setSize: (w: number, h: number) => void
  applySSGI: (settings: SSGISettings) => void
  applySSR: (settings: SSRSettings) => void
  applyDOF: (settings: DOFStubSettings) => void
  applyColorGrading: (settings: ColorGradingSettings) => void
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
  env?: EnvironmentSettings,
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

  let ssrGround: SSRGroundHandle | null = null
  let ssrPass: SSRPass | null = null
  if (fx.ssr) {
    const ssrSettings = env ? getSSRSettings(env) : null
    if (ssrSettings?.groundReflect) {
      ssrGround = createSSRGroundReflector()
      scene.add(ssrGround.reflector)
    }
    ssrPass = new SSRPass({
      renderer,
      scene,
      camera,
      width,
      height,
      selects: null,
      isBouncing: !!ssrGround,
      groundReflector: ssrGround?.reflector ?? null,
    })
    composer.addPass(ssrPass)
    if (ssrSettings) applySSRToWebGLPass(ssrPass, ssrSettings)
  }

  const dofPass = createDOFStubPass({ enabled: fx.dof })
  if (dofPass) composer.addPass(dofPass)

  const colorGradingPass = createColorGradingPass({ enabled: false, lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1] })
  if (colorGradingPass) composer.addPass(colorGradingPass)

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
    dofPass,
    colorGradingPass,
    ssrGround,
    applySSGI(settings) {
      updateSSGIPass(ssgiPass, settings)
    },
    applySSR(settings) {
      if (ssrPass) applySSRToWebGLPass(ssrPass, settings)
    },
    applyDOF(settings) {
      updateDOFStubPass(dofPass, settings)
    },
    applyColorGrading(settings) {
      updateColorGradingPass(colorGradingPass, settings)
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
      if (ssrGround) {
        scene.remove(ssrGround.reflector)
        ssrGround.dispose()
      }
      composerTarget.dispose()
      composer.dispose()
    },
  }
}