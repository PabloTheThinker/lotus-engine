import { Input } from '../engine/Input'
import { getEffectiveTouchSlot, type TouchSlotId } from '../engine/inputBindings'
import { applyTouchLayoutPreset, type TouchLayoutPreset } from '../engine/touchLayoutPresets'
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
    --lotus-touch-stick-left: 24px;
    --lotus-touch-stick-bottom: 24px;
    --lotus-touch-stick-size: 140px;
    --lotus-touch-actions-right: 28px;
    --lotus-touch-actions-bottom: 36px;
    --lotus-touch-actions-gap: 10px;
    --lotus-touch-btn-size: 72px;
    --lotus-touch-fire-btn-size: 72px;
    position: fixed; inset: 0; pointer-events: none; z-index: 40;
    touch-action: none; user-select: none;
  }
  .lotus-touch-hud > * { pointer-events: auto; }
  .lotus-touch-stick-zone {
    position: absolute;
    left: var(--lotus-touch-stick-left);
    bottom: var(--lotus-touch-stick-bottom);
    width: var(--lotus-touch-stick-size);
    height: var(--lotus-touch-stick-size);
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
    position: absolute;
    right: var(--lotus-touch-actions-right);
    bottom: var(--lotus-touch-actions-bottom);
    display: flex; flex-direction: column; align-items: flex-end;
    gap: var(--lotus-touch-actions-gap);
  }
  .lotus-touch-jump,
  .lotus-touch-interact {
    width: var(--lotus-touch-btn-size); height: var(--lotus-touch-btn-size); border-radius: 50%;
    border: 2px solid rgba(255,255,255,.35);
    color: #fff; font: 600 13px system-ui, sans-serif;
    touch-action: none;
  }
  .lotus-touch-fire {
    width: var(--lotus-touch-fire-btn-size); height: var(--lotus-touch-fire-btn-size); border-radius: 50%;
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
  private slots: Partial<Record<TouchSlotId, TouchActionButton | TouchJumpButton>> = {}

  get mounted(): boolean {
    return !!this.root
  }

  mount(parent: HTMLElement, layoutPreset?: TouchLayoutPreset) {
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
    applyTouchLayoutPreset(hud, layoutPreset)
    const stickZone = document.createElement('div')
    stickZone.className = 'lotus-touch-stick-zone'
    hud.appendChild(stickZone)
    parent.appendChild(hud)
    this.root = hud
    this.joystick = new VirtualJoystick(stickZone, { radius: 56, deadZone: 0.12 })
    const actions = document.createElement('div')
    actions.className = 'lotus-touch-actions'
    hud.appendChild(actions)
    const interact = new TouchActionButton(actions, 'Use', 'lotus-touch-interact')
    const fire = new TouchActionButton(actions, 'Fire', 'lotus-touch-fire')
    const jump = new TouchJumpButton(actions)
    interact.root.dataset.lotusTouchSlot = 'interact-btn'
    fire.root.dataset.lotusTouchSlot = 'fire-btn'
    jump.root.dataset.lotusTouchSlot = 'jump-btn'
    this.slots = {
      'interact-btn': interact,
      'fire-btn': fire,
      'jump-btn': jump,
    }
  }

  unmount() {
    this.joystick?.dispose()
    for (const btn of Object.values(this.slots)) btn?.dispose()
    this.joystick = null
    this.slots = {}
    this.root?.remove()
    this.root = null
    resetTouchInput()
    Input.clearTouchInput()
  }

  tick() {
    if (!this.joystick) return
    const jumpBtn = this.slots[getEffectiveTouchSlot('jump')]
    const fireBtn = this.slots[getEffectiveTouchSlot('fire')]
    const interactBtn = this.slots[getEffectiveTouchSlot('interact')]
    if (!jumpBtn || !fireBtn || !interactBtn) return
    const axis = this.joystick.getAxis()
    const jumpDown = jumpBtn.isDown()
    const jumpJust = jumpBtn.justPressed()
    const fireDown = fireBtn.isDown()
    const fireJust = fireBtn.justPressed()
    const interactDown = interactBtn.isDown()
    const interactJust = interactBtn.justPressed()
    syncTouchInputState(axis, jumpDown, jumpJust, fireDown, fireJust, interactDown, interactJust)
    Input.syncTouchInput(axis, jumpDown, jumpJust, fireDown, fireJust, interactDown, interactJust)
    jumpBtn.endFrame()
    fireBtn.endFrame()
    interactBtn.endFrame()
    endTouchInputFrame()
  }
}

export function touchControlsActive(env: EnvironmentSettings): boolean {
  return shouldShowTouchControls(env.touchControls)
}