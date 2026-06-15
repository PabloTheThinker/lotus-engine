/**
 * Wave 93 (v5.04–v5.08) — RPG dialogue trees (Godot Dialogue Manager / VN-lite).
 * JSON resources: nodes with text, choices[], nextId; linear advance when no choices.
 */

import * as THREE from 'three'
import type { Actor } from './Actor'
import { actionJustPressed } from './inputActions'
import { DEFAULT_DIALOGUE_TREES } from './rpgDialogueData'

const STORAGE_KEY = 'lotus-engine.dialogue.trees'
export const DIALOGUE_NPC_TAG = 'DialogueNPC'
export const DIALOGUE_INTERACT_RADIUS = 2.5

export interface DialogueChoice {
  text: string
  nextId: string
}

export interface DialogueNode {
  id: string
  speaker?: string
  text: string
  choices?: DialogueChoice[]
  nextId?: string
}

export interface DialogueTree {
  id: string
  title?: string
  startId: string
  nodes: DialogueNode[]
}

export interface DialogueCatalog {
  trees: Record<string, DialogueTree>
}

export interface DialogueSnapshot {
  treeId: string
  nodeId: string
  node: DialogueNode | null
}

type UiListener = (snap: DialogueSnapshot | null) => void

let catalog: DialogueCatalog = { trees: {} }
let activeTreeId: string | null = null
let activeNodeId: string | null = null
let uiListener: UiListener | null = null

function nodeMap(tree: DialogueTree): Map<string, DialogueNode> {
  return new Map(tree.nodes.map((n) => [n.id, n]))
}

function persistCustomTrees() {
  const custom = Object.values(catalog.trees).filter(
    (t) => !DEFAULT_DIALOGUE_TREES.some((d) => d.id === t.id),
  )
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(custom))
  } catch {
    /* quota */
  }
}

function loadCustomTrees(): DialogueTree[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as DialogueTree[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function rebuildCatalog(extra: DialogueTree[] = []) {
  const trees: Record<string, DialogueTree> = {}
  for (const tree of [...DEFAULT_DIALOGUE_TREES, ...extra]) {
    if (tree?.id) trees[tree.id] = tree
  }
  catalog = { trees }
}

rebuildCatalog(loadCustomTrees())

function getTree(treeId: string): DialogueTree | undefined {
  return catalog.trees[treeId]
}

function getNode(treeId: string, nodeId: string): DialogueNode | null {
  const tree = getTree(treeId)
  if (!tree) return null
  return nodeMap(tree).get(nodeId) ?? null
}

function notifyUi() {
  if (!uiListener) return
  if (!activeTreeId || !activeNodeId) {
    uiListener(null)
    return
  }
  uiListener({
    treeId: activeTreeId,
    nodeId: activeNodeId,
    node: getNode(activeTreeId, activeNodeId),
  })
}

function endDialogue() {
  activeTreeId = null
  activeNodeId = null
  notifyUi()
}

function showNode(treeId: string, nodeId: string): boolean {
  const node = getNode(treeId, nodeId)
  if (!node) {
    endDialogue()
    return false
  }
  activeTreeId = treeId
  activeNodeId = nodeId
  notifyUi()
  return true
}

/** Register or replace a dialogue tree resource. */
export function registerDialogueTree(tree: DialogueTree): DialogueTree {
  catalog.trees[tree.id] = tree
  if (!DEFAULT_DIALOGUE_TREES.some((d) => d.id === tree.id)) persistCustomTrees()
  return tree
}

export function listDialogueTrees(): DialogueTree[] {
  return Object.values(catalog.trees)
}

export function getDialogueCatalog(): DialogueCatalog {
  return { trees: { ...catalog.trees } }
}

/** Payload embedded in RPG pack exports as window.__LOTUS_DIALOGUE__. */
export function buildExportDialoguePayload(): DialogueCatalog {
  return getDialogueCatalog()
}

export function serializeDialogueForExport(catalogPayload: DialogueCatalog): string {
  return JSON.stringify(catalogPayload).replace(/</g, '\\u003c')
}

export function setRpgDialogueUiListener(listener: UiListener | null) {
  uiListener = listener
}

export function resetRpgDialogue() {
  endDialogue()
}

export function isActive(): boolean {
  return activeTreeId !== null && activeNodeId !== null
}

export function getCurrentNode(): DialogueNode | null {
  if (!activeTreeId || !activeNodeId) return null
  return getNode(activeTreeId, activeNodeId)
}

export function getCurrentSnapshot(): DialogueSnapshot | null {
  if (!activeTreeId || !activeNodeId) return null
  return {
    treeId: activeTreeId,
    nodeId: activeNodeId,
    node: getNode(activeTreeId, activeNodeId),
  }
}

/** Begin a dialogue tree by resource id. */
export function startDialogue(treeId: string): boolean {
  const tree = getTree(treeId)
  if (!tree) return false
  return showNode(treeId, tree.startId)
}

/** Advance linear dialogue (ignored when the node has choices). */
export function advance(): boolean {
  if (!activeTreeId || !activeNodeId) return false
  const node = getNode(activeTreeId, activeNodeId)
  if (!node) {
    endDialogue()
    return false
  }
  if (node.choices?.length) return false
  if (node.nextId) return showNode(activeTreeId, node.nextId)
  endDialogue()
  return true
}

/** Pick a branch choice by index. */
export function choose(index: number): boolean {
  if (!activeTreeId || !activeNodeId) return false
  const node = getNode(activeTreeId, activeNodeId)
  const choice = node?.choices?.[index]
  if (!choice) return false
  return showNode(activeTreeId, choice.nextId)
}

function dialogueIdForActor(actor: Actor): string | null {
  const raw = actor.scriptVars?.dialogueId
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return null
}

function actorWorldPosition(actor: Actor, out: THREE.Vector3): THREE.Vector3 {
  return actor.root.getWorldPosition(out)
}

/** Interact (E) near DialogueNPC actors with scriptVar dialogueId. */
export function tickRpgDialogueInteract(
  actors: Iterable<Actor>,
  pawnPos: THREE.Vector3 | null,
  interactJustPressed = actionJustPressed('Interact'),
): void {
  if (!pawnPos) return
  if (isActive()) {
    if (interactJustPressed) advance()
    return
  }
  if (!interactJustPressed) return

  let best: { actor: Actor; distSq: number } | null = null
  const pos = new THREE.Vector3()
  const r2 = DIALOGUE_INTERACT_RADIUS * DIALOGUE_INTERACT_RADIUS

  for (const actor of actors) {
    if (!actor.tags.includes(DIALOGUE_NPC_TAG)) continue
    const treeId = dialogueIdForActor(actor)
    if (!treeId || !getTree(treeId)) continue
    actorWorldPosition(actor, pos)
    const dx = pos.x - pawnPos.x
    const dz = pos.z - pawnPos.z
    const distSq = dx * dx + dz * dz
    if (distSq > r2) continue
    if (!best || distSq < best.distSq) best = { actor, distSq }
  }

  if (best) {
    const treeId = dialogueIdForActor(best.actor)
    if (treeId) startDialogue(treeId)
  }
}