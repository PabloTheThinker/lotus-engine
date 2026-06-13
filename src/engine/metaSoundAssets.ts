import type { MetaSoundGraph } from './metaSounds'
import { emptyMetaSoundGraph } from './metaSounds'

/**
 * MetaSound assets — procedural audio graphs stored in localStorage (UE MetaSound analog).
 */

const KEY = 'lotus-engine.metasounds'

export interface MetaSoundAsset {
  id: string
  name: string
  graph: MetaSoundGraph
}

let metaSoundCounter = 0
export function nextMetaSoundId(): string {
  metaSoundCounter += 1
  return `msa_${Date.now().toString(36)}_${metaSoundCounter}`
}

export function listMetaSounds(): MetaSoundAsset[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as MetaSoundAsset[]
  } catch {
    return []
  }
}

function persist(assets: MetaSoundAsset[]) {
  localStorage.setItem(KEY, JSON.stringify(assets))
}

export function getMetaSound(id: string): MetaSoundAsset | undefined {
  return listMetaSounds().find((m) => m.id === id)
}

export function getMetaSoundByName(name: string): MetaSoundAsset | undefined {
  return listMetaSounds().find((m) => m.name === name)
}

export function saveMetaSound(asset: MetaSoundAsset): MetaSoundAsset {
  const assets = listMetaSounds()
  const idx = assets.findIndex((m) => m.id === asset.id)
  if (idx >= 0) assets[idx] = asset
  else assets.push(asset)
  persist(assets)
  return asset
}

export function deleteMetaSound(id: string) {
  persist(listMetaSounds().filter((m) => m.id !== id))
}

export function renameMetaSound(id: string, newName: string): boolean {
  const next = newName.trim()
  if (!next) return false
  const assets = listMetaSounds()
  const asset = assets.find((m) => m.id === id)
  if (!asset || asset.name === next) return false
  if (assets.some((m) => m.id !== id && m.name === next)) return false
  saveMetaSound({ ...asset, name: next })
  return true
}

export function duplicateMetaSound(id: string): MetaSoundAsset | null {
  const asset = getMetaSound(id)
  if (!asset) return null
  const assets = listMetaSounds()
  const base = asset.name.replace(/_Copy\d*$/, '')
  let copyName = `${base}_Copy`
  const names = new Set(assets.map((m) => m.name))
  let n = 2
  while (names.has(copyName)) {
    copyName = `${base}_Copy${n}`
    n += 1
  }
  const dup: MetaSoundAsset = {
    id: nextMetaSoundId(),
    name: copyName,
    graph: JSON.parse(JSON.stringify(asset.graph)),
  }
  saveMetaSound(dup)
  return dup
}

export function createMetaSound(name: string): MetaSoundAsset {
  const asset: MetaSoundAsset = {
    id: nextMetaSoundId(),
    name,
    graph: emptyMetaSoundGraph(),
  }
  saveMetaSound(asset)
  return asset
}