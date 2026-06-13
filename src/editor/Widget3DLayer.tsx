import * as THREE from 'three'
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js'
import type { Actor } from '../engine/Actor'
import { disposeWidget3D, syncWidget3D } from '../engine/widget3d'
import type { HudWidget } from '../engine/types'

export interface Widget3DViewportRect {
  screenX: number
  screenY: number
  w: number
  h: number
}

/**
 * CSS3DRenderer overlay synced with the WebGL camera each frame.
 * Standard three.js pattern: DOM overlay + shared scene graph + camera matrix.
 */
export class Widget3DLayer {
  readonly renderer: CSS3DRenderer

  constructor() {
    this.renderer = new CSS3DRenderer()
    const dom = this.renderer.domElement
    dom.className = 'widget3d-layer'
    dom.style.position = 'absolute'
    dom.style.inset = '0'
    dom.style.pointerEvents = 'none'
  }

  attach(mount: HTMLElement) {
    mount.appendChild(this.renderer.domElement)
  }

  setSize(w: number, h: number) {
    this.renderer.setSize(w, h)
  }

  /** Position the overlay for quad-view perspective pane clipping. */
  setViewportRect(rect: Widget3DViewportRect | null) {
    const dom = this.renderer.domElement
    if (!rect) {
      dom.style.left = '0'
      dom.style.top = '0'
      dom.style.width = '100%'
      dom.style.height = '100%'
      return
    }
    dom.style.left = `${rect.screenX}px`
    dom.style.top = `${rect.screenY}px`
    dom.style.width = `${rect.w}px`
    dom.style.height = `${rect.h}px`
  }

  syncAll(actors: Iterable<Actor>, hudWidgets: HudWidget[]) {
    for (const actor of actors) {
      if (actor.type === 'Widget3D') syncWidget3D(actor, hudWidgets)
    }
  }

  removeStale(actors: Iterable<Actor>) {
    const ids = new Set([...actors].filter((a) => a.type === 'Widget3D').map((a) => a.id))
    for (const actor of actors) {
      if (actor.css3dObject && !ids.has(actor.id)) disposeWidget3D(actor)
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer.render(scene, camera)
  }

  dispose() {
    this.renderer.domElement.remove()
  }
}