import * as THREE from 'three'
import type { Actor } from '../engine/Actor'
import { applyMaterialProps } from '../engine/factory'
import { applyActorMaterial } from '../engine/materialAssets'
import type { MaterialGraph } from '../engine/materialGraph'
import type { MaterialProps } from '../engine/types'
import { world } from '../engine/World'
import { PropertyCommand, runCommand } from './commands'
import { useEditor } from './store'

interface MaterialState {
  materialAssetId?: string
  materialOverrides?: Partial<MaterialProps>
  materialGraph?: MaterialGraph
  materialProps?: MaterialProps
}

function captureMaterialState(actor: Actor): MaterialState {
  return {
    materialAssetId: actor.materialAssetId,
    materialOverrides: actor.materialOverrides ? { ...actor.materialOverrides } : undefined,
    materialGraph: actor.materialGraph ? JSON.parse(JSON.stringify(actor.materialGraph)) : undefined,
    materialProps: actor.materialProps ? { ...actor.materialProps } : undefined,
  }
}

function restoreMaterialState(actor: Actor, state: MaterialState) {
  actor.materialAssetId = state.materialAssetId
  actor.materialOverrides = state.materialOverrides
  actor.materialGraph = state.materialGraph
  if (state.materialAssetId) applyActorMaterial(actor)
  else if (state.materialProps && actor.mesh) {
    actor.materialProps = { ...state.materialProps }
    applyMaterialProps(actor.mesh.material as THREE.MeshStandardMaterial, state.materialProps)
  }
  useEditor.getState().touch()
}

/** Assign a shared material asset to a mesh actor (clears prior overrides). */
export function assignMaterialAsset(actorId: string, materialAssetId: string) {
  const actor = world.actors.get(actorId)
  if (!actor?.mesh) return
  const before = captureMaterialState(actor)
  runCommand(
    new PropertyCommand(
      'Apply material asset',
      () => {
        actor.materialAssetId = materialAssetId
        actor.materialOverrides = undefined
        actor.materialGraph = undefined
        applyActorMaterial(actor)
        useEditor.getState().select(actorId)
        useEditor.getState().touch()
      },
      () => restoreMaterialState(actor, before),
    ),
  )
}

/** Patch per-instance material overrides on an actor that uses a material asset. */
export function patchMaterialOverrides(
  actor: Actor,
  patch: (overrides: Partial<MaterialProps>) => Partial<MaterialProps>,
  label: string,
) {
  const before = captureMaterialState(actor)
  runCommand(
    new PropertyCommand(
      label,
      () => {
        const next = patch(actor.materialOverrides ?? {})
        actor.materialOverrides = Object.keys(next).length ? next : undefined
        applyActorMaterial(actor)
        useEditor.getState().touch()
      },
      () => restoreMaterialState(actor, before),
    ),
  )
}

/** Remove a single override key, reverting that field to the asset default. */
export function revertMaterialOverride(actor: Actor, key: keyof MaterialProps) {
  patchMaterialOverrides(
    actor,
    (overrides) => {
      const next = { ...overrides }
      delete next[key]
      return next
    },
    `Revert ${String(key)}`,
  )
}