import { encodeRgb565, validateManifest } from './runtime/core.mjs';

// Invoked only by the Mac CLI through Chrome DevTools Protocol.
window.runPrecompute = async ({ width, height, columns, format, token }) => {
  let renderer, spark, world;
  try {
    const THREE = await import('three');
    const { SparkRenderer, SplatMesh } = await import('@sparkjsdev/spark');
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(width, height);
    document.body.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x1a1a1a);
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    // Match threeScene.ts at the default 60 cm calibration and neutral tracked pose.
    camera.position.set(0, 0, 0.6);
    spark = new SparkRenderer({ renderer, maxStdDev: 2, autoUpdate: false });
    scene.add(spark);
    world = new SplatMesh({ url: '/scenes/lofi-world.spz' });
    await world.initialized;
    world.rotation.x = Math.PI; world.scale.setScalar(0.3); world.position.z = 0.6;
    scene.add(world);
    const frames = [];
    const conversion = format === 'rgb565le' ? document.createElement('canvas') : null;
    if (conversion) { conversion.width = width; conversion.height = height; }
    const context = conversion?.getContext('2d', { willReadFrequently: true });
    let totalBytes = 0;
    for (const pitch of [-10, 0, 10]) {
      for (let column = 0; column < columns; column++) {
        const yaw = -35 + 70 * column / (columns - 1);
        camera.rotation.set(pitch * Math.PI / 180, yaw * Math.PI / 180, 0, 'YXZ');
        scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
        // Spark documents that autoUpdate:false + awaited update waits for sorting.
        await spark.update({ scene, camera });
        renderer.render(scene, camera);
        const name = `view-${String(frames.length).padStart(3, '0')}.${format === 'jpeg' ? 'jpg' : 'rgb565'}`;
        let data;
        if (context) {
          context.drawImage(renderer.domElement, 0, 0);
          data = encodeRgb565(context.getImageData(0, 0, width, height).data);
        } else {
          data = await new Promise(resolve => renderer.domElement.toBlob(resolve, 'image/jpeg', 0.9));
          if (!data || data.type !== 'image/jpeg') throw new Error('JPEG 編碼失敗');
        }
        const response = await fetch('/__precompute/frame/' + name, {
          method: 'POST', headers: { 'X-Export-Token': token }, body: data,
        });
        if (!response.ok) throw new Error(await response.text());
        totalBytes += data.size ?? data.byteLength;
        frames.push({ yaw, pitch, file: `frames/${name}` });
      }
    }
    return validateManifest({ version: 1, width, height, format, frames,
      camera: { position: [0, 0, 0.6], fov: 75, rotationOrder: 'YXZ' },
      source: 'lofi-world.spz', totalBytes });
  } finally {
    world?.dispose(); spark?.dispose(); renderer?.dispose(); renderer?.forceContextLoss();
  }
};
