import * as THREE from 'three';
import { HeadPose } from './headPose';
import { CalibrationData } from './calibration';

export interface HeadPositionWorld {
  x: number;
  y: number;
  z: number;
}

export class OffAxisCamera {
  private camera: THREE.PerspectiveCamera;
  private calibration: CalibrationData;
  private screenWidthWorld: number;
  private screenHeightWorld: number;
  private nearPlane: number = 0.05;
  private farPlane: number = 1000;

  constructor(camera: THREE.PerspectiveCamera, calibration: CalibrationData) {
    this.camera = camera;
    this.calibration = calibration;

    const worldScale = 0.01;
    this.screenWidthWorld = calibration.screenWidthCm * worldScale;
    this.screenHeightWorld = calibration.screenHeightCm * worldScale;
  }

  updateCalibration(calibration: CalibrationData): void {
    this.calibration = calibration;
    const worldScale = 0.01;
    this.screenWidthWorld = calibration.screenWidthCm * worldScale;
    this.screenHeightWorld = calibration.screenHeightCm * worldScale;
  }

  headPoseToWorldPosition(headPose: HeadPose): HeadPositionWorld {
    const worldScale = 0.01;
    const movementScale = 1;

    const normalizedX = headPose.x;
    const normalizedY = headPose.y;

    // Map both axes to the intended on-screen response around the neutral pose.
    const headXWorld = (normalizedX - 0.5) * this.screenWidthWorld * movementScale;
    const headYWorld = (normalizedY - 0.5) * this.screenHeightWorld * movementScale;

    const baseDistance = this.calibration.viewingDistanceCm * worldScale;
    const depthScale = 1.0 / headPose.z;
    const headZWorld = baseDistance * depthScale;

    return {
      x: headXWorld,
      y: headYWorld,
      z: headZWorld,
    };
  }

  updateProjectionMatrix(headPosition: HeadPositionWorld): void {
    const near = this.nearPlane;
    const far = this.farPlane;

    const screenLeft = -this.screenWidthWorld / 2;
    const screenRight = this.screenWidthWorld / 2;
    const screenBottom = -this.screenHeightWorld / 2;
    const screenTop = this.screenHeightWorld / 2;

    const eyeX = headPosition.x;
    const eyeY = headPosition.y;
    const eyeZ = headPosition.z;

    const screenZ = 0;

    const viewerToScreenDistance = eyeZ - screenZ;

    if (viewerToScreenDistance <= 0) {
      return;
    }

    const n_over_d = near / viewerToScreenDistance;

    const left = (screenLeft - eyeX) * n_over_d;
    const right = (screenRight - eyeX) * n_over_d;
    const bottom = (screenBottom - eyeY) * n_over_d;
    const top = (screenTop - eyeY) * n_over_d;

    this.camera.projectionMatrix.makePerspective(left, right, top, bottom, near, far);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  setCameraPosition(headPosition: HeadPositionWorld): void {
    this.camera.position.set(headPosition.x, headPosition.y, headPosition.z);
    this.camera.lookAt(headPosition.x, headPosition.y, 0);
  }

  updateFromHeadPose(headPose: HeadPose): void {
    if (headPose.orientation) {
      // Angular tracking uses a centered lens: translation-based frustum shifts
      // would otherwise add a second, unrelated movement to the measured angle.
      const position = headPose.position ?? { x: 0, y: headPose.heightOffset ?? 0, z: 0 };
      this.camera.position.set(position.x, position.y, this.calibration.viewingDistanceCm * 0.01 + position.z);
      const { x, y, z, w } = headPose.orientation;
      this.camera.quaternion.set(x, y, z, w).normalize();
      this.camera.updateProjectionMatrix();
      return;
    }
    const worldPos = this.headPoseToWorldPosition(headPose);
    this.setCameraPosition(worldPos);
    this.updateProjectionMatrix(worldPos);
  }

  getScreenDimensions(): { width: number; height: number } {
    return {
      width: this.screenWidthWorld,
      height: this.screenHeightWorld,
    };
  }
}
