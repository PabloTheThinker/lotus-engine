/**
 * Input — global key state for gameplay scripts and pawn controllers
 * (the UInput / Godot Input singleton analog).
 */
class InputSystem {
  private keys = new Set<string>()
  private pressedThisFrame = new Set<string>()
  private downAt = new Map<string, number>()
  /** Wave 39 — virtual stick axes injected as MoveForward / MoveRight key equivalents */
  private touchMove = { x: 0, y: 0 }
  private touchJump = false
  private touchFire = false
  private touchInteract = false
  /** Wave 44 — gamepad axes/buttons share the same injection path */
  private gamepadMove = { x: 0, y: 0 }
  private gamepadJump = false
  private gamepadFire = false
  private gamepadInteract = false
  private readonly touchDead = 0.28

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) {
        this.pressedThisFrame.add(e.code)
        this.downAt.set(e.code, performance.now())
      }
      this.keys.add(e.code)
    })
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code)
      this.downAt.delete(e.code)
    })
    window.addEventListener('blur', () => {
      this.keys.clear()
      this.downAt.clear()
    })
  }

  /** seconds the key has been held (0 if up) — UE Enhanced Input Hold trigger */
  heldTime(code: string): number {
    const at = this.downAt.get(code)
    return at === undefined ? 0 : (performance.now() - at) / 1000
  }

  /** Inject virtual-stick state so isDown maps MoveForward/MoveRight to WASD codes. */
  syncTouchInput(
    move: { x: number; y: number },
    jumpDown: boolean,
    jumpJustPressed: boolean,
    fireDown = false,
    fireJustPressed = false,
    interactDown = false,
    interactJustPressed = false,
  ) {
    this.touchMove = move
    this.touchJump = jumpDown
    this.touchFire = fireDown
    this.touchInteract = interactDown
    if (jumpJustPressed) this.pressedThisFrame.add('Space')
    if (fireJustPressed) this.pressedThisFrame.add('KeyF')
    if (interactJustPressed) this.pressedThisFrame.add('KeyE')
  }

  /** Wave 44 — gamepad stick + face buttons injected like touch HUD. */
  syncGamepadInput(
    move: { x: number; y: number },
    jumpDown: boolean,
    jumpJustPressed: boolean,
    fireDown = false,
    fireJustPressed = false,
    interactDown = false,
    interactJustPressed = false,
  ) {
    this.gamepadMove = move
    this.gamepadJump = jumpDown
    this.gamepadFire = fireDown
    this.gamepadInteract = interactDown
    if (jumpJustPressed) this.pressedThisFrame.add('Space')
    if (fireJustPressed) this.pressedThisFrame.add('KeyF')
    if (interactJustPressed) this.pressedThisFrame.add('KeyE')
  }

  clearTouchInput() {
    this.touchMove = { x: 0, y: 0 }
    this.touchJump = false
    this.touchFire = false
    this.touchInteract = false
  }

  clearGamepadInput() {
    this.gamepadMove = { x: 0, y: 0 }
    this.gamepadJump = false
    this.gamepadFire = false
    this.gamepadInteract = false
  }

  private altMoveAxis(): { x: number; y: number } {
    const tx = this.touchMove.x
    const ty = this.touchMove.y
    const gx = this.gamepadMove.x
    const gy = this.gamepadMove.y
    return {
      x: Math.abs(gx) > Math.abs(tx) ? gx : tx,
      y: Math.abs(gy) > Math.abs(ty) ? gy : ty,
    }
  }

  private altDown(code: string): boolean {
    const d = this.touchDead
    const move = this.altMoveAxis()
    switch (code) {
      case 'KeyW':
        return move.y < -d
      case 'KeyS':
        return move.y > d
      case 'KeyA':
        return move.x < -d
      case 'KeyD':
        return move.x > d
      case 'Space':
        return this.touchJump || this.gamepadJump
      case 'KeyF':
        return this.touchFire || this.gamepadFire
      case 'KeyE':
        return this.touchInteract || this.gamepadInteract
      default:
        return false
    }
  }

  /** true while the key is held */
  isDown(code: string): boolean {
    return this.keys.has(code) || this.altDown(code)
  }

  /** true only on the frame the key went down */
  justPressed(code: string): boolean {
    return this.pressedThisFrame.has(code)
  }

  /** called once per frame by the viewport loop */
  endFrame() {
    this.pressedThisFrame.clear()
  }
}

export const Input = new InputSystem()
