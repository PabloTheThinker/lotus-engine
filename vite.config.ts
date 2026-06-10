import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { vektraTerminalPlugin } from './vite-plugin-vektra-terminal'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), vektraTerminalPlugin()],
  server: {
    host: '127.0.0.1',
    proxy: {
      // AI copilot → local Ollama without CORS friction
      '/ollama': {
        target: 'http://127.0.0.1:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ''),
      },
    },
  },
})
