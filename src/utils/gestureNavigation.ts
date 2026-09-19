import { Quaternion, Vector3 } from 'three';

export interface GestureCommand {
  forward: number;
  sideways: number;
  yaw: number;
  pitch: number;
}

/** Commands expire independently of the socket, including when rendering pauses. */
export class GestureNavigation {
  readonly offset = new Vector3();
  private command: GestureCommand | null = null;
  private deadline = 0;
  private yaw = 0;
  private pitch = 0;
  private forward = new Vector3(0, 0, -1);
  private direction = new Vector3();
  private right = new Vector3();
  private yawRotation = new Quaternion();
  private pitchRotation = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly lateral = new Vector3(1, 0, 0);

  accept(command: GestureCommand, ageMs: number, now = performance.now()): boolean {
    if (!command || ![command.forward, command.sideways, command.yaw, command.pitch].every(
      value => Number.isFinite(value) && Math.abs(value) <= 1,
    ) || !Number.isFinite(ageMs) || ageMs < 0 || ageMs >= 250) {
      this.clear();
      return false;
    }
    this.command = { ...command };
    this.deadline = now + 250 - ageMs;
    return true;
  }

  clear = (): void => { this.command = null; };

  reset(): void {
    this.clear();
    this.offset.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
  }

  /** Mutates the freshly computed head orientation; never feed last frame back. */
  update(seconds: number, orientation: Quaternion, now = performance.now()): void {
    const command = now < this.deadline ? this.command : null;
    const dt = Math.max(0, Math.min(seconds, 0.05));
    if (command) {
      this.yaw = (this.yaw + command.yaw * dt * Math.PI / 3) % (2 * Math.PI);
      this.pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.pitch + command.pitch * dt * Math.PI / 3));
    }
    this.yawRotation.setFromAxisAngle(this.up, this.yaw);
    this.pitchRotation.setFromAxisAngle(this.lateral, this.pitch);
    orientation.premultiply(this.yawRotation).multiply(this.pitchRotation).normalize();
    if (!command) return;
    this.direction.set(0, 0, -1).applyQuaternion(orientation);
    this.direction.y = 0;
    if (this.direction.lengthSq() > 0.0001) this.forward.copy(this.direction).normalize();
    this.right.set(-this.forward.z, 0, this.forward.x);
    this.direction.copy(this.forward).multiplyScalar(command.forward).addScaledVector(this.right, command.sideways);
    if (this.direction.lengthSq() > 1) this.direction.normalize();
    this.offset.addScaledVector(this.direction, dt * 0.3);
  }
}
