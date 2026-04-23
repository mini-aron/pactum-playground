import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pactumRoot = path.resolve(__dirname, '..', '..', 'project', 'Pactum')

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
      '@pactum/pactum_core': path.resolve(pactumRoot, 'packages/pactum_core'),
      '@pactum/pactum_react': path.resolve(pactumRoot, 'packages/pactum_react'),
      'pdf-lib': path.resolve(
        pactumRoot,
        'node_modules/.pnpm/pdf-lib@1.17.1/node_modules/pdf-lib',
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
