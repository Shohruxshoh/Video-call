import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// In development the Node server runs on :3210; Vite proxies the API and WebSocket to it.
const proxy = {
  '/api': 'http://127.0.0.1:3210',
  '/ws': { target: 'ws://127.0.0.1:3210', ws: true },
};

export default defineConfig({
  plugins: [svelte()],
  server: { proxy },
  preview: { proxy },
  build: { target: 'es2020' },
});
