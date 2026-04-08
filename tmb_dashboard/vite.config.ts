import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const rootDir = path.dirname(fileURLToPath(import.meta.url))
  const env = loadEnv(mode, rootDir, '')
  const backendTarget = env.VITE_BACKEND_URL || 'http://127.0.0.1:8787'
  const proxy = {
    '/api': {
      target: backendTarget,
      changeOrigin: true,
    },
    '/ws': {
      target: backendTarget,
      changeOrigin: true,
      ws: true,
    },
  }

  return {
    plugins: [react()],
    server: {
      proxy,
    },
    preview: {
      proxy,
    },
  }
})
