import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { putAssetBlob, getAssetBlob, type AssetBlobMeta } from './assetStore'

/**
 * Asset pipeline v2 — DRACO + KTX2 aware GLTF import with IndexedDB sidecars.
 */

let sharedGltf: GLTFLoader | null = null
let draco: DRACOLoader | null = null
let ktx2: KTX2Loader | null = null

export function configureAssetLoaders(renderer: THREE.WebGLRenderer): GLTFLoader {
  if (!sharedGltf) {
    sharedGltf = new GLTFLoader()
    draco = new DRACOLoader()
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/')
    sharedGltf.setDRACOLoader(draco)
    ktx2 = new KTX2Loader()
    ktx2.setTranscoderPath('https://www.gstatic.com/basis-universal/versioned/2021-04-15-ba1e3d4/')
    ktx2.detectSupport(renderer)
    sharedGltf.setKTX2Loader(ktx2)
  } else if (ktx2) {
    ktx2.detectSupport(renderer)
  }
  return sharedGltf
}

export async function importGltfToStore(
  name: string,
  file: ArrayBuffer,
  mime = 'model/gltf-binary',
): Promise<{ id: string; gltf: Awaited<ReturnType<GLTFLoader['parseAsync']>> }> {
  const id = `blob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  const meta: AssetBlobMeta = {
    id,
    name,
    mime,
    size: file.byteLength,
    importedAt: Date.now(),
  }
  await putAssetBlob(meta, file)
  const loader = sharedGltf ?? new GLTFLoader()
  const gltf = await loader.parseAsync(file, '')
  return { id, gltf }
}

export async function loadGltfFromStore(
  id: string,
  renderer?: THREE.WebGLRenderer,
): Promise<Awaited<ReturnType<GLTFLoader['parseAsync']>> | null> {
  const row = await getAssetBlob(id)
  if (!row) return null
  const loader = renderer ? configureAssetLoaders(renderer) : sharedGltf ?? new GLTFLoader()
  return loader.parseAsync(row.data, '')
}

/** Base64 inline fallback for level export when IDB unavailable. */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}