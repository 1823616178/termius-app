import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'local-pty': resolve('src/workers/local-pty/index.ts'),
          'data-worker': resolve('src/workers/data-crypto/index.ts'),
          'kdf-worker': resolve('src/workers/data-crypto/kdf-worker.ts'),
          connection: resolve('src/workers/connection/index.ts')
        }
      }
    }
  },
  preload: { build: { rollupOptions: { output: { format: 'cjs' } } } },
  renderer: { plugins: [vue()] }
})
