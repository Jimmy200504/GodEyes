import { Quaternion, Vector3 } from 'three';

const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);

export class KeyboardNavigation {
  readonly offset = new Vector3();
  private keys = new Set<string>();
  private forward = new Vector3(0, 0, -1);
  private right = new Vector3();
  private direction = new Vector3();

  constructor(private target: HTMLElement) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.clear);
    window.addEventListener('blur', this.clear);
    document.addEventListener('visibilitychange', this.clear);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.target !== this.target || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
      this.clear();
      return;
    }
    if (!movementKeys.has(event.code)) return;
    event.preventDefault();
    this.keys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  clear = (): void => { this.keys.clear(); };

  reset(): void {
    this.clear();
    this.offset.set(0, 0, 0);
  }

  update(seconds: number, orientation: Quaternion): void {
    // Walk on the horizontal plane, ignoring head pitch and roll.
    this.direction.set(0, 0, -1).applyQuaternion(orientation);
    this.direction.y = 0;
    if (this.direction.lengthSq() > 0.0001) this.forward.copy(this.direction).normalize();
    this.right.set(-this.forward.z, 0, this.forward.x);
    const forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const sideways = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    this.direction.copy(this.forward).multiplyScalar(forward).addScaledVector(this.right, sideways);
    // Normalize diagonals and cap frame gaps so resuming cannot cause a jump.
    this.offset.addScaledVector(this.direction.normalize(), Math.max(0, Math.min(seconds, 0.05)) * 0.3);
  }

  dispose(): void {
    this.clear();
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.clear);
    window.removeEventListener('blur', this.clear);
    document.removeEventListener('visibilitychange', this.clear);
  }
}
