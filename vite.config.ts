/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages などのサブパス配信に対応するため base は相対指定
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
  },
})
