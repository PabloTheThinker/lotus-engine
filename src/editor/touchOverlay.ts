import { Input } from '../engine/Input'
import type { EnvironmentSettings } from '../engine/types'
import {
  endTouchInputFrame,
  resetTouchInput,
  shouldShowTouchControls,
  syncTouchInputState,
  TouchActionButton,
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
  .lotus-touch-actions {
    position: absolute; right: 28px; bottom: 36px;
    display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
  }
  .lotus-touch-jump,
  .lotus-touch-fire,
  .lotus-touch-interact {
    width: 72px; height: 72px; border-radius: 50%;
    border: 2px solid rgba(255,255,255,.35);
    color: #fff; font: 600 13px system-ui, sans-serif;
    touch-action: none;
  }
  .lotus-touch-jump { background: rgba(47,128,237,.45); }
  .lotus-touch-jump:active { background: rgba(47,128,237,.7); }
  .lotus-touch-fire { background: rgba(235,87,87,.45); }
  .lotus-touch-fire:active { background: rgba(235,87,87,.75); }
  .lotus-touch-interact { background: rgba(39,174,96,.45); }
  .lotus-touch-interact:active { background: rgba(39,174,96,.75); }
`

/**
 * Editor PIE touch overlay — left stick + jump / fire / interact buttons.
 * Mounted when playing and touchControls is enabled (or auto on touch hardware).
 */
export class TouchOverlay {
  private root: HTMLElement | null = null
  private joystick: VirtualJoystick | null = null
  private jump: TouchJumpButton | null = null
  private fire: TouchActionButton | null = null
  private interact: TouchActionButton | null = null

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
    const actions = document.createElement('div')
    actions.className = 'lotus-touch-actions'
    hud.appendChild(actions)
    this.interact = new TouchActionButton(actions, 'Use', 'lotus-touch-interact')
    this.fire = new TouchActionButton(actions, 'Fire', 'lotus-touch-fire')
    this.jump = new TouchJumpButton(actions)
  }

  unmount() {
    this.joystick?.dispose()
    this.jump?.dispose()
    this.fire?.dispose()
    this.interact?.dispose()
    this.joystick = null
    this.jump = null
    this.fire = null
    this.interact = null
    this.root?.remove()
    this.root = null
    resetTouchInput()
    Input.clearTouchInput()
  }

  tick() {
    if (!this.joystick || !this.jump || !this.fire || !this.interact) return
    const axis = this.joystick.getAxis()
    const jumpDown = this.jump.isDown()
    const jumpJust = this.jump.justPressed()
    const fireDown = this.fire.isDown()
    const fireJust = this.fire.justPressed()
    const interactDown = this.interact.isDown()
    const interactJust = this.interact.justPressed()
    syncTouchInputState(axis, jumpDown, jumpJust, fireDown, fireJust, interactDown, interactJust)
    Input.syncTouchInput(axis, jumpDown, jumpJust, fireDown, fireJust, interactDown, interactJust)
    this.jump.endFrame()
    this.fire.endFrame()
    this.interact.endFrame()
    endTouchInputFrame()
  }
}

export function touchControlsActive(env: EnvironmentSettings): boolean {
  return shouldShowTouchControls(env.touchControls)
}