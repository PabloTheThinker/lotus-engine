import type { Actor } from './Actor'
import type { ScriptApi } from './scripting'
import { scriptLog } from './scripting'

/**
 * GAS-lite — gameplay attributes, abilities, and gameplay effects.
 * Assets persist in localStorage; per-actor runtime state resets each Play.
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

export type EffectModifierOp = 'add' | 'multiply'

export interface EffectModifier {
  attribute: string
  op: EffectModifierOp
  value: number
}

export interface GameplayEffect {
  id: string
  name: string
  /** Duration in seconds; 0 = instant one-shot. Re-applies stack duration. */
  duration: number
  modifiers: EffectModifier[]
  /** Tags added while the effect is active. */
  tagsGranted?: string[]
  /** Tags stripped while the effect is active (restored on expiry). */
  tagsRemoved?: string[]
}

export interface AbilityLibrary {
  attributeSets: AttributeSet[]
  abilities: Ability[]
  effects: GameplayEffect[]
}

const DEFAULT_POISON: GameplayEffect = {
  id: 'effect_poison',
  name: 'Poison',
  duration: 5,
  modifiers: [{ attribute: 'Health', op: 'add', value: -5 }],
  tagsGranted: ['Status.Poisoned'],
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
  effects: [DEFAULT_POISON],
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

let effectCounter = 0
export function nextEffectId(): string {
  effectCounter += 1
  return `effect_${Date.now().toString(36)}_${effectCounter}`
}

export function loadAbilityLibrary(): AbilityLibrary {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as AbilityLibrary | null
    if (!raw || !Array.isArray(raw.attributeSets) || !Array.isArray(raw.abilities)) return { ...DEFAULT_LIBRARY }
    return {
      attributeSets: raw.attributeSets.length ? raw.attributeSets : [...DEFAULT_LIBRARY.attributeSets],
      abilities: raw.abilities,
      effects: Array.isArray(raw.effects) && raw.effects.length ? raw.effects : [...DEFAULT_LIBRARY.effects],
    }
  } catch {
    return {
      ...DEFAULT_LIBRARY,
      attributeSets: [...DEFAULT_LIBRARY.attributeSets],
      abilities: [],
      effects: [...DEFAULT_LIBRARY.effects],
    }
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

export function listEffects(): GameplayEffect[] {
  return loadAbilityLibrary().effects
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

export function getEffect(id: string): GameplayEffect | undefined {
  return listEffects().find((e) => e.id === id)
}

export function getEffectByName(name: string): GameplayEffect | undefined {
  const q = name.toLowerCase()
  return listEffects().find((e) => e.name.toLowerCase() === q || e.id.toLowerCase() === q)
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

export function saveEffect(effect: GameplayEffect): GameplayEffect {
  const lib = loadAbilityLibrary()
  const idx = lib.effects.findIndex((e) => e.id === effect.id)
  if (idx >= 0) lib.effects[idx] = effect
  else lib.effects.push(effect)
  saveAbilityLibrary(lib)
  return effect
}

export function deleteEffect(id: string) {
  const lib = loadAbilityLibrary()
  lib.effects = lib.effects.filter((e) => e.id !== id)
  saveAbilityLibrary(lib)
}

// ---- per-play-session runtime state ----

export interface ActiveEffectInfo {
  effectId: string
  name: string
  remaining: number
}

interface ActiveEffectInstance {
  effectId: string
  expiresAt: number
}

interface ActorGASState {
  attributes: Record<string, number>
  cooldowns: Record<string, number>
  activeEffects: ActiveEffectInstance[]
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

function ensureActorGAS(actor: Actor): ActorGASState | null {
  let state = actorStates.get(actor)
  if (state) return state
  if (!actor.attributeSetId) return null
  initActorGAS(actor)
  return actorStates.get(actor) ?? null
}

export function initActorGAS(actor: Actor) {
  if (!actor.attributeSetId) return
  const set = getAttributeSet(actor.attributeSetId)
  if (!set) return
  actorStates.set(actor, {
    attributes: { ...set.attributes },
    cooldowns: {},
    activeEffects: [],
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

// ---- gameplay effects ----

function resolveEffect(effectId: string): GameplayEffect | undefined {
  return getEffect(effectId) ?? getEffectByName(effectId)
}

function addTags(actor: Actor, tags: string[]) {
  for (const tag of tags) {
    if (!actor.tags.includes(tag)) actor.tags.push(tag)
  }
}

function removeTags(actor: Actor, tags: string[]) {
  if (!tags.length) return
  const drop = new Set(tags.map((t) => t.toLowerCase()))
  actor.tags = actor.tags.filter((t) => !drop.has(t.toLowerCase()))
}

function applyMultiplyModifiers(state: ActorGASState, modifiers: EffectModifier[], invert = false) {
  for (const mod of modifiers) {
    if (mod.op !== 'multiply') continue
    const cur = state.attributes[mod.attribute] ?? 0
    state.attributes[mod.attribute] = invert
      ? mod.value !== 0
        ? cur / mod.value
        : cur
      : cur * mod.value
  }
}

function applyAddModifiers(state: ActorGASState, modifiers: EffectModifier[], dt: number) {
  for (const mod of modifiers) {
    if (mod.op !== 'add') continue
    state.attributes[mod.attribute] = (state.attributes[mod.attribute] ?? 0) + mod.value * dt
  }
}

function applyInstantModifiers(state: ActorGASState, modifiers: EffectModifier[]) {
  for (const mod of modifiers) {
    if (mod.op === 'add') {
      state.attributes[mod.attribute] = (state.attributes[mod.attribute] ?? 0) + mod.value
    } else {
      const cur = state.attributes[mod.attribute] ?? 0
      state.attributes[mod.attribute] = cur * mod.value
    }
  }
}

function startEffectInstance(actor: Actor, state: ActorGASState, effect: GameplayEffect, expiresAt: number) {
  applyMultiplyModifiers(state, effect.modifiers)
  if (effect.tagsGranted?.length) addTags(actor, effect.tagsGranted)
  if (effect.tagsRemoved?.length) removeTags(actor, effect.tagsRemoved)
  state.activeEffects.push({ effectId: effect.id, expiresAt })
}

function endEffectInstance(actor: Actor, state: ActorGASState, effect: GameplayEffect) {
  applyMultiplyModifiers(state, effect.modifiers, true)
  if (effect.tagsGranted?.length) removeTags(actor, effect.tagsGranted)
  if (effect.tagsRemoved?.length) addTags(actor, effect.tagsRemoved)
}

export function applyEffect(actor: Actor, effectId: string): boolean {
  const effect = resolveEffect(effectId)
  if (!effect) {
    scriptLog('error', `applyEffect: unknown effect "${effectId}"`)
    return false
  }

  const hasAttrMods = effect.modifiers.length > 0
  const state = hasAttrMods ? ensureActorGAS(actor) : actorStates.get(actor)
  if (hasAttrMods && !state) {
    scriptLog('error', `applyEffect: ${actor.name} has no AttributeSet`)
    return false
  }

  if (effect.duration <= 0) {
    if (state && effect.modifiers.length) applyInstantModifiers(state, effect.modifiers)
    if (effect.tagsGranted?.length) addTags(actor, effect.tagsGranted)
    if (effect.tagsRemoved?.length) removeTags(actor, effect.tagsRemoved)
    return true
  }

  const gas = state ?? {
    attributes: {},
    cooldowns: {},
    activeEffects: [] as ActiveEffectInstance[],
  }
  if (!state) actorStates.set(actor, gas)

  const existing = gas.activeEffects.find((e) => e.effectId === effect.id)
  if (existing) {
    existing.expiresAt = Math.max(existing.expiresAt, playClock) + effect.duration
    return true
  }

  startEffectInstance(actor, gas, effect, playClock + effect.duration)
  return true
}

export function removeEffect(actor: Actor, effectId: string): boolean {
  const effect = resolveEffect(effectId)
  if (!effect) {
    scriptLog('error', `removeEffect: unknown effect "${effectId}"`)
    return false
  }

  const state = actorStates.get(actor)
  if (!state) return false

  const before = state.activeEffects.length
  state.activeEffects = state.activeEffects.filter((inst) => {
    if (inst.effectId !== effect.id) return true
    endEffectInstance(actor, state, effect)
    return false
  })
  return state.activeEffects.length < before
}

export function getActorActiveEffects(actor: Actor): ActiveEffectInfo[] {
  const state = actorStates.get(actor)
  if (!state?.activeEffects.length) return []
  return state.activeEffects
    .map((inst) => {
      const effect = getEffect(inst.effectId)
      return {
        effectId: inst.effectId,
        name: effect?.name ?? inst.effectId,
        remaining: Math.max(0, inst.expiresAt - playClock),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function tickEffects(actors: Iterable<Actor>, dt: number) {
  for (const actor of actors) {
    const state = actorStates.get(actor)
    if (!state?.activeEffects.length) continue

    for (const inst of state.activeEffects) {
      const effect = getEffect(inst.effectId)
      if (effect?.modifiers.length) applyAddModifiers(state, effect.modifiers, dt)
    }

    const expired = state.activeEffects.filter((inst) => playClock >= inst.expiresAt)
    if (!expired.length) continue

    state.activeEffects = state.activeEffects.filter((inst) => playClock < inst.expiresAt)
    for (const inst of expired) {
      const effect = getEffect(inst.effectId)
      if (effect) endEffectInstance(actor, state, effect)
    }
  }
}