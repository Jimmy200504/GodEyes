import * as THREE from 'three';
import { GestureSlamClutch } from './gestureSlamClutch';
import { GestureNavigation } from './gestureNavigation';
import { connectGestureSocket, type GestureTelemetry, type GestureConnection } from './gestureSocket';
import { RenderPoseSmoother } from './renderPose';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { HeadPose } from './headPose';
import { OffAxisCamera } from './offAxisCamera';
import { calibrationManager, CalibrationData } from './calibration';

export interface ThreeSceneOptions {
  container: HTMLElement;
  width?: number;
  height?: number;
  onGestureTelemetry?: (data: GestureTelemetry) => void;
  onGestureStatus?: (status: string) => void;
  onSceneStatus?: (status: 'loading' | 'ready' | 'error') => void;
}

export class ThreeSceneManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private offAxisCamera: OffAxisCamera;
  private model: THREE.Object3D | null = null;
  private animationFrameId: number | null = null;
  private isRunning = false;
  private currentHeadPose: HeadPose = { x: 0.5, y: 0.5, z: 1 };
  private renderPose = new RenderPoseSmoother();
  private debugMode: boolean = false;
  private debugHelpers: THREE.Object3D[] = [];
  private roomObjects: THREE.Object3D[] = [];
  private spark: SparkRenderer;
  private world: SplatMesh | null = null;
  private worldEnabled = true;
  private worldReady = false;
  private disposed = false;
  private gesture = new GestureNavigation();
  private slamClutch = new GestureSlamClutch();
  private poseVersion = 0;
  private disconnectGesture: GestureConnection;
  private lastFrame = performance.now();

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

    this.disconnectGesture = connectGestureSocket(
      (command, age) => this.gesture.accept(command, age),
      this.gesture.clear,
      options.onGestureStatus ?? (() => {}),
      data => {
        this.slamClutch.observeHand(data.handPresent, data.accepted, performance.now());
        options.onGestureTelemetry?.({ ...data, slamClutched: this.slamClutch.held, slamResumeWaiting: this.slamClutch.waiting });
      },
    );
    this.loadShoeModel();
    this.createWireframeRoom();
    this.createDebugHelpers();
    void this.loadWorld(options.onSceneStatus);
  }

  private async loadWorld(onStatus?: ThreeSceneOptions['onSceneStatus']): Promise<void> {
    onStatus?.('loading');
    const world = new SplatMesh({ url: `${import.meta.env.BASE_URL}scenes/lofi-world.spz` });
    this.world = world;
    try {
      await world.initialized;
      if (this.disposed) {
        world.dispose();
        return;
      }
      // Marble exports use Y-down. Place its capture origin at the resting eye
      // position and shrink the room to make head movement reveal depth.
      world.rotation.x = Math.PI;
      world.scale.setScalar(0.3);
      world.position.z = calibrationManager.getCalibration().viewingDistanceCm * 0.01;
      this.scene.add(world);
      this.worldReady = true;
      this.setWorldEnabled(this.worldEnabled);
      onStatus?.('ready');
    } catch (error) {
      world.dispose();
      if (this.disposed) return;
      this.world = null;
      this.worldReady = false;
      this.setWorldEnabled(false);
      onStatus?.('error');
      console.error('Unable to load the Marble sample:', error);
    }
  }

  setWorldEnabled(enabled: boolean): void {
    this.worldEnabled = enabled;
    const showWorld = enabled && this.worldReady;
    if (this.world) this.world.visible = showWorld;
    this.roomObjects.forEach(object => { object.visible = !showWorld; });
  }

  private loadShoeModel(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight1.position.set(1, 1, 1);
    this.scene.add(directionalLight1);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight2.position.set(-1, -1, 0.5);
    this.scene.add(directionalLight2);

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    dracoLoader.setDecoderConfig({ type: 'js' });

    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    loader.load(
      '/models/shoe.glb',
      (gltf) => {
        if (this.disposed) {
          gltf.scene.traverse(child => {
            if (child instanceof THREE.Mesh) {
              child.geometry.dispose();
              const materials = Array.isArray(child.material) ? child.material : [child.material];
              materials.forEach(material => material.dispose());
            }
          });
          dracoLoader.dispose();
          return;
        }
        this.model = gltf.scene;
        this.model.position.set(0, -0.09, -0.03);
        this.model.rotation.set(0, -0.628, 0);
        this.model.scale.set(0.071, 0.071, 0.071);
        this.scene.add(this.model);
        dracoLoader.dispose();
      },
      undefined,
      (error) => {
        dracoLoader.dispose();
        console.error('Error loading shoe model:', error);
      }
    );
  }

  private createWireframeRoom(): void {
    this.removeWireframeRoom();

    const screenDims = this.offAxisCamera.getScreenDimensions();
    const roomWidth = screenDims.width;
    const roomHeight = screenDims.height;
    const roomDepth = 0.35;
    const gridDivisions = 8;
    const gridColor = 0xff8c00;

    const wallMaterial = new THREE.LineBasicMaterial({
      color: gridColor,
      transparent: true,
      opacity: 0.8,
      depthTest: true,
      depthWrite: true,
      linewidth: 8
    });

    const createGridWall = (width: number, height: number): THREE.LineSegments => {
      const geometry = new THREE.BufferGeometry();
      const vertices: number[] = [];

      for (let i = 0; i <= gridDivisions; i++) {
        const t = i / gridDivisions;
        vertices.push(-width / 2 + t * width, -height / 2, 0);
        vertices.push(-width / 2 + t * width, height / 2, 0);
      }

      for (let i = 0; i <= gridDivisions; i++) {
        const t = i / gridDivisions;
        vertices.push(-width / 2, -height / 2 + t * height, 0);
        vertices.push(width / 2, -height / 2 + t * height, 0);
      }

      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      return new THREE.LineSegments(geometry, wallMaterial);
    };

    const backWall = createGridWall(roomWidth, roomHeight);
    backWall.position.z = -roomDepth;
    this.scene.add(backWall);
    this.roomObjects.push(backWall);

    const leftWall = createGridWall(roomDepth, roomHeight);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.x = -roomWidth / 2;
    leftWall.position.z = -roomDepth / 2;
    this.scene.add(leftWall);
    this.roomObjects.push(leftWall);

    const rightWall = createGridWall(roomDepth, roomHeight);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.x = roomWidth / 2;
    rightWall.position.z = -roomDepth / 2;
    this.scene.add(rightWall);
    this.roomObjects.push(rightWall);

    const floor = createGridWall(roomWidth, roomDepth);
    floor.rotation.x = Math.PI / 2;
    floor.position.y = -roomHeight / 2;
    floor.position.z = -roomDepth / 2;
    this.scene.add(floor);
    this.roomObjects.push(floor);

    const ceiling = createGridWall(roomWidth, roomDepth);
    ceiling.rotation.x = -Math.PI / 2;
    ceiling.position.y = roomHeight / 2;
    ceiling.position.z = -roomDepth / 2;
    this.scene.add(ceiling);
    this.roomObjects.push(ceiling);

    const screenFrame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(roomWidth, roomHeight)),
      new THREE.LineBasicMaterial({
        color: 0xff0000,
        linewidth: 4,
        depthTest: true,
        depthWrite: true
      })
    );
    screenFrame.position.z = 0.001;
    this.scene.add(screenFrame);
    this.roomObjects.push(screenFrame);
  }

  private removeWireframeRoom(): void {
    this.roomObjects.forEach(obj => {
      this.scene.remove(obj);
      if (obj instanceof THREE.LineSegments) {
        obj.geometry.dispose();
        if (obj.material instanceof THREE.Material) {
          obj.material.dispose();
        }
      }
    });
    this.roomObjects = [];
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
    if (this.slamClutch.waiting) this.renderPose.reset();
    this.poseVersion++;
    this.renderPose.setTarget(headPose, performance.now(), Math.max(0, 250-(headPose.ageMs ?? 0)));
  }

  coastHeadPose(): void { this.renderPose.coast(); }
  setPosePrediction(enabled: boolean): void { this.renderPose.predictionEnabled = enabled; this.renderPose.hold(); }
  calibratePalm(): boolean { this.gesture.clear(); return this.disconnectGesture.calibratePalm(); }
  holdHeadPose(): void { this.renderPose.hold(); }
  resetHeadPose(): void { this.renderPose.reset(); this.gesture.reset(); this.slamClutch.reset(); this.currentHeadPose = { x: .5, y: .5, z: 1 }; }
  setRenderSmoothing(enabled: boolean): void { this.renderPose.enabled = enabled; }

  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    this.debugHelpers.forEach(helper => {
      helper.visible = enabled;
    });
  }

  updateCalibration(calibration: CalibrationData): void {
    this.offAxisCamera.updateCalibration(calibration);
    this.createWireframeRoom();
    if (this.world) this.world.position.z = calibration.viewingDistanceCm * 0.01;
    this.setWorldEnabled(this.worldEnabled);
  }

  updateModelPosition(x: number, y: number, z: number): void {
    if (this.model) {
      this.model.position.set(x, y, z);
    }
  }

  updateModelScale(scale: number): void {
    if (this.model) {
      this.model.scale.set(scale, scale, scale);
    }
  }

  getModelPosition(): { x: number; y: number; z: number } {
    if (this.model) {
      return {
        x: this.model.position.x,
        y: this.model.position.y,
        z: this.model.position.z
      };
    }
    return { x: 0, y: -0.09, z: -0.03 };
  }

  getModelScale(): number {
    if (this.model) {
      return this.model.scale.x;
    }
    return 0.071;
  }

  updateModelRotation(x: number, y: number, z: number): void {
    if (this.model) {
      this.model.rotation.set(x, y, z);
    }
  }

  getModelRotation(): { x: number; y: number; z: number } {
    if (this.model) {
      return {
        x: this.model.rotation.x,
        y: this.model.rotation.y,
        z: this.model.rotation.z
      };
    }
    return { x: 0, y: -0.628, z: 0 };
  }

  private animate = (): void => {
    if (!this.isRunning) return;

    this.animationFrameId = requestAnimationFrame(this.animate);

    this.currentHeadPose = this.renderPose.step(performance.now()) ?? this.currentHeadPose;
    this.offAxisCamera.updateFromHeadPose(this.slamClutch.apply(this.currentHeadPose, this.poseVersion));
    const now = performance.now();
    this.gesture.update((now - this.lastFrame) / 1000, this.camera.quaternion, now);
    this.lastFrame = now;
    this.camera.position.add(this.gesture.offset);

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
    this.disconnectGesture();
    this.stop();
    this.removeWireframeRoom();
    // An in-flight splat is disposed by loadWorld after decoding completes.
    if (this.worldReady) this.world?.dispose();
    this.spark.dispose();

    if (this.model) {
      this.model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
    }

    this.renderer.dispose();

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
