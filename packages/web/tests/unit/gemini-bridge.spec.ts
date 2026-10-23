import { describe, expect, it } from 'vitest'
import type { ConfigEnv, UserConfig } from 'vite'
import createViteConfig from '../../vite.config'

const config = (createViteConfig as (env: ConfigEnv) => UserConfig)({
  mode: 'development',
  command: 'serve',
  isPreview: false,
  isSsrBuild: false,
} as ConfigEnv)
const proxy = config.server?.proxy?.['/api/ps-gemini']

if (!proxy || typeof proxy === 'string') {
  throw new Error('Gemini bridge proxy is missing')
}

const rewrite = proxy.rewrite
const bypass = proxy.bypass

describe('Gemini compatibility development bridge', () => {
  it('targets the fixed vendor rather than a user-supplied URL', () => {
    expect(proxy.target).toBe('https://api.lk888.ai')
    expect(proxy.changeOrigin).toBe(true)
    expect(proxy.secure).toBe(true)
  })

  it('strips only the same-origin development prefix', () => {
    expect(rewrite?.('/api/ps-gemini/v1beta/models/gem-3.8-flash:generateContent'))
      .toBe('/v1beta/models/gem-3.8-flash:generateContent')
  })

  it('accepts model-listing and generation requests', () => {
    expect(bypass?.({ method: 'GET', url: '/api/ps-gemini/v1beta/models' } as any, {} as any, {} as any))
      .toBeUndefined()
    expect(bypass?.({ method: 'POST', url: '/api/ps-gemini/v1beta/models/gem-3.8-flash:generateContent' } as any, {} as any, {} as any))
      .toBeUndefined()
  })

  it('rejects requests outside the allowed operations', () => {
    expect(bypass?.({ method: 'POST', url: '/api/ps-gemini/v1beta/files' } as any, {} as any, {} as any))
      .toBe(false)
    expect(bypass?.({ method: 'GET', url: '/api/ps-gemini/v1beta/models/gem-3.8-flash:generateContent' } as any, {} as any, {} as any))
      .toBe(false)
  })
})
