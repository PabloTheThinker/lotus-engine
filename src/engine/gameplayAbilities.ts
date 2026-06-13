import type { Actor } from './Actor'
import type { ScriptApi } from './scripting'
import { scriptLog } from './scripting'

/**
 * GAS-lite — gameplay attributes + abilities with cost, cooldown, and tags.
 * Ability assets persist in localStorage; per-actor runtime state resets each Play.
 */

const KEY = 'vektra-engine.abilities'

export interface AttributeSet {
  id: string
  name: string
  /** Named float attributes (Health, Mana, Stamina, …). */
  attributes: Record<string, number>
}

export interface Ability {
  id: string
  name: string
  costAttribute?: string
  costAmount?: number
  cooldownSeconds: number
  /** Actor must have all tags (hierarchical gameplay tag match). */
  tagsRequired?: string[]
  /** Activation blocked when actor has any of these tags. */
  tagsBlocked?: string[]
  /** JavaScript body — onActivate(api, actor) { … } */
  onActivate: string
}

export interface AbilityLibrary {
  attributeSets: AttributeSet[]
  abilities: Ability[]
}

const DEFAULT_LIBRARY: AbilityLibrary = {
  attributeSets: [
    {
      id: 'default',
      name: 'Default',
      attributes: { Health: 100, Mana: 50, Stamina: 100 },
    },
  ],
  abilities: [],
}

let abilityCounter = 0
export function nextAbilityId(): string {
  abilityCounter += 1
  return `abil_${Date.now().toString(36)}_${abilityCounter}`
}

let attrSetCounter = 0
export function nextAttributeSetId(): string {
  attrSetCounter += 1
  return `attr_${Date.now().toString(36)}_${attrSetCounter}`
}

export function loadAbilityLibrary(): AbilityLibrary {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as AbilityLibrary | null
    if (!raw || !Array.isArray(raw.attributeSets) || !Array.isArray(raw.abilities)) return { ...DEFAULT_LIBRARY }
    return {
      attributeSets: raw.attributeSets.length ? raw.attributeSets : [...DEFAULT_LIBRARY.attributeSets],
      abilities: raw.abilities,
    }
  } catch {
    return { ...DEFAULT_LIBRARY, attributeSets: [...DEFAULT_LIBRARY.attributeSets], abilities: [] }
  }
}

export function saveAbilityLibrary(lib: AbilityLibrary) {
  localStorage.setItem(KEY, JSON.stringify(lib))
}

export function listAttributeSets(): AttributeSet[] {
  return loadAbilityLibrary().attributeSets
}

export function listAbilities(): Ability[] {
  return loadAbilityLibrary().abilities
}

export function getAttributeSet(id: string): AttributeSet | undefined {
  return listAttributeSets().find((s) => s.id === id)
}

export function getAbility(id: string): Ability | undefined {
  return listAbilities().find((a) => a.id === id)
}

export function getAbilityByName(name: string): Ability | undefined {
  const q = name.toLowerCase()
  return listAbilities().find((a) => a.name.toLowerCase() === q || a.id.toLowerCase() === q)
}

export function saveAttributeSet(set: AttributeSet): AttributeSet {
  const lib = loadAbilityLibrary()
  const idx = lib.attributeSets.findIndex((s) => s.id === set.id)
  if (idx >= 0) lib.attributeSets[idx] = set
  else lib.attributeSets.push(set)
  saveAbilityLibrary(lib)
  return set
}

export function saveAbility(ability: Ability): Ability {
  const lib = loadAbilityLibrary()
  const idx = lib.abilities.findIndex((a) => a.id === ability.id)
  if (idx >= 0) lib.abilities[idx] = ability
  else lib.abilities.push(ability)
  saveAbilityLibrary(lib)
  return ability
}

export function deleteAbility(id: string) {
  const lib = loadAbilityLibrary()
  lib.abilities = lib.abilities.filter((a) => a.id !== id)
  saveAbilityLibrary(lib)
}

export function deleteAttributeSet(id: string) {
  const lib = loadAbilityLibrary()
  lib.attributeSets = lib.attributeSets.filter((s) => s.id !== id)
  saveAbilityLibrary(lib)
}

// ---- per-play-session runtime state ----

interface ActorGASState {
  attributes: Record<string, number>
  cooldowns: Record<string, number>
}

const actorStates = new WeakMap<Actor, ActorGASState>()
let playClock = 0

export function resetAbilities() {
  playClock = 0
}

export function setAbilityPlayClock(t: number) {
  playClock = t
}

function actorHasTag(actor: Actor, tag: string): boolean {
  const q = tag.toLowerCase()
  return actor.tags.some((t) => {
    const tl = t.toLowerCase()
    return tl === q || tl.startsWith(q + '.')
  })
}

function actorHasRequiredTags(actor: Actor, required: string[]): boolean {
  return required.every((t) => actorHasTag(actor, t))
}

function actorBlockedByTags(actor: Actor, blocked: string[]): boolean {
  return blocked.some((t) => actorHasTag(actor, t))
}

export function initActorGAS(actor: Actor) {
  if (!actor.attributeSetId) return
  const set = getAttributeSet(actor.attributeSetId)
  if (!set) return
  actorStates.set(actor, {
    attributes: { ...set.attributes },
    cooldowns: {},
  })
}

export function initAllActorGAS(actors: Iterable<Actor>) {
  for (const a of actors) initActorGAS(a)
}

export function getAttribute(actor: Actor, name: string): number | null {
  const state = actorStates.get(actor)
  if (!state) return null
  return state.attributes[name] ?? null
}

export function setAttribute(actor: Actor, name: string, value: number): boolean {
  let state = actorStates.get(actor)
  if (!state && actor.attributeSetId) initActorGAS(actor)
  state = actorStates.get(actor)
  if (!state) return false
  state.attributes[name] = value
  return true
}

export function getActorAttributes(actor: Actor): Record<string, number> | null {
  const state = actorStates.get(actor)
  return state ? { ...state.attributes } : null
}

function resolveAbility(abilityId: string): Ability | undefined {
  return getAbility(abilityId) ?? getAbilityByName(abilityId)
}

export function activateAbility(actor: Actor, abilityId: string, api: ScriptApi): boolean {
  const ability = resolveAbility(abilityId)
  if (!ability) {
    scriptLog('error', `activateAbility: unknown ability "${abilityId}"`)
    return false
  }

  if (!actor.abilityIds?.includes(ability.id)) {
    scriptLog('error', `activateAbility: "${ability.name}" not assigned to ${actor.name}`)
    return false
  }

  let state = actorStates.get(actor)
  if (!state && actor.attributeSetId) initActorGAS(actor)
  state = actorStates.get(actor)
  if (!state) {
    scriptLog('error', `activateAbility: ${actor.name} has no AttributeSet`)
    return false
  }

  const readyAt = state.cooldowns[ability.id] ?? 0
  if (playClock < readyAt) return false

  if (ability.tagsRequired?.length && !actorHasRequiredTags(actor, ability.tagsRequired)) return false
  if (ability.tagsBlocked?.length && actorBlockedByTags(actor, ability.tagsBlocked)) return false

  if (ability.costAttribute && ability.costAmount !== undefined && ability.costAmount > 0) {
    const current = state.attributes[ability.costAttribute] ?? 0
    if (current < ability.costAmount) return false
    state.attributes[ability.costAttribute] = current - ability.costAmount
  }

  if (ability.onActivate.trim()) {
    try {
      const fn = new Function(
        'actor',
        'api',
        `"use strict";\n${ability.onActivate}\nif (typeof onActivate === 'function') onActivate(api, actor);`,
      )
      fn(actor, api)
    } catch (err) {
      scriptLog('error', `ability "${ability.name}": ${(err as Error).message}`)
      return false
    }
  }

  if (ability.cooldownSeconds > 0) {
    state.cooldowns[ability.id] = playClock + ability.cooldownSeconds
  }

  return true
}