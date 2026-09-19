import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxy = {
  '/api/pose/ws': { target: 'ws://127.0.0.1:8867', ws: true },
  '/api/pose': 'http://127.0.0.1:8865',
  '/api/camera': {
    target: 'http://127.0.0.1:8866',
    rewrite: (path: string) => path.replace(/^\/api\/camera/, ''),
  },
};

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
});
