import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import path from 'path'
import { DEFAULT_VITE_ENV } from '../core/src/utils/default-env'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const monorepoRoot = resolve(__dirname, '../..')
  const env = loadEnv(mode, monorepoRoot)
  const processEnv = {
    ...DEFAULT_VITE_ENV,
    ...env,
  }

  return {
    envDir: monorepoRoot,
    plugins: [vue()],
    server: {
      // Development-only same-origin bridge for the Gemini-compatible LK888 endpoint.
      // The destination is fixed; no arbitrary upstream URL can be supplied by clients.
      // Forward the caller's existing x-goog-api-key instead of embedding any API key here.
      proxy: {
        '/api/ps-gemini': {
          target: 'https://api.lk888.ai',
          changeOrigin: true,
          secure: true,
          bypass: (req) => {
            const pathname = new URL(req.url || '/', 'http://localhost').pathname
              .replace(/^\/api\/ps-gemini/, '')
            const isModelList = req.method === 'GET' && pathname === '/v1beta/models'
            const isGeneration = req.method === 'POST'
              && /^\/v1beta\/models\/[a-zA-Z0-9._-]+:(?:generateContent|streamGenerateContent)$/.test(pathname)
            // Do not expose an unrestricted proxy to every endpoint at this host.
            if (!isModelList && !isGeneration) return false
          },
          rewrite: (url) => url.replace(/^\/api\/ps-gemini(?=\/|\?|$)/, ''),
        },
      },
      port: 18181,
      host: true,
      fs: {
        // 允许为工作区依赖提供服务
        allow: ['..']
      },
      hmr: true,
      watch: {
        // 确保监视monorepo中其他包的变化
        ignored: ['!**/node_modules/@prompt-optimizer/**']
      }
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html')
        }
      }
    },
    publicDir: 'public',
    resolve: {
      preserveSymlinks: true,
      alias: {
        '@': resolve(__dirname, 'src'),
        '@prompt-optimizer/core': path.resolve(__dirname, '../core'),
        '@prompt-optimizer/ui': path.resolve(__dirname, '../ui'),
        '@prompt-optimizer/web': path.resolve(__dirname, '../web'),
        '@prompt-optimizer/extension': path.resolve(__dirname, '../extension')
      }
    },
    define: {
      'process.env': {
        NODE_ENV: JSON.stringify(process.env.NODE_ENV || 'development'),
        ...Object.keys(processEnv).reduce((acc, key) => {
          acc[key] = processEnv[key as keyof typeof processEnv]
          return acc
        }, {} as Record<string, string>)
      }
    }
  }
})
