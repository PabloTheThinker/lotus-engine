import * as THREE from 'three'
import type { PostFxSettings } from './renderBackend'
import type { LotusPrimaryRenderer } from './lotusRenderer'

/** Wave 14–15 — TSL RenderPipeline (GTAO, bloom, FXAA) for WebGPURenderer canvas. */

export interface TSLPipelineStack {
  active: boolean
  render: () => void
  setSize: (w: number, h: number) => void
  setCamera: (camera: THREE.Camera) => void
  applyBloom: (enabled: boolean, strength: number, threshold: number, radius?: number) => void
  applyPostFx: (fx: PostFxSettings, bloom: {
    bloomEnabled: boolean
    bloomStrength: number
    bloomThreshold: number
    bloomRadius: number
  }) => void
  dispose: () => void
}

export interface TSLPipelineOptions {
  bloomEnabled?: boolean
  bloomStrength?: number
  bloomThreshold?: number
  bloomRadius?: number
  ssao?: boolean
  fxaa?: boolean
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
    let activeCam = camera

    type TSLNode = unknown
    const rebuildOutput = () => {
      const scenePass = pass(scene, activeCam)
      if (ssaoOn) {
        scenePass.setMRT(mrt({ output, normal: normalView }))
      }
      let colorNode = scenePass.getTextureNode('output') as TSLNode

      if (ssaoOn) {
        const depth = scenePass.getTextureNode('depth') as TSLNode
        const normal = scenePass.getTextureNode('normal') as TSLNode
        const aoPass = ao(
          depth as Parameters<typeof ao>[0],
          normal as Parameters<typeof ao>[1],
          activeCam,
        ) as { getTextureNode: () => TSLNode }
        const aoTex = aoPass.getTextureNode() as { r: unknown }
        colorNode = mul(colorNode, vec4(vec3(aoTex.r), 1))
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
      applyPostFx(fx, bloom) {
        ssaoOn = fx.ssao
        fxaaOn = fx.fxaa
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