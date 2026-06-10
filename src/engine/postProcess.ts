import * as THREE from 'three'
import type { Actor } from './Actor'
import type { EnvironmentSettings, PostProcessProps } from './types'

export interface BlendedPostSettings {
  bloomEnabled: boolean
  bloomStrength: number
  bloomThreshold: number
  bloomRadius: number
  exposure: number
}

/** Sample post-process overrides from volumes the camera is inside (UE blend stack). */
export function computeBlendedPost(
  cameraPos: THREE.Vector3,
  actors: Iterable<Actor>,
  base: EnvironmentSettings,
): BlendedPostSettings {
  const out: BlendedPostSettings = {
    bloomEnabled: base.bloomEnabled,
    bloomStrength: base.bloomStrength,
    bloomThreshold: base.bloomThreshold,
    bloomRadius: base.bloomRadius,
    exposure: base.exposure,
  }

  const volumes: Array<{ actor: Actor; props: PostProcessProps; weight: number }> = []
  for (const actor of actors) {
    if (actor.type !== 'PostProcessVolume' || !actor.postProcessProps?.enabled) continue
    const props = actor.postProcessProps
    let weight = 1
    if (!props.infiniteExtent) {
      const local = cameraPos.clone()
      actor.root.worldToLocal(local)
      const half = new THREE.Vector3(0.5, 0.5, 0.5).multiply(actor.root.scale)
      const inside =
        Math.abs(local.x) <= half.x && Math.abs(local.y) <= half.y && Math.abs(local.z) <= half.z
      if (!inside) {
        if (props.blendRadius <= 0) continue
        const dx = Math.max(0, Math.abs(local.x) - half.x)
        const dy = Math.max(0, Math.abs(local.y) - half.y)
        const dz = Math.max(0, Math.abs(local.z) - half.z)
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist >= props.blendRadius) continue
        weight = 1 - dist / props.blendRadius
      }
    }
    volumes.push({ actor, props, weight })
  }

  volumes.sort((a, b) => b.props.priority - a.props.priority || b.weight - a.weight)
  if (!volumes.length) return out

  const top = volumes[0]
  const p = top.props
  const w = top.weight
  const lerp = (baseVal: number, override: number | undefined) =>
    override === undefined ? baseVal : baseVal + (override - baseVal) * w

  if (p.bloomEnabled !== undefined) out.bloomEnabled = w >= 0.5 ? p.bloomEnabled : base.bloomEnabled
  out.bloomStrength = lerp(base.bloomStrength, p.bloomStrength)
  out.bloomThreshold = lerp(base.bloomThreshold, p.bloomThreshold)
  out.bloomRadius = lerp(base.bloomRadius, p.bloomRadius)
  out.exposure = lerp(base.exposure, p.exposure)
  return out
}