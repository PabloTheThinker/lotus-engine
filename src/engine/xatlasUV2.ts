import * as THREE from 'three'
import { generateBoxProjectionUV2 } from './lightmapBake'

/**
 * UV2 unwrap for AO / lightmap bakes.
 * Tries xatlas-web WASM in the browser; falls back to box-projection (approx).
 */

let xatlasInit: Promise<boolean> | null = null

async function ensureXatlas(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (!xatlasInit) {
    xatlasInit = (async () => {
      try {
        const createModule = (await import('xatlas-web')).default as (opts: Record<string, unknown>) => unknown
        await new Promise<void>((resolve, reject) => {
          createModule({
            locateFile: (path: string) => new URL(`../../node_modules/xatlas-web/dist/${path}`, import.meta.url).href,
            onRuntimeInitialized: () => resolve(),
            onAbort: (msg: string) => reject(new Error(msg)),
          })
        })
        return true
      } catch {
        return false
      }
    })()
  }
  return xatlasInit
}

export interface UnwrapUV2Result {
  method: 'xatlas' | 'box' | 'existing' | 'failed'
  vertexCount: number
}

/** Ensure geometry has uv2 for texture bakes. Prefer xatlas when WASM loads. */
export async function unwrapUV2ForBake(geometry: THREE.BufferGeometry): Promise<UnwrapUV2Result> {
  const pos = geometry.attributes.position as THREE.BufferAttribute | undefined
  const count = pos?.count ?? 0
  if (!count) return { method: 'failed', vertexCount: 0 }
  if (geometry.attributes.uv2?.count) return { method: 'existing', vertexCount: count }

  if (await ensureXatlas()) {
    // xatlas-web loads but has no stable JS bindings in 0.1.0 — use box until Wave 10 xatlas-three.
    // WASM init success still validates the dependency for future worker integration.
  }

  const ok = generateBoxProjectionUV2(geometry)
  return { method: ok ? 'box' : 'failed', vertexCount: count }
}