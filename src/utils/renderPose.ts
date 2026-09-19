import { Quaternion, Vector3 } from 'three';
import type { HeadPose } from './headPose';

/** Render smoothing with opt-in, bounded rotation-only prediction. */
export class RenderPoseSmoother {
  enabled = true;
  predictionEnabled = false;
  private measuredTime: number | null = null;
  private measuredRotation = new Quaternion();
  private angularVelocity = new Vector3();
  private arrived = 0;
  private predictionUntil = 0;
  private coasting = false;
  private current: HeadPose | null = null;
  private target: HeadPose | null = null;
  private lastTime = 0;
  private expires = 0;
  private position = new Vector3();
  private rotation = new Quaternion();
  private targetPosition = new Vector3();
  private targetRotation = new Quaternion();

  constructor(private tauMs = 25) {}

  hold(): void {
    this.target = null;
    this.measuredTime = null;
    this.angularVelocity.set(0, 0, 0);
    this.coasting = false;
  }

  coast(): void {
    if (!this.predictionEnabled) { this.hold(); return; }
    this.coasting = true;
    // Never extend the deadline because another lost packet arrived.
  }
  reset(): void { this.current = null; this.hold(); }

  setTarget(pose: HeadPose, now: number, validForMs = 250): void {
    const sampleTime = pose.sampleTimeMs ?? now;
    this.angularVelocity.set(0, 0, 0);
    if (pose.orientation) {
      const q = new Quaternion(pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w).normalize();
      const gap = this.measuredTime === null ? 0 : sampleTime - this.measuredTime;
      if (gap >= 10 && gap <= 200 && !this.coasting) {
        const delta = this.measuredRotation.clone().invert().multiply(q).normalize();
        if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
        const angle = 2 * Math.acos(Math.min(1, Math.max(-1, delta.w)));
        if (angle > 1e-6 && angle < Math.PI/6) {
          this.angularVelocity.set(delta.x, delta.y, delta.z).normalize()
            .multiplyScalar(Math.min(angle/gap, .004)); // <= 4 rad/s
        }
      }
      this.measuredRotation.copy(q);
      this.measuredTime = sampleTime;
    }
    this.arrived = now;
    this.predictionUntil = now + Math.min(100, Math.max(0, validForMs));
    this.coasting = false;
    if (!this.target) this.lastTime = now;
    this.target = pose;
    this.expires = now + Math.max(0, validForMs);
    if (!this.current) this.current = structuredClone(pose);
  }

  step(now: number): HeadPose | null {
    if (!this.target || !this.current) return this.current;
    if ((this.coasting || this.predictionEnabled) && now >= this.predictionUntil) { this.hold(); return this.current; }
    if (now >= this.expires) { this.hold(); return this.current; }
    // A suspended browser tab must not jump straight to a fresh target on resume.
    const dt = Math.min(50, Math.max(0, now - this.lastTime));
    this.lastTime = now;
    const p = this.current;
    let target = this.target;
    if (this.predictionEnabled && target.orientation && this.angularVelocity.lengthSq() > 0) {
      const speed = this.angularVelocity.length();
      const delta = new Quaternion().setFromAxisAngle(this.angularVelocity.clone().normalize(),
        speed * Math.max(0, Math.min(100, now-this.arrived)));
      const rotation = this.measuredRotation.clone().multiply(delta).normalize();
      target = { ...target, orientation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w } };
    }
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
