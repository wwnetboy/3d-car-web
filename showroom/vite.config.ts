import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export default defineConfig({
  // BoardUI also targets React Server Components. This app is entirely client-side.
  plugins: [{
    name: 'boardui-client-components',
    enforce: 'pre',
    transform(source, id) {
      if (/\/(components|utils)\//.test(id) && source.startsWith('"use client";')) {
        return { code: source.replace(/^"use client";/, ''), map: null }
      }
    },
  }, {
    name: 'edgeone-compressed-flow',
    apply: 'build',
    async writeBundle(options) {
      // Keep the raw URL for older browsers; EdgeOne decodes this via the
      // matching Content-Encoding header. The original CFD data stays local.
      const flow = resolve(options.dir || 'dist', 'flow')
      await copyFile(resolve(flow, 'vision-gt.bin.gz'), resolve(flow, 'vision-gt.bin'))
    },
  }],
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
})
