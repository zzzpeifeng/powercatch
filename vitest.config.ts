import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  test: {
    // 测试环境（默认 node）
    environment: 'node',

    // 为 Vue 组件测试使用 jsdom 环境
    environmentMatch: [
      // Vue 组件测试使用 jsdom
      ['src/**/*.{test,spec}.tsx', 'jsdom'],
      ['src/**/*.{test,spec}.vue', 'jsdom'],
    ],

    // 测试文件匹配模式
    include: [
      'electron/**/*.{test,spec}.ts',
      'src/**/*.{test,spec}.{ts,tsx}',
      'src/**/*.{test,spec}.vue',
      'tests/**/*.{test,spec}.ts',
    ],

    // 排除的文件
    exclude: [
      'node_modules',
      'dist',
      'dist-electron',
      'release',
    ],

    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'electron/services/**/*.ts',
        'electron/sse-manager.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/__tests__/**',
      ],
    },

    // 别名配置（与 vite.config.ts 保持一致）
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },

  // Vue 插件（用于 .vue 文件测试）
  plugins: [vue()],
})
