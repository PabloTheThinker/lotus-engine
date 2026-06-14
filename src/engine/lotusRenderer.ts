import * as THREE from 'three'
import type { RenderBackend } from './renderBackend'
import { runWebGPUQAMatrix, type WebGPUQAResult } from './webgpuQA'

/** Wave 13 — dual renderer bundle: WebGPURenderer canvas + WebGL aux for composer/probes. */

export type LotusPrimaryRenderer = THREE.WebGLRenderer | import('three/webgpu').WebGPURenderer

export interface LotusRendererBundle {
  /** Renderer attached to the viewport canvas */
  primary: LotusPrimaryRenderer
  /** WebGL renderer for EffectComposer, path tracer, cube probes */
  webgl: THREE.WebGLRenderer
  backend: RenderBackend
  /** True when primary is WebGPURenderer and QA passed */
  webgpuActive: boolean
  qa: WebGPUQAResult
  dispose(): void
}

export function isWebGLRenderer(r: LotusPrimaryRenderer): r is THREE.WebGLRenderer {
  return r instanceof THREE.WebGLRenderer
}

/** Create viewport renderer(s). WebGPU tier uses WebGPURenderer on canvas + hidden WebGL aux. */
export async function createLotusRenderer(
  mount: HTMLElement,
  tier: RenderBackend,
): Promise<LotusRendererBundle> {
  const qa = await runWebGPUQAMatrix()
  const wantWebGPU = tier === 'webgpu' && qa.ok

  const webglAux = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  webglAux.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  webglAux.shadowMap.enabled = true
  webglAux.shadowMap.type = THREE.PCFShadowMap
  webglAux.toneMapping = THREE.ACESFilmicToneMapping
  webglAux.toneMappingExposure = 0.75
  webglAux.outputColorSpace = THREE.SRGBColorSpace

  if (wantWebGPU) {
    try {
      const { WebGPURenderer } = await import('three/webgpu')
      const primary = new WebGPURenderer({ antialias: true, alpha: false })
      primary.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      primary.toneMapping = THREE.ACESFilmicToneMapping
      primary.toneMappingExposure = 0.75
      primary.outputColorSpace = THREE.SRGBColorSpace
      await primary.init()
      mount.appendChild(primary.domElement)
      primary.domElement.tabIndex = -1

      return {
        primary,
        webgl: webglAux,
        backend: 'webgpu',
        webgpuActive: true,
        qa,
        dispose() {
          primary.dispose()
          webglAux.dispose()
        },
      }
    } catch {
      // fall through to WebGL canvas
    }
  }

  webglAux.domElement.tabIndex = -1
  mount.appendChild(webglAux.domElement)

  return {
    primary: webglAux,
    webgl: webglAux,
    backend: 'webgl',
    webgpuActive: false,
    qa,
    dispose() {
      webglAux.dispose()
    },
  }
}

/** Triangle count for stats HUD — works with WebGL or WebGPU primary. */
export function rendererTriangleCount(primary: LotusPrimaryRenderer): number {
  const info = (primary as { info?: { render?: { triangles?: number } } }).info
  return info?.render?.triangles ?? 0
}