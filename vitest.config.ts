import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// 独立的 vitest 配置：不加载 vite.config.ts 中的 electron 插件
// （避免测试时触发 electron main 构建），仅保留测试所需的路径别名
const dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': path.join(dirname, 'src'),
      shared: path.join(dirname, 'shared'),
      // 与 vite.config.ts 中 electron main 构建的别名一致，供主进程单测解析 '#/xxx'
      '#': path.join(dirname, 'electron/main'),
    },
  },
  server: {
    // 沙箱等受限环境下 localhost DNS 可能不可用，固定回环地址
    host: '127.0.0.1',
  },
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.{ts,tsx}',
      'shared/**/*.test.{ts,tsx}',
      'electron/main/**/*.test.{ts,tsx}',
    ],
  },
})
