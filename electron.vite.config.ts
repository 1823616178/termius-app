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
  renderer: {
    optimizeDeps: { exclude: ['@xterm/addon-webgl'] },
    plugins: [
      vue(),
      {
        name: 'xterm-webgl-canvas-font',
        enforce: 'pre',
        transform(code, id) {
          if (!id.split('?')[0]?.endsWith('/@xterm/addon-webgl/lib/addon-webgl.mjs')) return
          // In 0.19.0 both canvas font builders emit a leading space for upright
          // text. Chromium rejects the assignment and keeps the previous font.
          return code.replaceAll('?"italic":""', '?"italic":"normal"')
        }
      }
    ]
  }
})
