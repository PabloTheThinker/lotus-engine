/** Wave 84 (v4.59–v4.63) — cloud save manifest + cross-device copy hint (IndexedDB stub). */

import { getCloudSaveLevelName, listCloudManifestSlots } from './cloudSaveStub'

export const CLOUD_SYNC_MANIFEST_VERSION = 1

export interface CloudSaveManifest {
  version: typeof CLOUD_SYNC_MANIFEST_VERSION
  level: string
  generatedAt: number
  slots: { slot: string; savedAt: number }[]
  crossDeviceHint: string
}

/** Compact token for QR / clipboard — same level required on target device. */
export function buildCrossDeviceHint(level: string, slots: { slot: string; savedAt: number }[]): string {
  const token = `LOTUS-CLOUD-SYNC:v${CLOUD_SYNC_MANIFEST_VERSION}|${level}|${slots
    .map((s) => `${s.slot}@${s.savedAt}`)
    .join(',')}`
  return `Cross-device stub — copy this token to another browser (same level) or encode as QR: ${token}`
}

/** Build manifest listing IndexedDB cloud slots with timestamps + cross-device hint. */
export async function exportCloudSaveManifest(): Promise<CloudSaveManifest> {
  const level = getCloudSaveLevelName()
  const slots = await listCloudManifestSlots()
  return {
    version: CLOUD_SYNC_MANIFEST_VERSION,
    level,
    generatedAt: Date.now(),
    slots,
    crossDeviceHint: buildCrossDeviceHint(level, slots),
  }
}