import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { WorldScene } from "./worldScenes";
import { KeyboardNavigation } from "./keyboardNavigation";
import { HeadPose } from "./headPose";
import { OffAxisCamera } from "./offAxisCamera";
import { calibrationManager, CalibrationData } from "./calibration";

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
  private navigation: KeyboardNavigation;
  private mode: "mouse" | "head" = "mouse";
  private yaw = 0;
  private pitch = 0;
  private previousTime = 0;
  private pointer: { x: number; y: number; id: number } | null = null;
  private target: HTMLElement;

  constructor(options: ThreeSceneOptions) {
    this.target = options.container;
    this.navigation = new KeyboardNavigation(this.target);
    this.target.addEventListener("pointerdown", this.pointerDown);
    this.target.addEventListener("pointermove", this.pointerMove);
    this.target.addEventListener("pointerup", this.pointerUp);
    this.target.addEventListener("pointercancel", this.pointerUp);
    this.target.addEventListener("lostpointercapture", this.pointerUp);
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
      alpha: false,
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    options.container.appendChild(this.renderer.domElement);
    this.spark = new SparkRenderer({ renderer: this.renderer, maxStdDev: 2 });
    this.scene.add(this.spark);

    this.createDebugHelpers();
  }

  async loadWorld(
    config: WorldScene,
    onStatus: (status: "loading" | "ready" | "error") => void,
  ): Promise<void> {
    if (this.disposed) return;
    if (this.world) {
      this.scene.remove(this.world);
      if (this.worldReady) this.world.dispose();
    }
    this.worldReady = false;
    onStatus("loading");
    this.resetView();
    const world = new SplatMesh({ url: config.spzUrl! });
    this.world = world;
    try {
      await world.initialized;
      if (this.disposed || this.world !== world) {
        world.dispose();
        return;
      }
      // Marble exports use Y-down. Align the capture origin with the resting eye.
      world.rotation.x = config.transform?.rotationX ?? Math.PI;
      world.scale.setScalar(config.transform?.scale ?? 0.3);
      world.position.z =
        calibrationManager.getCalibration().viewingDistanceCm * 0.01;
      this.scene.add(world);
      this.worldReady = true;
      onStatus("ready");
    } catch (error) {
      world.dispose();
      if (this.disposed || this.world !== world) return;
      this.world = null;
      onStatus("error");
      console.error(`Unable to load scene ${config.id}:`, error);
    }
  }

  setMode(mode: "mouse" | "head"): void {
    this.mode = mode;
    this.resetView();
  }

  resetView(): void {
    this.navigation.reset();
    this.yaw = 0;
    this.pitch = 0;
    this.currentHeadPose = {
      x: 0.5,
      y: 0.5,
      z: 1,
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    };
  }

  private pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.mode !== "mouse") return;
    this.target.focus({ preventScroll: true });
    this.target.setPointerCapture(event.pointerId);
    this.pointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
  };
  private pointerMove = (event: PointerEvent): void => {
    if (!this.pointer || this.mode !== "mouse") return;
    this.yaw -= (event.clientX - this.pointer.x) * 0.004;
    this.pitch = Math.max(
      -Math.PI * 0.48,
      Math.min(
        Math.PI * 0.48,
        this.pitch - (event.clientY - this.pointer.y) * 0.004,
      ),
    );
    this.pointer.x = event.clientX;
    this.pointer.y = event.clientY;
  };
  private pointerUp = (): void => {
    this.pointer = null;
  };

  private createDebugHelpers(): void {
    const axesHelper = new THREE.AxesHelper(0.1);
    axesHelper.visible = false;
    this.debugHelpers.push(axesHelper);
    this.scene.add(axesHelper);

    const headPositionMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff00ff }),
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
    this.debugHelpers.forEach((helper) => {
      helper.visible = enabled;
    });
  }

  updateCalibration(calibration: CalibrationData): void {
    this.offAxisCamera.updateCalibration(calibration);
    if (this.world)
      this.world.position.z = calibration.viewingDistanceCm * 0.01;
  }

  private animate = (): void => {
    if (!this.isRunning) return;

    this.animationFrameId = requestAnimationFrame(this.animate);

    const time = performance.now();
    const seconds = this.previousTime ? (time - this.previousTime) / 1000 : 0;
    this.previousTime = time;
    if (this.mode === "head") {
      this.offAxisCamera.updateFromHeadPose(this.currentHeadPose);
    } else {
      this.camera.position.set(
        0,
        0,
        calibrationManager.getCalibration().viewingDistanceCm * 0.01,
      );
      this.camera.quaternion.setFromEuler(
        new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"),
      );
      this.camera.updateProjectionMatrix();
    }
    this.navigation.update(seconds, this.camera.quaternion);
    this.camera.position.add(this.navigation.offset);

    if (this.debugMode && this.debugHelpers.length > 1) {
      this.debugHelpers[1].position.copy(this.camera.position);
    }

    // Spark cannot sort an empty accumulator before the first world is ready.
    if (this.worldReady) this.renderer.render(this.scene, this.camera);
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
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.navigation.dispose();
    this.target.removeEventListener("pointerdown", this.pointerDown);
    this.target.removeEventListener("pointermove", this.pointerMove);
    this.target.removeEventListener("pointerup", this.pointerUp);
    this.target.removeEventListener("pointercancel", this.pointerUp);
    this.target.removeEventListener("lostpointercapture", this.pointerUp);
    // Stop scheduling new sorts, but allow any GPU readback already in flight to finish.
    this.spark.autoUpdate = false;
    this.spark.sortDirty = false;
    clearTimeout(this.spark.updateTimeoutId);
    clearTimeout(this.spark.sortTimeoutId);
    const releaseRenderer = () => {
      if (this.spark.sorting) {
        setTimeout(releaseRenderer, 16);
        return;
      }
      // An in-flight splat is disposed by loadWorld after decoding completes.
      if (this.worldReady) this.world?.dispose();
      this.spark.dispose();
      this.renderer.dispose();
    };
    releaseRenderer();

    this.debugHelpers.forEach((helper) => {
      if (
        helper instanceof THREE.Mesh ||
        helper instanceof THREE.LineSegments
      ) {
        helper.geometry.dispose();
        const materials = Array.isArray(helper.material)
          ? helper.material
          : [helper.material];
        materials.forEach((material) => material.dispose());
      }
    });

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(
        this.renderer.domElement,
      );
    }
  }
}
