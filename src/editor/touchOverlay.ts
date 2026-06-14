import { Input } from '../engine/Input'
import type { EnvironmentSettings } from '../engine/types'
import {
  endTouchInputFrame,
  resetTouchInput,
  shouldShowTouchControls,
  syncTouchInputState,
  TouchJumpButton,
  VirtualJoystick,
} from '../engine/touchInput'

/** Touch HUD CSS — shared by editor PIE overlay and export HTML. */
export const TOUCH_OVERLAY_CSS = `
  .lotus-touch-hud {
    position: fixed; inset: 0; pointer-events: none; z-index: 40;
    touch-action: none; user-select: none;
  }
  .lotus-touch-hud > * { pointer-events: auto; }
  .lotus-touch-stick-zone {
    position: absolute; left: 24px; bottom: 24px;
    width: 140px; height: 140px;
  }
  .lotus-touch-joystick {
    position: relative; border-radius: 50%;
    background: rgba(255,255,255,.08);
    border: 2px solid rgba(255,255,255,.18);
    touch-action: none;
  }
  .lotus-touch-joystick-knob {
    position: absolute; left: 50%; top: 50%;
    width: 44%; height: 44%; border-radius: 50%;
    background: rgba(255,255,255,.35);
    border: 2px solid rgba(255,255,255,.5);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .lotus-touch-jump {
    position: absolute; right: 28px; bottom: 36px;
    width: 72px; height: 72px; border-radius: 50%;
    border: 2px solid rgba(255,255,255,.35);
    background: rgba(47,128,237,.45); color: #fff;
    font: 600 13px system-ui, sans-serif;
    touch-action: none;
  }
  .lotus-touch-jump:active { background: rgba(47,128,237,.7); }
`

/**
 * Editor PIE touch overlay — left stick + jump button.
 * Mounted when playing and touchControls is enabled (or auto on touch hardware).
 */
export class TouchOverlay {
  private root: HTMLElement | null = null
  private joystick: VirtualJoystick | null = null
  private jump: TouchJumpButton | null = null

  get mounted(): boolean {
    return !!this.root
  }

  mount(parent: HTMLElement) {
    if (this.root) return
    if (!document.getElementById('lotus-touch-style')) {
      const style = document.createElement('style')
      style.id = 'lotus-touch-style'
      style.textContent = TOUCH_OVERLAY_CSS
      document.head.appendChild(style)
    }
    const hud = document.createElement('div')
    hud.className = 'lotus-touch-hud'
    hud.id = 'lotus-touch-hud'
    const stickZone = document.createElement('div')
    stickZone.className = 'lotus-touch-stick-zone'
    hud.appendChild(stickZone)
    parent.appendChild(hud)
    this.root = hud
    this.joystick = new VirtualJoystick(stickZone, { radius: 56, deadZone: 0.12 })
    this.jump = new TouchJumpButton(hud)
  }

  unmount() {
    this.joystick?.dispose()
    this.jump?.dispose()
    this.joystick = null
    this.jump = null
    this.root?.remove()
    this.root = null
    resetTouchInput()
    Input.clearTouchInput()
  }

  tick() {
    if (!this.joystick || !this.jump) return
    const axis = this.joystick.getAxis()
    const jumpDown = this.jump.isDown()
    const jumpJust = this.jump.justPressed()
    syncTouchInputState(axis, jumpDown, jumpJust)
    Input.syncTouchInput(axis, jumpDown, jumpJust)
    this.jump.endFrame()
    endTouchInputFrame()
  }
}

export function touchControlsActive(env: EnvironmentSettings): boolean {
  return shouldShowTouchControls(env.touchControls)
}