import * as THREE from 'three'
import { CSS3DObject, CSS3DSprite } from 'three/addons/renderers/CSS3DRenderer.js'
import { Actor, nextActorId } from './Actor'
import type { HudWidget, Widget3DProps } from './types'
import { DEFAULT_WIDGET3D } from './types'

/** Pixels per world unit — 2m widget = 200px element scaled by 1/100. */
export const WIDGET3D_PIXELS_PER_UNIT = 100

export function resolveWidget3DHtml(props: Widget3DProps, hudWidgets: HudWidget[] = []): string {
  if (props.hudWidgetId) {
    const w = hudWidgets.find((h) => h.id === props.hudWidgetId)
    if (w) return hudWidgetToHtml(w)
  }
  return props.html || '<div>Widget</div>'
}

function hudWidgetToHtml(w: HudWidget): string {
  const base = `font:14px system-ui,sans-serif;color:${w.color};`
  if (w.type === 'text') {
    return `<div style="${base}padding:8px 12px;background:#1a1d24aa;border-radius:6px;">${escapeHtml(w.text)}</div>`
  }
  if (w.type === 'bar') {
    const pct = Math.round((w.value ?? 1) * 100)
    return `<div style="${base}width:160px;background:#2a2f38;border-radius:6px;overflow:hidden;height:20px;">
      <div style="width:${pct}%;height:100%;background:${w.color};"></div>
    </div>`
  }
  return `<button style="${base}padding:8px 16px;background:${w.color};color:#fff;border:none;border-radius:6px;cursor:pointer;">${escapeHtml(w.text)}</button>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function widgetPixelSize(props: Widget3DProps): { w: number; h: number } {
  return {
    w: Math.max(32, Math.round(props.width * WIDGET3D_PIXELS_PER_UNIT)),
    h: Math.max(32, Math.round(props.height * WIDGET3D_PIXELS_PER_UNIT)),
  }
}

/** Invisible pick plane for raycasting and transform gizmos. */
export function rebuildWidget3DPickMesh(actor: Actor) {
  const props = actor.widget3DProps
  if (!props) return
  if (actor.mesh) {
    actor.mesh.geometry.dispose()
    const mat = actor.mesh.material
    if (mat instanceof THREE.Material) mat.dispose()
    actor.mesh.removeFromParent()
  }
  const geo = new THREE.PlaneGeometry(props.width, props.height)
  const mat = new THREE.MeshBasicMaterial({
    visible: false,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.userData.actorId = actor.id
  mesh.userData.isWidget3DPick = true
  actor.mesh = mesh
  actor.root.add(mesh)
}

/** Create or refresh the CSS3DObject on an actor (editor / PIE). */
export function syncWidget3D(actor: Actor, hudWidgets: HudWidget[] = []) {
  if (actor.type !== 'Widget3D' || !actor.widget3DProps) return
  const props = actor.widget3DProps
  rebuildWidget3DPickMesh(actor)

  if (actor.css3dObject) {
    actor.css3dObject.removeFromParent()
    actor.css3dObject.element.remove()
    actor.css3dObject = undefined
  }

  const { w, h } = widgetPixelSize(props)
  const el = document.createElement('div')
  el.className = 'vektra-widget3d'
  el.innerHTML = resolveWidget3DHtml(props, hudWidgets)
  el.style.width = `${w}px`
  el.style.height = `${h}px`
  el.style.opacity = String(props.opacity)
  el.style.boxSizing = 'border-box'
  el.style.overflow = 'hidden'
  el.style.pointerEvents = 'auto'

  const obj = props.billboard ? new CSS3DSprite(el) : new CSS3DObject(el)
  const scale = 1 / WIDGET3D_PIXELS_PER_UNIT
  obj.scale.set(scale, scale, scale)
  obj.userData.actorId = actor.id
  obj.userData.isWidget3D = true

  actor.root.add(obj)
  actor.css3dObject = obj
}

export function disposeWidget3D(actor: Actor) {
  if (actor.css3dObject) {
    actor.css3dObject.removeFromParent()
    actor.css3dObject.element.remove()
    actor.css3dObject = undefined
  }
  if (actor.mesh?.userData.isWidget3DPick) {
    actor.mesh.geometry.dispose()
    const mat = actor.mesh.material
    if (mat instanceof THREE.Material) mat.dispose()
    actor.mesh.removeFromParent()
    actor.mesh = undefined
  }
}

/** Rasterize HTML to a canvas for export runtime (CSS3D fallback). */
export function rasterizeWidget3DHtml(
  html: string,
  widthPx: number,
  heightPx: number,
): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = widthPx
    canvas.height = heightPx
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('canvas 2d unavailable'))
      return
    }
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}">
  <foreignObject width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${widthPx}px;height:${heightPx}px;overflow:hidden;box-sizing:border-box;">
      ${html}
    </div>
  </foreignObject>
</svg>`
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    const img = new Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0, widthPx, heightPx)
      resolve(canvas)
    }
    img.onerror = () => {
      ctx.fillStyle = '#1a1d24'
      ctx.fillRect(0, 0, widthPx, heightPx)
      ctx.fillStyle = '#e8eaed'
      ctx.font = '14px system-ui,sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Widget3D', widthPx / 2, heightPx / 2)
      resolve(canvas)
    }
    img.src = url
  })
}

/** Build a canvas-textured plane for export / lightweight runtime. */
export async function rebuildWidget3DFallback(actor: Actor, hudWidgets: HudWidget[] = []) {
  const props = actor.widget3DProps
  if (!props) return
  if (actor.mesh && !actor.mesh.userData.isWidget3DPick) {
    actor.mesh.geometry.dispose()
    const mat = actor.mesh.material
    if (mat instanceof THREE.Material) mat.dispose()
    actor.mesh.removeFromParent()
  }
  const { w, h } = widgetPixelSize(props)
  const html = resolveWidget3DHtml(props, hudWidgets)
  const canvas = await rasterizeWidget3DHtml(html, w, h)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  const geo = new THREE.PlaneGeometry(props.width, props.height)
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: props.opacity < 1,
    opacity: props.opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.userData.actorId = actor.id
  mesh.userData.isWidget3D = true
  actor.mesh = mesh
  actor.root.add(mesh)
}

const _billboardCam = new THREE.Vector3()
const _billboardObj = new THREE.Vector3()
const _billboardParentQ = new THREE.Quaternion()
const _billboardInvParentQ = new THREE.Quaternion()
const _billboardLookM = new THREE.Matrix4()
const _billboardLookQ = new THREE.Quaternion()

/** Face canvas-fallback Widget3D planes toward the camera (export runtime). */
export function updateWidget3DBillboards(camera: THREE.Camera, actors: Iterable<Actor>) {
  camera.getWorldPosition(_billboardCam)
  for (const actor of actors) {
    if (actor.type !== 'Widget3D' || !actor.widget3DProps?.billboard || !actor.mesh) continue
    if (actor.css3dObject) continue
    actor.mesh.getWorldPosition(_billboardObj)
    if (actor.mesh.parent) {
      actor.mesh.parent.getWorldQuaternion(_billboardParentQ)
      _billboardInvParentQ.copy(_billboardParentQ).invert()
    } else {
      _billboardInvParentQ.identity()
    }
    _billboardLookM.lookAt(_billboardObj, _billboardCam, new THREE.Vector3(0, 1, 0))
    _billboardLookQ.setFromRotationMatrix(_billboardLookM)
    actor.mesh.quaternion.copy(_billboardInvParentQ).multiply(_billboardLookQ)
  }
}

/** Widget3D — interactive HTML panel in world space. */
export function createWidget3DActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'Widget3D')
  actor.widget3DProps = { ...DEFAULT_WIDGET3D }
  rebuildWidget3DPickMesh(actor)
  return actor
}