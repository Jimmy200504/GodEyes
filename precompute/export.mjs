import { encodeRgb565, validateManifest, memoryEstimate } from './runtime/core.mjs';

// Read source bytes, not dev-server responses (which contain Vite injections).
const runtimeSources = import.meta.glob('./runtime/*', { query: '?raw', import: 'default', eager: true });

const button = document.querySelector('#export'), status = document.querySelector('#status');
async function write(directory, name, contents) {
  const file = await directory.getFileHandle(name, { create: true });
  const stream = await file.createWritable();
  await stream.write(contents); await stream.close();
}
button.addEventListener('click', async () => {
  let renderer, spark, world;
  button.disabled = true;
  try {
    if (!window.showDirectoryPicker) throw new Error('請使用 macOS 桌面版 Chrome / Edge');
    const directory = await window.showDirectoryPicker({ mode: 'readwrite' });
    for await (const entry of directory.values()) {
      if (entry) throw new Error('請選擇空資料夾，避免覆寫既有匯出');
    }
    const [width, height] = document.querySelector('#size').value.split(',').map(Number);
    const columns = Number(document.querySelector('#count').value);
    const format = document.querySelector('#format').value;
    status.textContent = '正在載入 GPU 渲染器與場景…';
    const THREE = await import('three');
    const { SparkRenderer, SplatMesh } = await import('@sparkjsdev/spark');
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(width, height);
    document.querySelector('#preview').replaceChildren(renderer.domElement);
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
    const framesDirectory = await directory.getDirectoryHandle('frames', { create: true });
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
        await write(framesDirectory, name, data);
        totalBytes += data.size ?? data.byteLength;
        frames.push({ yaw, pitch, file: `frames/${name}` });
        status.textContent = `已匯出 ${frames.length}/${columns * 3} 張`;
      }
    }
    for (const name of ['index.html', 'style.css', 'viewer.mjs', 'core.mjs']) {
      const source = runtimeSources[`./runtime/${name}`];
      if (typeof source !== 'string') throw new Error(`無法讀取 ${name}`);
      await write(directory, name, source);
    }
    const manifest = validateManifest({ version: 1, width, height, format, frames,
      camera: { position: [0, 0, 0.6], fov: 75, rotationOrder: 'YXZ' },
      source: 'lofi-world.spz', totalBytes });
    // Commit marker is written last. A partial export cannot appear complete.
    await write(directory, 'manifest.json', JSON.stringify(manifest, null, 2));
    const estimate = memoryEstimate(width, height, frames.length);
    status.textContent = `完成！影像 ${(totalBytes / 1048576).toFixed(1)} MiB；三張 RGBA 快取 ${(estimate.rgbaCache / 1048576).toFixed(1)} MiB（不含瀏覽器、畫布與解碼暫存）。`;
  } catch (error) {
    status.textContent = error.name === 'AbortError' ? '已取消。' : `匯出失敗：${error.message}`;
  } finally {
    world?.dispose(); spark?.dispose(); renderer?.dispose(); renderer?.forceContextLoss();
    button.disabled = false;
  }
});
