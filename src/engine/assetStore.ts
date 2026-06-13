/**
 * Asset pipeline v2 — IndexedDB blob storage (Wave 10).
 * Level JSON stores asset refs; heavy binaries live in IDB.
 */

const DB_NAME = 'lotus-engine-assets-v1'
const STORE = 'blobs'
const DB_VERSION = 1

export interface AssetBlobMeta {
  id: string
  name: string
  mime: string
  size: number
  /** draco | ktx2 | gltf */
  compression?: string
  importedAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    })
  }
  return dbPromise
}

export async function putAssetBlob(meta: AssetBlobMeta, data: ArrayBuffer): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const payload = { meta, data }
    tx.objectStore(STORE).put(payload, meta.id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IDB put failed'))
  })
}

export async function getAssetBlob(id: string): Promise<{ meta: AssetBlobMeta; data: ArrayBuffer } | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => resolve((req.result as { meta: AssetBlobMeta; data: ArrayBuffer } | undefined) ?? null)
    req.onerror = () => reject(req.error ?? new Error('IDB get failed'))
  })
}

export async function deleteAssetBlob(id: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IDB delete failed'))
  })
}

export async function listAssetBlobs(): Promise<AssetBlobMeta[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => {
      const rows = (req.result as Array<{ meta: AssetBlobMeta }> | undefined) ?? []
      resolve(rows.map((r) => r.meta))
    }
    req.onerror = () => reject(req.error ?? new Error('IDB list failed'))
  })
}