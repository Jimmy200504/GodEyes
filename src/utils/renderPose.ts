import { Quaternion, Vector3 } from 'three';
import type { HeadPose } from './headPose';

/** Time-based render smoothing; never extrapolates through missing measurements. */
export class RenderPoseSmoother {
  enabled = true;
  private current: HeadPose | null = null;
  private target: HeadPose | null = null;
  private lastTime = 0;
  private expires = 0;
  private position = new Vector3();
  private rotation = new Quaternion();
  private targetPosition = new Vector3();
  private targetRotation = new Quaternion();

  constructor(private tauMs = 25) {}

  hold(): void { this.target = null; }
  reset(): void { this.current = null; this.hold(); }

  setTarget(pose: HeadPose, now: number, validForMs = 250): void {
    if (!this.target) this.lastTime = now;
    this.target = pose;
    this.expires = now + Math.max(0, validForMs);
    if (!this.current) this.current = structuredClone(pose);
  }

  step(now: number): HeadPose | null {
    if (!this.target || !this.current) return this.current;
    if (now >= this.expires) { this.hold(); return this.current; }
    // A suspended browser tab must not jump straight to a fresh target on resume.
    const dt = Math.min(50, Math.max(0, now - this.lastTime));
    this.lastTime = now;
    const p = this.current, target = this.target;
    if (!this.enabled || !p.position || !p.orientation || !target.position || !target.orientation) {
      this.current = structuredClone(target);
      return this.current;
    }
    const alpha = 1 - Math.exp(-dt / this.tauMs);
    this.position.set(p.position.x, p.position.y, p.position.z);
    this.targetPosition.set(target.position.x, target.position.y, target.position.z);
    this.rotation.set(p.orientation.x, p.orientation.y, p.orientation.z, p.orientation.w).normalize();
    this.targetRotation.set(target.orientation.x, target.orientation.y, target.orientation.z, target.orientation.w).normalize();
    this.position.lerp(this.targetPosition, alpha);
    this.rotation.slerp(this.targetRotation, alpha).normalize();
    this.current = { ...target,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      orientation: { x: this.rotation.x, y: this.rotation.y, z: this.rotation.z, w: this.rotation.w } };
    return this.current;
  }
}
