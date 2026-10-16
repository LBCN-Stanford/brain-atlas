import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// the build's identity, shown in the atlas's About sheet
try { process.env.VITE_BUILD_COMMIT ??= execSync('git rev-parse --short HEAD').toString().trim() } catch { /* not a git checkout */ }
process.env.VITE_BUILD_DATE ??= new Date().toISOString().slice(0, 10)

export default defineConfig({
  // relative, so the build works under any path (SITE_BASE sets the 404 redirect and canonical URL)
  base: './',
  plugins: [react()],
})
