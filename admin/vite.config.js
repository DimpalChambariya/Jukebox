import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isDemo = mode === 'demo' || mode === 'demo-local' || env.VITE_DEMO_MODE === 'true'

  let base = '/'
  if (command === 'build') {
    if (env.VITE_BASE_PATH) {
      // Explicit override for deployments where this app is NOT served under
      // an /admin/ subpath - e.g. its own standalone Vercel project at its
      // own domain root. Set VITE_BASE_PATH=/ there.
      base = env.VITE_BASE_PATH
    } else if (isDemo && mode === 'demo-local') {
      base = '/admin/'
    } else if (isDemo) {
      base = '/SpotiQueue/admin/'
    } else {
      base = '/admin/'
    }
  }

  return {
    base,
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@demo': path.resolve(__dirname, '../demo'),
      },
    },
    build: {
      outDir: 'build',
    },
    server: {
      port: 3002,
      host: true,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  }
})
