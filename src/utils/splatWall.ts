import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

/**
 * The landing wall, rendered from the actual splat rather than from samples.
 *
 * Precomputed views can only ever be as smooth as their sampling: at 5° steps
 * the wall visibly steps, and blending neighbouring views ghosts instead of
 * parallaxing. The scene is already a Gaussian splat, so the wall renders it
 * live and the camera moves continuously with the viewer.
 */

export interface SplatWallOptions {
  canvas: HTMLCanvasElement;
  url: string;
  /** Look-around extent, in degrees, at the full ±1 viewer offset. */
  yawSpan?: number;
  pitchSpan?: number;
  /** Resting heading, in degrees, so the wall faces into the room. */
  heading?: number;
  /** Resting tilt, in degrees. Negative looks down, away from open sky. */
  tilt?: number;
  onStatus: (status: "loading" | "ready" | "error") => void;
  /** Called after each render, so the 1-bit half can resample the same frame. */
  onFrame?: (canvas: HTMLCanvasElement) => void;
}

const DEG = Math.PI / 180;

export class SplatWall {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private spark: SparkRenderer;
  private world: SplatMesh | null = null;
  /** Lateral travel, in scene units, at the full ±1 viewer offset. */
  private sway = 0.2;
  private aim = { x: 0, y: 0 };
  private held = { x: 0, y: 0 };
  private raf = 0;
  private disposed = false;
  private ready = false;
  private options: SplatWallOptions;

  constructor(options: SplatWallOptions) {
    this.options = options;
    const { canvas } = options;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      // The 1-bit half resamples the rendered frame, which needs the buffer to
      // survive past the draw call.
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x000000, 0);

    // Wide: the board covers the middle, so the wall has to carry its structure
    // out at the edges.
    this.camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.05, 400);
    this.spark = new SparkRenderer({ renderer: this.renderer, maxStdDev: 2 });
    this.scene.add(this.spark);
  }

  async load(): Promise<void> {
    this.options.onStatus("loading");
    const world = new SplatMesh({ url: this.options.url });
    try {
      await world.initialized;
      if (this.disposed) {
        world.dispose();
        return;
      }
      // Marble exports are Y-down; the capture origin sits at the resting eye,
      // which is where the camera stands. The scene wraps around that point, so
      // the wall looks outward from inside it rather than orbiting it.
      world.rotation.x = Math.PI;
      world.scale.setScalar(0.3);
      world.position.set(0, 0, 0);
      this.scene.add(world);
      this.world = world;
      this.ready = true;
      this.options.onStatus("ready");
    } catch {
      world.dispose();
      if (this.disposed) return;
      this.options.onStatus("error");
    }
  }

  setAim(x: number, y: number): void {
    this.aim.x = x;
    this.aim.y = y;
  }

  resize(width: number, height: number): void {
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    const { yawSpan = 15, pitchSpan = 7, heading = 0, tilt = 0 } = this.options;
    const restYaw = heading * DEG;
    const restPitch = tilt * DEG;
    const look = new THREE.Vector3();
    const tick = (): void => {
      this.raf = requestAnimationFrame(tick);
      if (!this.ready) return;
      // Ease toward the viewer's position, so a dropped frame never snaps.
      this.held.x += (this.aim.x - this.held.x) * 0.1;
      this.held.y += (this.aim.y - this.held.y) * 0.1;

      // Head-coupled perspective, the way the explorer does it: the eye moves
      // laterally, and the view turns with it. The translation is what makes
      // the near geometry slide past the far geometry.
      const yaw = restYaw + this.held.x * yawSpan * DEG;
      const pitch = restPitch - this.held.y * pitchSpan * DEG;
      this.camera.position.set(
        this.held.x * this.sway,
        -this.held.y * this.sway * 0.55,
        0,
      );
      look.set(
        this.camera.position.x + Math.sin(yaw) * Math.cos(pitch) * 3,
        this.camera.position.y + Math.sin(pitch) * 3,
        this.camera.position.z - Math.cos(yaw) * Math.cos(pitch) * 3,
      );
      this.camera.lookAt(look);
      this.renderer.render(this.scene, this.camera);
      this.options.onFrame?.(this.options.canvas);
    };
    this.raf = requestAnimationFrame(tick);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.spark.autoUpdate = false;
    this.spark.sortDirty = false;
    if (this.world) {
      this.scene.remove(this.world);
      this.world.dispose();
      this.world = null;
    }
    this.spark.dispose();
    this.renderer.dispose();
  }
}
