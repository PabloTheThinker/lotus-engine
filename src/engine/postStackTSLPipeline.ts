import * as THREE from 'three'
import type { PostFxSettings } from './renderBackend'
import type { LotusPrimaryRenderer } from './lotusRenderer'
import type { SSGISettings, SSGIPreset } from './ssgiPreset'

/** Wave 14–16 — TSL RenderPipeline (GTAO, SSGI, SSR, bloom, FXAA) for WebGPURenderer canvas. */

export interface TSLPipelineStack {
  active: boolean
  render: () => void
  setSize: (w: number, h: number) => void
  setCamera: (camera: THREE.Camera) => void
  applyBloom: (enabled: boolean, strength: number, threshold: number, radius?: number) => void
  applyPostFx: (
    fx: PostFxSettings,
    bloom: {
      bloomEnabled: boolean
      bloomStrength: number
      bloomThreshold: number
      bloomRadius: number
    },
    ssgi?: SSGISettings,
  ) => void
  dispose: () => void
}

export interface TSLPipelineOptions {
  bloomEnabled?: boolean
  bloomStrength?: number
  bloomThreshold?: number
  bloomRadius?: number
  ssao?: boolean
  fxaa?: boolean
  ssr?: boolean
  ssgi?: SSGISettings
}

const SSGI_SLICE: Record<SSGIPreset, number> = {
  off: 1,
  low: 1,
  medium: 2,
  high: 3,
}

export async function createTSLRenderPipeline(
  primary: LotusPrimaryRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
  opts: TSLPipelineOptions = {},
): Promise<TSLPipelineStack | null> {
  try {
    const webgpu = await import('three/webgpu')
    const tsl = await import('three/tsl')
    const { bloom } = await import('three/addons/tsl/display/BloomNode.js')
    const { fxaa } = await import('three/addons/tsl/display/FXAANode.js')
    const { ao } = await import('three/addons/tsl/display/GTAONode.js')
    const { ssgi } = await import('three/addons/tsl/display/SSGINode.js')
    const { ssr } = await import('three/addons/tsl/display/SSRNode.js')

    const RenderPipeline = (webgpu as {
      RenderPipeline: new (r: LotusPrimaryRenderer) => {
        outputNode: unknown
        render: () => void
        dispose: () => void
      }
    }).RenderPipeline
    const pass = (tsl as {
      pass: (s: THREE.Scene, c: THREE.Camera) => {
        setMRT: (m: unknown) => void
        getTextureNode: (k: string) => unknown
      }
    }).pass
    const mrt = (tsl as { mrt: (o: Record<string, unknown>) => unknown }).mrt
    const output = (tsl as { output: unknown }).output
    const normalView = (tsl as { normalView: unknown }).normalView
    const metalness = (tsl as { metalness: unknown }).metalness
    const roughness = (tsl as { roughness: unknown }).roughness
    const vec3 = (tsl as { vec3: (n: unknown) => unknown }).vec3
    const vec4 = (tsl as { vec4: (a: unknown, b?: unknown) => unknown }).vec4
    const mul = (tsl as { mul: (a: unknown, b: unknown) => unknown }).mul
    const add = (tsl as { add: (a: unknown, b: unknown) => unknown }).add
    const pipeline = new RenderPipeline(primary)
    let bloomOn = opts.bloomEnabled !== false
    let bloomStrength = opts.bloomStrength ?? 0.35
    let bloomThreshold = opts.bloomThreshold ?? 0.9
    let bloomRadius = opts.bloomRadius ?? 0.6
    let ssaoOn = opts.ssao ?? false
    let fxaaOn = opts.fxaa ?? false
    let ssrOn = opts.ssr ?? false
    let ssgiOn = opts.ssgi?.enabled ?? false
    let ssgiSettings = opts.ssgi
    let activeCam = camera

    type TSLNode = unknown
    const rebuildOutput = () => {
      const scenePass = pass(scene, activeCam)
      const needsMRT = ssaoOn || ssgiOn || ssrOn
      if (needsMRT) {
        const mrtOut: Record<string, unknown> = { output, normal: normalView }
        if (ssrOn) {
          mrtOut.metalness = metalness
          mrtOut.roughness = roughness
        }
        scenePass.setMRT(mrt(mrtOut))
      }
      let colorNode = scenePass.getTextureNode('output') as TSLNode

      if (needsMRT) {
        const depth = scenePass.getTextureNode('depth') as TSLNode
        const normal = scenePass.getTextureNode('normal') as TSLNode

        if (ssaoOn) {
          const aoPass = ao(
            depth as Parameters<typeof ao>[0],
            normal as Parameters<typeof ao>[1],
            activeCam,
          ) as { getTextureNode: () => TSLNode }
          const aoTex = aoPass.getTextureNode() as { r: unknown }
          colorNode = mul(colorNode, vec4(vec3(aoTex.r), 1))
        }

        if (ssgiOn && ssgiSettings?.enabled) {
          const cam = activeCam as THREE.PerspectiveCamera
          const ssgiPass = ssgi(
            colorNode as Parameters<typeof ssgi>[0],
            depth as Parameters<typeof ssgi>[1],
            normal as Parameters<typeof ssgi>[2],
            cam,
          ) as unknown as {
            getTextureNode: () => { r: unknown; g: unknown; b: unknown; a: unknown }
            sliceCount: { value: number }
            stepCount: { value: number }
            giIntensity: { value: number }
            radius: { value: number }
          }
          ssgiPass.sliceCount.value = SSGI_SLICE[ssgiSettings.preset] ?? 1
          ssgiPass.stepCount.value = Math.max(4, ssgiSettings.samples)
          ssgiPass.giIntensity.value = Math.max(1, ssgiSettings.intensity * 12)
          ssgiPass.radius.value = Math.max(2, ssgiSettings.radius * 14)
          const giTex = ssgiPass.getTextureNode()
          colorNode = add(colorNode, giTex as TSLNode)
          if (!ssaoOn) {
            colorNode = mul(colorNode, vec4(vec3(giTex.a), 1))
          }
        }

        if (ssrOn) {
          const metalnessTex = scenePass.getTextureNode('metalness') as TSLNode
          const roughnessTex = scenePass.getTextureNode('roughness') as TSLNode
          const ssrPass = ssr(
            colorNode as Parameters<typeof ssr>[0],
            depth as Parameters<typeof ssr>[1],
            normal as Parameters<typeof ssr>[2],
            metalnessTex as Parameters<typeof ssr>[3],
            roughnessTex as Parameters<typeof ssr>[4],
            activeCam,
          ) as { getTextureNode: () => TSLNode }
          colorNode = add(colorNode, ssrPass.getTextureNode())
        }
      }

      if (bloomOn) {
        const bloomPass = bloom(
          colorNode as Parameters<typeof bloom>[0],
          bloomStrength,
          bloomRadius,
          bloomThreshold,
        )
        colorNode = add(colorNode, bloomPass)
      }

      if (fxaaOn) {
        colorNode = fxaa(colorNode as Parameters<typeof fxaa>[0])
      }

      pipeline.outputNode = colorNode as typeof pipeline.outputNode
      ;(pipeline as { needsUpdate?: boolean }).needsUpdate = true
    }

    rebuildOutput()
    primary.setSize(width, height, false)

    return {
      active: true,
      render: () => pipeline.render(),
      setSize(w, h) {
        primary.setSize(w, h, false)
      },
      setCamera(cam) {
        if (activeCam === cam) return
        activeCam = cam
        rebuildOutput()
      },
      applyBloom(enabled, s, t, r = 0.6) {
        bloomOn = enabled
        bloomStrength = s
        bloomThreshold = t
        bloomRadius = r
        rebuildOutput()
      },
      applyPostFx(fx, bloom, ssgi) {
        ssaoOn = fx.ssao
        fxaaOn = fx.fxaa
        ssrOn = fx.ssr
        ssgiOn = ssgi?.enabled ?? false
        ssgiSettings = ssgi
        bloomOn = bloom.bloomEnabled
        bloomStrength = bloom.bloomStrength
        bloomThreshold = bloom.bloomThreshold
        bloomRadius = bloom.bloomRadius
        rebuildOutput()
      },
      dispose: () => pipeline.dispose(),
    }
  } catch {
    return null
  }
}