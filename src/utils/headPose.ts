import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

export interface HeadPose {
  sampleTimeMs?: number;
  ageMs?: number;
  x: number;
  y: number;
  z: number;
  /** Vertical displacement from the neutral pose, in scene meters. */
  heightOffset?: number;
  position?: { x: number; y: number; z: number };
  orientation?: { x: number; y: number; z: number; w: number };
}

export const DEFAULT_ROTATION_GAINS = { horizontal: 2, vertical: 1, roll: 1 };
export type RotationGains = typeof DEFAULT_ROTATION_GAINS;

/** Metric head movement with a clutch: rebase without losing the explored pose. */
export class HeadNavigationTracker {
  private rotation = new HeadRotationTracker();
  private neutral: Vector3 | null = null;
  private position = new Vector3();
  private orientation = new Quaternion();
  private anchorPosition = new Vector3();
  private anchorOrientation = new Quaternion();
  private gains = { ...DEFAULT_ROTATION_GAINS };

  setRotationGains(gains: RotationGains): void {
    if (!Object.values(gains).every(value => Number.isFinite(value) && value >= 0.5 && value <= 4)) return;
    this.gains = { ...gains };
    this.rebase();
  }

  rebase(): void {
    this.neutral = null;
    this.rotation.reset();
    this.anchorPosition.copy(this.position);
    this.anchorOrientation.copy(this.orientation);
  }

  reset(): void {
    this.position.set(0, 0, 0);
    this.orientation.identity();
    this.rebase();
  }

  update(data: number[]): HeadPose | null {
    const relative = this.rotation.update(data);
    if (!relative) return null;
    // Unmirrored MediaPipe translation is in centimeters. Map into the
    // viewer's axes: right +X, up +Y, toward the screen -Z.
    const measured = new Vector3(-data[12], data[13], -data[14]).multiplyScalar(0.01);
    if (!this.neutral) this.neutral = measured.clone();
    this.position.copy(measured).sub(this.neutral)
      .applyQuaternion(this.anchorOrientation).add(this.anchorPosition);
    const angles = new Euler().setFromQuaternion(
      new Quaternion(relative.x, relative.y, relative.z, relative.w), 'YXZ'
    );
    angles.x *= this.gains.vertical;
    angles.y *= this.gains.horizontal;
    angles.z *= this.gains.roll;
    this.orientation.copy(this.anchorOrientation).multiply(new Quaternion().setFromEuler(angles));
    return {
      x: 0.5, y: 0.5, z: 1,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      orientation: { x: this.orientation.x, y: this.orientation.y, z: this.orientation.z, w: this.orientation.w },
    };
  }
}

// MediaPipe's face matrix is column-major and faces +Z. The camera faces -Z.
export class HeadRotationTracker {
  private neutral: Quaternion | null = null;
  private rotationMatrix = new Matrix4();

  reset(): void {
    this.neutral = null;
  }

  update(data: number[]): HeadPose['orientation'] | null {
    if (data.length !== 16 || !data.every(Number.isFinite)) return null;
    const matrix = new Matrix4().fromArray(data);
    if (Math.abs(matrix.determinant()) < 1e-8) return null;
    this.rotationMatrix.extractRotation(matrix);
    const rotation = new Quaternion().setFromRotationMatrix(this.rotationMatrix).normalize();
    if (!this.neutral) this.neutral = rotation.clone();
    const relative = this.neutral.clone().invert().multiply(rotation);
    // Change from the face's forward axis to the camera's forward axis.
    return { x: -relative.x, y: relative.y, z: -relative.z, w: relative.w };
  }
}

export class HeadHeightTracker {
  private neutralY: number | null = null;
  private height = 0;

  reset(): void {
    this.neutralY = null;
    this.height = 0;
  }

  update(data: number[]): number | null {
    if (data.length !== 16 || !data.every(Number.isFinite)) return null;
    const matrix = new Matrix4().fromArray(data);
    if (Math.abs(matrix.determinant()) < 1e-8) return null;
    // MediaPipe metric face transforms use centimeters, with Y pointing up.
    // Translation stays independent of head rotation and forward/back movement.
    const y = matrix.elements[13];
    if (this.neutralY === null) this.neutralY = y;
    const target = Math.max(-0.5, Math.min(0.5, (y - this.neutralY) * 0.01));
    this.height += (target - this.height) * 0.25;
    return this.height;
  }
}

export interface SmoothedHeadPose extends HeadPose {
  rawX: number;
  rawY: number;
  rawZ: number;
}

export class HeadPoseTracker {
  private smoothedPose: HeadPose = { x: 0, y: 0, z: 1 };
  private smoothingFactor = 0.3;
  private baseInterOcularDistance = 0.1;

  constructor(smoothingFactor: number = 0.3) {
    this.smoothingFactor = Math.max(0.1, Math.min(0.9, smoothingFactor));
  }

  extractHeadPoseFromLandmarks(landmarks: { x: number; y: number; z?: number }[][]): HeadPose | null {
    if (!landmarks || landmarks.length === 0) {
      return null;
    }

    const firstFace = landmarks[0];

    if (!firstFace || firstFace.length < 468) {
      return null;
    }

    const leftEyeInner = firstFace[133];
    const rightEyeInner = firstFace[362];
    const noseTip = firstFace[1];
    const leftEyeOuter = firstFace[33];
    const rightEyeOuter = firstFace[263];

    const faceX = (leftEyeInner.x + rightEyeInner.x + noseTip.x) / 3;
    const faceY = (leftEyeInner.y + rightEyeInner.y + noseTip.y) / 3;

    const interOcularDist = Math.sqrt(
      Math.pow(rightEyeInner.x - leftEyeInner.x, 2) +
      Math.pow(rightEyeInner.y - leftEyeInner.y, 2)
    );

    const eyeWidth = Math.sqrt(
      Math.pow(rightEyeOuter.x - leftEyeOuter.x, 2) +
      Math.pow(rightEyeOuter.y - leftEyeOuter.y, 2)
    );

    const depthProxy = (interOcularDist + eyeWidth * 0.5) / (this.baseInterOcularDistance * 1.5);

    const clampedX = Math.max(0.2, Math.min(0.8, faceX));
    const clampedY = Math.max(0.2, Math.min(0.8, faceY));
    const clampedZ = Math.max(0.5, Math.min(2.0, depthProxy));

    this.smoothedPose.x = this.smoothedPose.x + this.smoothingFactor * (clampedX - this.smoothedPose.x);
    this.smoothedPose.y = this.smoothedPose.y + this.smoothingFactor * (clampedY - this.smoothedPose.y);
    this.smoothedPose.z = this.smoothedPose.z + this.smoothingFactor * (clampedZ - this.smoothedPose.z);

    return { ...this.smoothedPose };
  }

  getSmoothedPose(): HeadPose {
    return { ...this.smoothedPose };
  }

  reset(): void {
    this.smoothedPose = { x: 0.5, y: 0.5, z: 1 };
  }
}

export function headPoseToCamera(
  headPose: HeadPose,
  strengthX: number = 3,
  strengthY: number = 3,
  strengthZ: number = 4,
  baseZ: number = 8
): { x: number; y: number; z: number } {
  const cameraX = (0.5 - headPose.x) * strengthX;
  const cameraY = (0.5 - headPose.y) * strengthY;
  const cameraZ = baseZ - (headPose.z - 1) * strengthZ;

  return { x: cameraX, y: cameraY, z: cameraZ };
}
