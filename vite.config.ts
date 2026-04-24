import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pactumRoot = path.resolve('C:/Projects/Pactum')

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: path.resolve('node_modules/react'),
      'react-dom': path.resolve('node_modules/react-dom'),
      'react/jsx-runtime': path.resolve('node_modules/react/jsx-runtime.js'),
      'react/jsx-dev-runtime': path.resolve(
        'node_modules/react/jsx-dev-runtime.js',
      ),
      '@pactum-labs/core': path.resolve(
        pactumRoot,
        'packages/pactum_core/src/index.ts',
      ),
      '@pactum-labs/react': path.resolve(
        pactumRoot,
        'packages/pactum_react/src/index.ts',
      ),
      'pdf-lib': path.resolve(
        pactumRoot,
        'packages/pactum_core/node_modules/pdf-lib',
      ),
    },
  },
  plugins: [react()],
  server: {
    fs: {
      allow: [path.resolve('.'), pactumRoot],
    },
  },
})
