import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // During local `npm run dev`, forward /api/* to a local function runner.
      // With `vercel dev` this isn't needed — Vercel handles /api automatically.
    }
  }
});
