import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxy = {
  '/api/gesture/ws': { target: 'ws://127.0.0.1:18782', ws: true },
  '/api/pose/ws': { target: 'ws://127.0.0.1:8867', ws: true },
  '/api/pose': 'http://127.0.0.1:8865',
  '/api/camera': {
    target: 'http://127.0.0.1:8866',
    rewrite: (path: string) => path.replace(/^\/api\/camera/, ''),
  },
  '/api': 'http://127.0.0.1:8000',
};

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
  optimizeDeps: {
    exclude: [
      'lucide-react',
      '@mediapipe/face_mesh',
      '@mediapipe/camera_utils',
      '@mediapipe/drawing_utils'
    ],
  },
  build: {
    rollupOptions: {
      external: [
        '@mediapipe/face_mesh',
        '@mediapipe/camera_utils',
        '@mediapipe/drawing_utils'
      ]
    }
  }

});
