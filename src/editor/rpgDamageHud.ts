/**
 * Wave 106 (v5.69–v5.73) — Screen-space damage number floaters wired into rpg3dHud during Play.
 */

import * as THREE from 'three'
import { listDamageNumbers, type DamageNumberEvent } from '../engine/rpgCombatPolish'

export const RPG_DAMAGE_LAYER_ID = 'lotus-rpg-damage-layer'

export const RPG_DAMAGE_HUD_CSS = `
  #${RPG_DAMAGE_LAYER_ID} {
    position: fixed; inset: 0; z-index: 23; pointer-events: none; overflow: hidden;
  }
  .lotus-rpg-damage-num {
    position: absolute; left: 0; top: 0; transform: translate(-50%, -50%);
    font: 800 15px system-ui, sans-serif; color: #ff6b7a;
    text-shadow: 0 1px 3px rgba(0,0,0,.85), 0 0 8px rgba(255,80,100,.35);
    white-space: nowrap; will-change: transform, opacity;
    transition: opacity 0.15s ease-out;
  }
  .lotus-rpg-damage-num.crit {
    color: #ffd166; font-size: 18px;
    text-shadow: 0 1px 4px rgba(0,0,0,.9), 0 0 12px rgba(255,200,80,.5);
  }
`

const _proj = new THREE.Vector3()
const activeNodes = new Map<number, HTMLSpanElement>()

function ensureDamageLayer(parent?: HTMLElement): HTMLElement {
  const host = parent ?? document.body
  let layer = host.querySelector<HTMLElement>(`#${RPG_DAMAGE_LAYER_ID}`)
  if (!layer) {
    layer = document.createElement('div')
    layer.id = RPG_DAMAGE_LAYER_ID
    host.appendChild(layer)
  }
  return layer
}

function projectToScreen(
  camera: THREE.Camera,
  worldX: number,
  worldY: number,
  worldZ: number,
  width: number,
  height: number,
): { x: number; y: number; visible: boolean } {
  _proj.set(worldX, worldY, worldZ)
  _proj.project(camera)
  if (_proj.z > 1) return { x: 0, y: 0, visible: false }
  return {
    x: (_proj.x * 0.5 + 0.5) * width,
    y: (-_proj.y * 0.5 + 0.5) * height,
    visible: true,
  }
}

function floatOffset(at: number, now: number): number {
  const age = (now - at) / 1000
  return -age * 42
}

function opacityFor(at: number, now: number): number {
  const age = now - at
  if (age < 200) return 1
  if (age > 1200) return 0
  return 1 - (age - 200) / 1000
}

function upsertNode(layer: HTMLElement, evt: DamageNumberEvent): HTMLSpanElement {
  let node = activeNodes.get(evt.id)
  if (!node) {
    node = document.createElement('span')
    node.className = 'lotus-rpg-damage-num' + (evt.crit ? ' crit' : '')
    node.textContent = String(evt.amount)
    layer.appendChild(node)
    activeNodes.set(evt.id, node)
  }
  return node
}

/** Project queued combat damage numbers to screen-space floaters (call each frame during Play). */
export function tickRpgDamageHud(
  camera: THREE.Camera,
  width: number,
  height: number,
  now = performance.now(),
  parent?: HTMLElement,
): number {
  const layer = ensureDamageLayer(parent)
  const events = listDamageNumbers(now)
  const liveIds = new Set(events.map((e) => e.id))
  for (const [id, node] of activeNodes) {
    if (!liveIds.has(id)) {
      node.remove()
      activeNodes.delete(id)
    }
  }
  for (const evt of events) {
    const screen = projectToScreen(camera, evt.worldX, evt.worldY, evt.worldZ, width, height)
    const node = upsertNode(layer, evt)
    if (!screen.visible) {
      node.style.opacity = '0'
      continue
    }
    const rise = floatOffset(evt.at, now)
    node.style.left = `${screen.x}px`
    node.style.top = `${screen.y + rise}px`
    node.style.opacity = String(opacityFor(evt.at, now))
  }
  return events.length
}

/** Editor / smoke-test helper — render damage floaters at fixed screen positions. */
export function previewRpgDamageHud(
  events: Array<{ amount: number; x: number; y: number; crit?: boolean }>,
  parent?: HTMLElement,
): number {
  const layer = ensureDamageLayer(parent)
  layer.innerHTML = ''
  activeNodes.clear()
  for (const evt of events) {
    const node = document.createElement('span')
    node.className = 'lotus-rpg-damage-num' + (evt.crit ? ' crit' : '')
    node.textContent = String(evt.amount)
    node.style.left = `${evt.x}px`
    node.style.top = `${evt.y}px`
    layer.appendChild(node)
  }
  return events.length
}

export function clearRpgDamageHud(parent?: HTMLElement): void {
  const host = parent ?? document.body
  host.querySelector(`#${RPG_DAMAGE_LAYER_ID}`)?.remove()
  activeNodes.clear()
}