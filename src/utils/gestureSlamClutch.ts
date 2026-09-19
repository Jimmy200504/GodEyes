import { Quaternion, Vector3 } from 'three';
import type { HeadPose } from './headPose';

const rotation = (pose: HeadPose) => pose.orientation
  ? new Quaternion(pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w).normalize()
  : new Quaternion();
const position = (pose: HeadPose) => new Vector3(pose.position?.x ?? 0, pose.position?.y ?? 0, pose.position?.z ?? 0);
const copy = (pose: HeadPose): HeadPose => ({ ...pose, position: pose.position && { ...pose.position }, orientation: pose.orientation && { ...pose.orientation } });

/** Freeze only SLAM's contribution; the gesture offset remains independent. */
export class GestureSlamClutch {
  held = false;
  waiting = false;
  private absentSince: number | null = null;
  private lastOutput: HeadPose | null = null;
  private lastVersion = 0;
  private resumeAfter = 0;
  private offsetRotation = new Quaternion();
  private offsetPosition = new Vector3();

  observeHand(present: boolean, fresh: boolean, now: number, moving = false): void {
    if (!fresh) { this.absentSince = null; return; }
    if (present || moving) {
      this.absentSince = null;
      this.held = true;
      this.waiting = false;
    } else if (this.held) {
      this.absentSince ??= now;
      if (now - this.absentSince >= 350) {
        this.held = false;
        this.waiting = true;
        this.resumeAfter = this.lastVersion;
        this.absentSince = null;
      }
    }
  }

  apply(pose: HeadPose, version: number): HeadPose {
    this.lastVersion = version;
    if ((this.held || this.waiting) && !this.lastOutput) this.lastOutput = copy(pose);
    if (this.held || (this.waiting && version <= this.resumeAfter)) return copy(this.lastOutput!);
    if (this.waiting) {
      const held = this.lastOutput!;
      this.offsetRotation.copy(rotation(held)).multiply(rotation(pose).invert()).normalize();
      this.offsetPosition.copy(position(held)).sub(position(pose).applyQuaternion(this.offsetRotation));
      this.waiting = false;
    }
    if (!pose.orientation) { this.lastOutput = copy(pose); return copy(pose); }
    const p = position(pose).applyQuaternion(this.offsetRotation).add(this.offsetPosition);
    const q = rotation(pose).premultiply(this.offsetRotation).normalize();
    this.lastOutput = { ...pose, position: { x: p.x, y: p.y, z: p.z }, orientation: { x: q.x, y: q.y, z: q.z, w: q.w } };
    return copy(this.lastOutput);
  }

  reset(): void {
    this.held = false; this.waiting = false; this.absentSince = null;
    this.lastOutput = null; this.offsetRotation.identity(); this.offsetPosition.set(0, 0, 0);
  }
}
