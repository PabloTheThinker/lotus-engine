/**
 * Input — global key state for gameplay scripts and pawn controllers
 * (the UInput / Godot Input singleton analog).
 */
class InputSystem {
  private keys = new Set<string>()
  private pressedThisFrame = new Set<string>()
  private downAt = new Map<string, number>()

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

  /** true while the key is held */
  isDown(code: string): boolean {
    return this.keys.has(code)
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
