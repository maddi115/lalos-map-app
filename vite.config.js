import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    host: '0.0.0.0'
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: ['maddismap.live', 'www.maddismap.live', 'localhost']
  }
});
