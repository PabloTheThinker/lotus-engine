/** Wave 61 (v3.44–v3.48) — custom autotile PNG atlas import + manual tile mapping. */

import * as THREE from 'three'
import { AUTOTILE_ATLAS_SIZE } from './autotileAtlas'
import { readStorage, writeStorage } from './storage'
import type { FoliageProps } from './types'

const STORE_KEY = 'autotileSheets'

export interface AutotileSheetMeta {
  id: string
  name: string
  dataUrl: string
  cols: number
  rows: number
}

let sheetCounter = 0

export function nextAutotileSheetId(): string {
  sheetCounter += 1
  return `ats_${Date.now().toString(36)}_${sheetCounter}`
}

function readStore(): Record<string, AutotileSheetMeta> {
  try {
    return JSON.parse(readStorage(STORE_KEY) ?? '{}') as Record<string, AutotileSheetMeta>
  } catch {
    return {}
  }
}

function writeStore(store: Record<string, AutotileSheetMeta>): void {
  writeStorage(STORE_KEY, JSON.stringify(store))
}

/** Import a PNG data URL and persist under `lotus-engine.autotileSheets[id]`. */
export function importAtlasSheet(dataUrl: string, name?: string): AutotileSheetMeta {
  const id = nextAutotileSheetId()
  const sheet: AutotileSheetMeta = {
    id,
    name: name?.trim() || `Atlas ${id.slice(-4)}`,
    dataUrl,
    cols: 4,
    rows: 4,
  }
  const store = readStore()
  store[id] = sheet
  writeStore(store)
  return sheet
}

export function listAtlasSheets(): AutotileSheetMeta[] {
  return Object.values(readStore())
}

export function getAtlasSheet(id: string): AutotileSheetMeta | undefined {
  return readStore()[id]
}

export function deleteAtlasSheet(id: string): void {
  const store = readStore()
  delete store[id]
  writeStore(store)
}

/** Load a persisted PNG data URL into a nearest-filtered atlas texture. */
export function createAutotileSheetTexture(dataUrl: string): THREE.Texture {
  const texture = new THREE.Texture()
  const img = new Image()
  img.onload = () => {
    texture.image = img
    texture.needsUpdate = true
  }
  img.src = dataUrl
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  return texture
}

/** Resolve autotile mask index → atlas slot using slot→mask tile map. */
export function atlasSlotForMask(maskIndex: number, tileMap?: Record<number, number>): number {
  const mask = Math.max(0, Math.min(AUTOTILE_ATLAS_SIZE - 1, Math.floor(maskIndex)))
  if (!tileMap) return mask
  for (const [slot, mapped] of Object.entries(tileMap)) {
    if (Math.floor(mapped) === mask) {
      return Math.max(0, Math.min(AUTOTILE_ATLAS_SIZE - 1, Number(slot)))
    }
  }
  return mask
}

export function getTileMap(props: FoliageProps): Record<number, number> {
  return { ...(props.gridAtlasTileMap ?? {}) }
}

export function setTileMap(props: FoliageProps, tileMap: Record<number, number>): void {
  props.gridAtlasTileMap = { ...tileMap }
}

export function setTileMapSlot(props: FoliageProps, slot: number, mask: number): void {
  const s = Math.max(0, Math.min(AUTOTILE_ATLAS_SIZE - 1, Math.floor(slot)))
  const map = getTileMap(props)
  map[s] = Math.max(0, Math.min(AUTOTILE_ATLAS_SIZE - 1, Math.floor(mask)))
  props.gridAtlasTileMap = map
}