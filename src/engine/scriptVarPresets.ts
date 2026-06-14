/**
 * Wave 40 (v2.39) — AnimationPlayer curve presets for @export script vars.
 * Stored as LotusResource kind: 'curve' in localStorage (.tres lite).
 */

import type { CurveKey } from './curveAssets'
import { createResource, getResource, listResources, saveResource, type LotusResource } from './resources'
import type { SeqKey } from './sequencer'

export interface ScriptVarPresetData extends Record<string, unknown> {
  /** marks this curve resource as a script-var animation preset */
  scriptVarPreset: true
  /** target @export var name (metadata) */
  varName?: string
  /** curve keys — t in seconds, v in var units */
  keys: CurveKey[]
  /** optional duration hint when saved from a sequencer track */
  duration?: number
}

export function isScriptVarPreset(resource: LotusResource): resource is LotusResource<ScriptVarPresetData> {
  if (resource.kind !== 'curve') return false
  const data = resource.data as Partial<ScriptVarPresetData>
  return data.scriptVarPreset === true && Array.isArray(data.keys)
}

export function scriptVarPresetData(resource: LotusResource): ScriptVarPresetData | null {
  if (!isScriptVarPreset(resource)) return null
  return resource.data as ScriptVarPresetData
}

/** List curve resources tagged as script-var presets. */
export function listScriptVarPresets(): LotusResource<ScriptVarPresetData>[] {
  return listResources('curve').filter(isScriptVarPreset) as LotusResource<ScriptVarPresetData>[]
}

/** Save a new preset from curve keys. */
export function saveScriptVarPreset(
  name: string,
  keys: CurveKey[],
  varName?: string,
  duration?: number,
): LotusResource<ScriptVarPresetData> {
  const sorted = [...keys].sort((a, b) => a.t - b.t)
  return createResource(name, 'curve', {
    scriptVarPreset: true,
    varName,
    keys: sorted,
    duration,
  }) as LotusResource<ScriptVarPresetData>
}

/** Load a preset by resource id. */
export function loadScriptVarPreset(id: string): LotusResource<ScriptVarPresetData> | undefined {
  const res = getResource(id)
  if (!res || !isScriptVarPreset(res)) return undefined
  return res as LotusResource<ScriptVarPresetData>
}

/** Update keys on an existing preset resource. */
export function updateScriptVarPreset(
  id: string,
  keys: CurveKey[],
  varName?: string,
  duration?: number,
): LotusResource<ScriptVarPresetData> | undefined {
  const res = loadScriptVarPreset(id)
  if (!res) return undefined
  const sorted = [...keys].sort((a, b) => a.t - b.t)
  const next: LotusResource<ScriptVarPresetData> = {
    ...res,
    data: {
      scriptVarPreset: true,
      varName: varName ?? res.data.varName,
      keys: sorted,
      duration: duration ?? res.data.duration,
    },
  }
  return saveResource(next) as LotusResource<ScriptVarPresetData>
}

/** Convert sequencer keys to curve keys (numeric channels only). */
export function curveKeysFromSeqKeys(keys: SeqKey[]): CurveKey[] {
  return keys
    .filter((k) => typeof k.v === 'number')
    .map((k) => ({ t: k.t, v: k.v as number }))
}

/** Convert a preset to sequencer keys. */
export function seqKeysFromPreset(data: ScriptVarPresetData): SeqKey[] {
  return data.keys.map((k) => ({ t: k.t, v: k.v }))
}

/** Save current script-var track keys as a named preset. */
export function saveScriptVarPresetFromTrack(
  name: string,
  varName: string,
  keys: SeqKey[],
  duration?: number,
): LotusResource<ScriptVarPresetData> {
  return saveScriptVarPreset(name, curveKeysFromSeqKeys(keys), varName, duration)
}