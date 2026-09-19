import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxy = {
  '/api/gesture/ws': { target: 'ws://127.0.0.1:8782', ws: true },
  '/api/pose/ws': { target: 'ws://127.0.0.1:8767', ws: true },
  '/api/pose': 'http://127.0.0.1:8765',
  '/api/camera': {
    target: 'http://127.0.0.1:8766',
    rewrite: (path: string) => path.replace(/^\/api\/camera/, ''),
  },
};

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
});
