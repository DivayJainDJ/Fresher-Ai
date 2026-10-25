import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteStaticCopy({ targets: [{ src: ['../node_modules/pyodide/pyodide.asm.mjs', '../node_modules/pyodide/pyodide.asm.wasm', '../node_modules/pyodide/python_stdlib.zip', '../node_modules/pyodide/pyodide-lock.json'], dest: 'assets/pyodide', rename: { stripBase: true } }] })],
  optimizeDeps: { exclude: ['pyodide'] },
  worker: { format: 'es' },
})
