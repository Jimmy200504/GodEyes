import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { WORLD_SCENES, WorldSceneId } from './worldScenes';
import { HeadPose } from './headPose';
import { OffAxisCamera } from './offAxisCamera';
import { calibrationManager, CalibrationData } from './calibration';

export interface ThreeSceneOptions {
  container: HTMLElement;
  width?: number;
  height?: number;
}

export class ThreeSceneManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private offAxisCamera: OffAxisCamera;
  private animationFrameId: number | null = null;
  private isRunning = false;
  private currentHeadPose: HeadPose = { x: 0.5, y: 0.5, z: 1 };
  private debugMode: boolean = false;
  private debugHelpers: THREE.Object3D[] = [];
  private spark: SparkRenderer;
  private world: SplatMesh | null = null;
  private worldReady = false;
  private disposed = false;

  constructor(options: ThreeSceneOptions) {
    const width = options.width || options.container.clientWidth;
    const height = options.height || options.container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);

    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    this.camera.position.z = 5;

    const calibration = calibrationManager.getCalibration();
    calibration.pixelWidth = width;
    calibration.pixelHeight = height;
    calibrationManager.updatePixelDimensions(width, height);

    this.offAxisCamera = new OffAxisCamera(this.camera, calibration);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    options.container.appendChild(this.renderer.domElement);
    this.spark = new SparkRenderer({ renderer: this.renderer, maxStdDev: 2 });
    this.scene.add(this.spark);

    this.createDebugHelpers();
  }

  async loadWorld(sceneId: WorldSceneId, onStatus: (status: 'loading' | 'ready' | 'error') => void): Promise<void> {
    if (this.disposed) return;
    if (this.world) {
      this.scene.remove(this.world);
      if (this.worldReady) this.world.dispose();
    }
    this.worldReady = false;
    onStatus('loading');
    const config = WORLD_SCENES.find(scene => scene.id === sceneId)!;
    const world = new SplatMesh({ url: `${import.meta.env.BASE_URL}scenes/${config.file}` });
    this.world = world;
    try {
      await world.initialized;
      if (this.disposed || this.world !== world) {
        world.dispose();
        return;
      }
      // Marble exports use Y-down. Align the capture origin with the resting eye.
      world.rotation.x = Math.PI;
      world.scale.setScalar(0.3);
      world.position.z = calibrationManager.getCalibration().viewingDistanceCm * 0.01;
      this.scene.add(world);
      this.worldReady = true;
      onStatus('ready');
    } catch (error) {
      world.dispose();
      if (this.disposed || this.world !== world) return;
      this.world = null;
      onStatus('error');
      console.error(`Unable to load scene ${sceneId}:`, error);
    }
  }

  private createDebugHelpers(): void {
    const axesHelper = new THREE.AxesHelper(0.1);
    axesHelper.visible = false;
    this.debugHelpers.push(axesHelper);
    this.scene.add(axesHelper);

    const headPositionMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff00ff })
    );
    headPositionMarker.visible = false;
    this.debugHelpers.push(headPositionMarker);
    this.scene.add(headPositionMarker);
  }

  updateHeadPose(headPose: HeadPose): void {
    this.currentHeadPose = headPose;
  }

  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    this.debugHelpers.forEach(helper => {
      helper.visible = enabled;
    });
  }

  updateCalibration(calibration: CalibrationData): void {
    this.offAxisCamera.updateCalibration(calibration);
    if (this.world) this.world.position.z = calibration.viewingDistanceCm * 0.01;
  }

  private animate = (): void => {
    if (!this.isRunning) return;

    this.animationFrameId = requestAnimationFrame(this.animate);

    this.offAxisCamera.updateFromHeadPose(this.currentHeadPose);

    if (this.debugMode && this.debugHelpers.length > 1) {
      this.debugHelpers[1].position.copy(this.camera.position);
    }

    this.renderer.render(this.scene, this.camera);
  };

  start(): void {
    if (!this.isRunning) {
      this.isRunning = true;
      this.animate();
    }
  }

  stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    // An in-flight splat is disposed by loadWorld after decoding completes.
    if (this.worldReady) this.world?.dispose();
    this.spark.dispose();

    this.debugHelpers.forEach(helper => {
      if (helper instanceof THREE.Mesh || helper instanceof THREE.LineSegments) {
        helper.geometry.dispose();
        const materials = Array.isArray(helper.material) ? helper.material : [helper.material];
        materials.forEach(material => material.dispose());
      }
    });

    this.renderer.dispose();

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
