import * as THREE from 'three'
import type { LotusPrimaryRenderer } from './lotusRenderer'

/** Wave 14 — TSL RenderPipeline (bloom) for WebGPURenderer canvas. */

export interface TSLPipelineStack {
  active: boolean
  render: () => void
  setSize: (w: number, h: number) => void
  setCamera: (camera: THREE.Camera) => void
  applyBloom: (enabled: boolean, strength: number, threshold: number, radius?: number) => void
  dispose: () => void
}

export interface TSLPipelineOptions {
  bloomEnabled?: boolean
  bloomStrength?: number
  bloomThreshold?: number
  bloomRadius?: number
  ssao?: boolean
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

    const RenderPipeline = (webgpu as { RenderPipeline: new (r: LotusPrimaryRenderer) => { outputNode: unknown; render: () => void; dispose: () => void } }).RenderPipeline
    const pass = (tsl as { pass: (s: THREE.Scene, c: THREE.Camera) => { getTextureNode: (k: string) => unknown } }).pass

    const pipeline = new RenderPipeline(primary)
    let bloomOn = opts.bloomEnabled !== false
    let bloomStrength = opts.bloomStrength ?? 0.35
    let bloomThreshold = opts.bloomThreshold ?? 0.9
    let bloomRadius = opts.bloomRadius ?? 0.6
    let activeCam = camera

    type TSLNode = { add: (n: unknown) => unknown }
    const rebuildOutput = () => {
      const scenePass = pass(scene, activeCam)
      const scenePassColor = scenePass.getTextureNode('output') as unknown as TSLNode
      const bloomPass = bloom(
        scenePassColor as unknown as Parameters<typeof bloom>[0],
        bloomStrength,
        bloomRadius,
        bloomThreshold,
      )
      pipeline.outputNode = bloomOn
        ? (scenePassColor.add(bloomPass) as unknown as typeof pipeline.outputNode)
        : (scenePassColor as unknown as typeof pipeline.outputNode)
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
      dispose: () => pipeline.dispose(),
    }
  } catch {
    return null
  }
}