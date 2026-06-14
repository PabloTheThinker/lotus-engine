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
  syncTouchInput(move: { x: number; y: number }, jumpDown: boolean, jumpJustPressed: boolean) {
    this.touchMove = move
    this.touchJump = jumpDown
    if (jumpJustPressed) this.pressedThisFrame.add('Space')
  }

  clearTouchInput() {
    this.touchMove = { x: 0, y: 0 }
    this.touchJump = false
  }

  private touchDown(code: string): boolean {
    const d = this.touchDead
    switch (code) {
      case 'KeyW':
        return this.touchMove.y < -d
      case 'KeyS':
        return this.touchMove.y > d
      case 'KeyA':
        return this.touchMove.x < -d
      case 'KeyD':
        return this.touchMove.x > d
      case 'Space':
        return this.touchJump
      default:
        return false
    }
  }

  /** true while the key is held */
  isDown(code: string): boolean {
    return this.keys.has(code) || this.touchDown(code)
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
