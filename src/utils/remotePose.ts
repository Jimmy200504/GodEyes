import { Quaternion, Vector3 } from 'three';
import type { HeadPose } from './headPose';

export interface PosePacket {
  version: 1;
  frame: 'opencv-c2w';
  session_id: string;
  map_id: string;
  source: string;
  seq: number;
  capture_monotonic_ns: number;
  tracking: 'initializing' | 'tracking' | 'lost' | 'relocalizing';
  scale: 'metric' | 'arbitrary' | 'estimated';
  tracking_reason?: string | null;
  position: [number, number, number];
  quaternion_xyzw: [number, number, number, number];
}

/** Recenter in the initial optical camera frame, then convert both bases to Three.js. */
export class RemotePoseTracker {
  private origin: { position: Vector3; rotation: Quaternion } | null = null;
  private epoch = '';
  private lastSeq = -1;
  private blocked = false;
  status = '等待姿態';
  private smoother = new AdaptivePoseSmoother();

  constructor(private smoothing = false) {}

  setSmoothing(enabled: boolean): void {
    this.smoothing = enabled;
    this.smoother.reset();
  }

  hold(): void { this.smoother.pause(); }

  reset(): void {
    this.smoother.reset();
    this.origin = null;
    this.epoch = '';
    this.lastSeq = -1;
    this.blocked = false;
  }

  update(p: PosePacket, ageMs: number): HeadPose | null {
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 250) {
      this.hold();
      this.status = '資料過期，視角已凍結'; return null;
    }
    const epoch = JSON.stringify([p.session_id, p.map_id]);
    if (this.epoch && epoch !== this.epoch) this.blocked = true;
    if (this.blocked) { this.status = '地圖或工作階段已變更，請重設原點'; return null; }
    if (p.tracking !== 'tracking') {
      this.hold();
      const reasons: Record<string, string> = {
        calibration_required: '相機已連線，需校正或啟用粗估示範',
        resolution_mismatch: '相機解析度與校正不符，視角已凍結',
        marker_missing_or_duplicate: '找不到唯一的 B，視角已凍結',
        marker_too_small: 'B 太小，請靠近相機',
        pose_quality_rejected: '已辨識 B，但姿態解算品質不足',
      };
      this.status = reasons[p.tracking_reason ?? ''] ?? `追蹤狀態：${p.tracking}`;
      return null;
    }
    if (p.scale !== 'metric' && p.scale !== 'estimated') { this.hold(); this.status = '尚未校正公尺尺度，視角已凍結'; return null; }
    if (p.seq <= this.lastSeq) return null;
    this.epoch = epoch;
    this.lastSeq = p.seq;
    const position = new Vector3(...p.position);
    const rotation = new Quaternion(...p.quaternion_xyzw).normalize();
    if (!this.origin) this.origin = { position: position.clone(), rotation: rotation.clone() };
    const inverse = this.origin.rotation.clone().invert();
    position.sub(this.origin.position).applyQuaternion(inverse);
    rotation.premultiply(inverse);
    this.status = p.scale === 'estimated' ? '追蹤中 · 未校正粗估（距離與角度非精確值）'
      : p.source === 'mock' ? '模擬資料（非相機追蹤）' : `追蹤中：${p.source}`;
    const pose: HeadPose = {
      x: 0.5, y: 0.5, z: 1,
      position: { x: position.x, y: -position.y, z: -position.z },
      orientation: { x: rotation.x, y: -rotation.y, z: -rotation.z, w: rotation.w },
    };
    return this.smoothing ? this.smoother.update(pose, p.capture_monotonic_ns / 1e9) : pose;
  }
}


/** Speed-adaptive low-pass filtering inspired by One Euro (Casiez et al., 2012).
 * Quaternion rotations use shortest-arc SLERP and angular velocity, not Euler averages.
 * Operates only on new capture timestamps, independently of HTTP polling frequency.
 */
export class AdaptivePoseSmoother {
  private time: number | null = null;
  private paused = false;
  private rawPosition = new Vector3();
  private rawRotation = new Quaternion();
  private position = new Vector3();
  private rotation = new Quaternion();
  private velocity = new Vector3();
  private angularVelocity = new Vector3();

  reset(): void { this.time = null; this.paused = false; }

  /** Keep the visible pose during loss; resume with a bounded filter step. */
  pause(): void { this.paused = true; }

  update(pose: HeadPose, time: number): HeadPose {
    if (!pose.position || !pose.orientation || !Number.isFinite(time)) return pose;
    const rawPosition = new Vector3(pose.position.x, pose.position.y, pose.position.z);
    const rawRotation = new Quaternion(pose.orientation.x, pose.orientation.y,
      pose.orientation.z, pose.orientation.w).normalize();
    const dt = this.time === null ? 0 : time - this.time;
    if (this.time === null) {
      this.position.copy(rawPosition);
      this.rotation.copy(rawRotation);
      this.velocity.set(0, 0, 0);
      this.angularVelocity.set(0, 0, 0);
    } else if (dt > 0 && (this.paused || dt > 0.25)) {
      // Reset derivatives across gaps, but use every valid measurement. Discarding
      // the recovery frame would freeze forever with alternating valid/lost frames.
      const step = Math.min(dt, 1 / 30);
      const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * step));
      this.position.lerp(rawPosition, alpha(1.5));
      this.rotation.slerp(rawRotation, alpha(2)).normalize();
      this.velocity.set(0, 0, 0);
      this.angularVelocity.set(0, 0, 0);
    } else if (dt > 0) {
      const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
      const derivativeAlpha = alpha(1);
      const velocity = rawPosition.clone().sub(this.rawPosition).divideScalar(dt);
      this.velocity.lerp(velocity, derivativeAlpha);
      const delta = this.rawRotation.clone().invert().multiply(rawRotation);
      if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
      const axis = new Vector3(delta.x, delta.y, delta.z);
      const sinHalf = axis.length();
      const angle = 2 * Math.atan2(sinHalf, Math.max(0, delta.w));
      const angularVelocity = sinHalf > 1e-9 ? axis.multiplyScalar(angle / (sinHalf * dt)) : axis.set(0, 0, 0);
      this.angularVelocity.lerp(angularVelocity, derivativeAlpha);
      // Meters/second for position (estimated units in demo), radians/second for rotation.
      this.position.lerp(rawPosition, alpha(1.5 + 4 * this.velocity.length()));
      this.rotation.slerp(rawRotation, alpha(2 + 0.5 * this.angularVelocity.length())).normalize();
    }
    if (this.time === null || dt > 0) {
      this.paused = false;
      this.time = time;
      this.rawPosition.copy(rawPosition);
      this.rawRotation.copy(rawRotation);
    }
    return { ...pose,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      orientation: { x: this.rotation.x, y: this.rotation.y, z: this.rotation.z, w: this.rotation.w },
    };
  }
}
