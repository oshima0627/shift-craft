/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cloudflare Workers（ドメイン直下）配信。パスベースのルーティングのため base は絶対
export default defineConfig({
  base: '/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
  },
})
