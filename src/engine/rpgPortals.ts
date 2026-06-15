/** Wave 98 (v5.29–v5.33) — RPG scene portals via TriggerVolume enter:Portal_* → changeScene.
 *  Wave 103 (v5.54–v5.58) — loading label overlay during portal changeScene. */

import type { Actor } from './Actor'
import { hidePortalLoading, portalLabelForTarget, resetPortalTransitions, showPortalLoading } from './rpgPortalTransitions'
import type { ScriptApi } from './scripting'
import type { SerializedActor } from './types'

export const PORTAL_INTERIOR_TAG = 'portal_interior'
export const PORTAL_OVERWORLD_TAG = 'portal_overworld'
export const RPG_OVERWORLD_LEVEL_KEY = 'overworld'
export const RPG_INTERIOR_LEVEL_KEY = 'interior'

export interface RpgPortalDef {
  triggerName: string
  targetLevel: string
  tag: string
}

type PortalActorLike = Pick<Actor, 'name' | 'type' | 'tags' | 'scriptVars'> | SerializedActor

const portalRegistry = new Map<string, RpgPortalDef>()
let wiredSignals = new Set<string>()
let transitioning = false

function portalTag(actor: PortalActorLike): string | null {
  const tags = actor.tags ?? []
  if (tags.includes(PORTAL_INTERIOR_TAG)) return PORTAL_INTERIOR_TAG
  if (tags.includes(PORTAL_OVERWORLD_TAG)) return PORTAL_OVERWORLD_TAG
  return null
}

function defaultTargetForTag(tag: string): string {
  if (tag === PORTAL_INTERIOR_TAG) return RPG_INTERIOR_LEVEL_KEY
  if (tag === PORTAL_OVERWORLD_TAG) return RPG_OVERWORLD_LEVEL_KEY
  return RPG_INTERIOR_LEVEL_KEY
}

function targetFromActor(actor: PortalActorLike, tag: string | null): string | null {
  const raw = actor.scriptVars?.targetLevel
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  if (tag) return defaultTargetForTag(tag)
  if (/^Portal_/i.test(actor.name)) return RPG_INTERIOR_LEVEL_KEY
  return null
}

/** Discover portal triggers from live actors or serialized snapshots. */
export function discoverPortalsFromActors(actors: Iterable<PortalActorLike>): RpgPortalDef[] {
  const found: RpgPortalDef[] = []
  for (const actor of actors) {
    if (actor.type !== 'TriggerVolume') continue
    const tag = portalTag(actor)
    const namedPortal = /^Portal_/i.test(actor.name)
    if (!tag && !namedPortal) continue
    const targetLevel = targetFromActor(actor, tag)
    if (!targetLevel) continue
    found.push({
      triggerName: actor.name,
      targetLevel,
      tag: tag ?? (namedPortal ? 'portal_named' : 'portal_unknown'),
    })
  }
  return found
}

export function registerRpgPortal(def: RpgPortalDef): void {
  const triggerName = String(def.triggerName ?? '').trim()
  const targetLevel = String(def.targetLevel ?? '').trim()
  if (!triggerName || !targetLevel) return
  portalRegistry.set(triggerName, {
    triggerName,
    targetLevel,
    tag: def.tag ?? 'portal_custom',
  })
}

export function listRpgPortals(): RpgPortalDef[] {
  return [...portalRegistry.values()]
}

export function getRpgPortalTarget(triggerName: string): string | null {
  return portalRegistry.get(triggerName)?.targetLevel ?? null
}

export function resetRpgPortals(): void {
  portalRegistry.clear()
  wiredSignals.clear()
  transitioning = false
  resetPortalTransitions()
}

/**
 * Wire `enter:Portal_*` handlers — calls api.changeScene (fade handled by loadLevel).
 * Returns the number of portal triggers wired.
 */
export function wireRpgPortals(
  api: Pick<ScriptApi, 'on' | 'changeScene' | 'log'>,
  actors: Iterable<PortalActorLike>,
): number {
  for (const def of discoverPortalsFromActors(actors)) registerRpgPortal(def)

  let wired = 0
  for (const def of portalRegistry.values()) {
    const signal = `enter:${def.triggerName}`
    if (wiredSignals.has(signal)) continue
    wiredSignals.add(signal)
    api.on(signal, () => {
      if (transitioning) return
      transitioning = true
      showPortalLoading(portalLabelForTarget(def.targetLevel))
      api.log(`Portal → ${def.targetLevel}`)
      void Promise.resolve(api.changeScene(def.targetLevel)).finally(() => {
        hidePortalLoading()
        transitioning = false
      })
    })
    wired++
  }
  return wired
}