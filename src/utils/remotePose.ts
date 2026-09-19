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

  reset(): void {
    this.origin = null;
    this.epoch = '';
    this.lastSeq = -1;
    this.blocked = false;
  }

  update(p: PosePacket, ageMs: number): HeadPose | null {
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 250) {
      this.status = '資料過期，視角已凍結'; return null;
    }
    const epoch = JSON.stringify([p.session_id, p.map_id]);
    if (this.epoch && epoch !== this.epoch) this.blocked = true;
    if (this.blocked) { this.status = '地圖或工作階段已變更，請重設原點'; return null; }
    if (p.tracking !== 'tracking') {
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
    if (p.scale !== 'metric' && p.scale !== 'estimated') { this.status = '尚未校正公尺尺度，視角已凍結'; return null; }
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
    return {
      x: 0.5, y: 0.5, z: 1,
      position: { x: position.x, y: -position.y, z: -position.z },
      orientation: { x: rotation.x, y: -rotation.y, z: -rotation.z, w: rotation.w },
    };
  }
}
