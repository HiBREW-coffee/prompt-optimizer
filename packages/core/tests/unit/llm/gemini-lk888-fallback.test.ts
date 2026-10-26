import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiAdapter } from '../../../src/services/llm/adapters/gemini-adapter'
import type { StreamHandlers, TextModelConfig } from '../../../src/services/llm/types'
import { EvaluationService } from '../../../src/services/evaluation/service'

const adapter = new GeminiAdapter()
const config = (baseURL = 'https://studio.example/api/ps-gemini'): TextModelConfig => ({
  id: 'lk888', name: 'LK888', enabled: true,
  providerMeta: adapter.getProvider(), modelMeta: adapter.buildDefaultModel('gem-3.8-flash'),
  connectionConfig: { baseURL, apiKey: 'synthetic-test-key' }, paramOverrides: { maxOutputTokens: 128 },
})
const messages = [{ role: 'system' as const, content: 'Preserve identity' }, { role: 'user' as const, content: 'Improve this prompt' }]
const handlers = (): StreamHandlers => ({ onToken: vi.fn(), onReasoningToken: vi.fn(), onToolCall: vi.fn(), onComplete: vi.fn(), onError: vi.fn() })
const payload = { candidates: [{ content: { role: 'model', parts: [{ text: 'Better prompt' }] }, finishReason: 'STOP' }] }

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

// Use the actual installed SDK with an in-memory transport, never a provider key.
describe('LK888 actual Gemini SDK transport', () => {
  it('keeps healthy SSE streaming without sending a non-streaming request', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify(payload)}\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    vi.stubGlobal('fetch', fetch)
    const cb = handlers()
    await adapter.sendMessageStream(messages, config(), cb)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(cb.onToken).toHaveBeenCalledExactlyOnceWith('Better prompt')
    expect(cb.onComplete).toHaveBeenCalledTimes(1)
    expect(cb.onError).not.toHaveBeenCalled()
  })

  it('completes prompt-quality evaluation and parses fallback JSON through EvaluationService', async () => {
    const result = JSON.stringify({ score: { overall: 88, dimensions: [{ key: 'clarity', label: 'Clarity', score: 88 }] }, improvements: ['Be specific'], summary: 'Clear', patchPlan: [] })
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: 404, message: 'unsupported stream' } }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: result }] } }] }))
    vi.stubGlobal('fetch', fetch)
    const model = config()
    const service = new EvaluationService({
      sendMessageStream: (input: any, _key: string, cb: StreamHandlers) => adapter.sendMessageStream(input, model, cb),
    } as any, { getModel: async () => model } as any, { getTemplate: async () => ({
      id: 'evaluation-basic-system-prompt-only', content: messages,
    }) } as any)
    const cb = { onToken: vi.fn(), onComplete: vi.fn(), onError: vi.fn() }
    await service.evaluateStream({ type: 'prompt-only', target: { workspacePrompt: 'Improve this prompt' }, evaluationModelKey: model.id, mode: { functionMode: 'basic', subMode: 'system' } }, cb)
    expect(cb.onError).not.toHaveBeenCalled()
    expect(cb.onToken).toHaveBeenCalledExactlyOnceWith(result)
    expect(cb.onComplete).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ score: expect.objectContaining({ overall: 88 }) }))
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('uses :streamGenerateContent?alt=sse then retries :generateContent with the identical body', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: 404, message: 'unsupported stream' } }, { status: 404 }))
      .mockResolvedValueOnce(Response.json(payload))
    vi.stubGlobal('fetch', fetch)
    const cb = handlers()
    await adapter.sendMessageStream(messages, config(), cb)
    expect(fetch).toHaveBeenCalledTimes(2)
    const first = new URL(String(fetch.mock.calls[0][0]))
    const second = new URL(String(fetch.mock.calls[1][0]))
    expect(first.pathname).toBe('/api/ps-gemini/v1beta/models/gem-3.8-flash:streamGenerateContent')
    expect(first.searchParams.get('alt')).toBe('sse')
    expect(second.pathname).toBe('/api/ps-gemini/v1beta/models/gem-3.8-flash:generateContent')
    expect(second.searchParams.has('alt')).toBe(false)
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body)
    expect(cb.onToken).toHaveBeenCalledExactlyOnceWith('Better prompt')
    expect(cb.onComplete).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ content: 'Better prompt' }))
    expect(cb.onError).not.toHaveBeenCalled()
  })
})

describe('LK888 fallback safety and callback contract', () => {
  const mockClient = (status: number, baseURL?: string) => {
    const instance = new GeminiAdapter()
    const error = Object.assign(new Error('synthetic transport failure'), { status })
    const generateContent = vi.fn().mockResolvedValue(payload)
    const generateContentStream = vi.fn().mockRejectedValue(error)
    vi.spyOn(instance as any, 'createClient').mockReturnValue({ models: { generateContent, generateContentStream } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    return { instance, error, generateContent, generateContentStream, model: config(baseURL) }
  }

  it.each([404, 405, 501])('retries only once for unsupported stream status %s', async (status) => {
    const { instance, model, generateContent, generateContentStream } = mockClient(status)
    await instance.sendMessageStream(messages, model, handlers())
    expect(generateContent).toHaveBeenCalledTimes(1)
    expect(generateContent.mock.calls[0]).toEqual(generateContentStream.mock.calls[0])
  })

  it.each([400, 401, 403, 408, 429, 500, 503, undefined])('does not retry status %s', async (status) => {
    const { instance, model, error, generateContent } = mockClient(status as number)
    const cb = handlers()
    await expect(instance.sendMessageStream(messages, model, cb)).rejects.toBe(error)
    expect(generateContent).not.toHaveBeenCalled()
    expect(cb.onError).toHaveBeenCalledExactlyOnceWith(error)
    expect(cb.onComplete).not.toHaveBeenCalled()
  })

  it.each(['https://generativelanguage.googleapis.com', 'https://other.example', 'https://api.lk888.ai.evil.example', 'https://studio.example/api/ps-gemini-other'])('does not change other endpoints: %s', async (baseURL) => {
    const { instance, model, error, generateContent } = mockClient(404, baseURL)
    await expect(instance.sendMessageStream(messages, model, handlers())).rejects.toBe(error)
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('supports the direct fixed LK888 origin', async () => {
    const { instance, model, generateContent } = mockClient(404, 'https://api.lk888.ai')
    await instance.sendMessageStream(messages, model, handlers())
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it.each([{ text: 'partial' }, { thought: true, text: 'thinking' }, {}])('never retries after any yielded chunk: %j', async (part) => {
    const { instance, model, error, generateContent, generateContentStream } = mockClient(404)
    generateContentStream.mockResolvedValue((async function* () {
      yield { candidates: [{ content: { parts: [part] } }] }
      throw error
    })())
    await expect(instance.sendMessageStream(messages, model, handlers())).rejects.toBe(error)
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('propagates a failed fallback once without completion or recursion', async () => {
    const { instance, model, generateContent } = mockClient(404)
    const error = new Error('fallback failed')
    generateContent.mockRejectedValue(error)
    const cb = handlers()
    await expect(instance.sendMessageStream(messages, model, cb)).rejects.toBe(error)
    expect(cb.onError).toHaveBeenCalledExactlyOnceWith(error)
    expect(cb.onComplete).not.toHaveBeenCalled()
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it('keeps tool declarations and emits tool calls and reasoning from the fallback', async () => {
    const { instance, model, generateContent } = mockClient(404)
    generateContent.mockResolvedValue({ ...payload, functionCalls: [{ id: 'tool1', name: 'inspect', args: { x: 1 } }],
      candidates: [{ content: { parts: [{ thought: true, text: 'reason' }, { text: 'answer' }] } }], text: 'answer' })
    const cb = handlers()
    await instance.sendMessageStreamWithTools(messages, model, [{ type: 'function', function: { name: 'inspect', description: 'Inspect', parameters: { type: 'object', properties: {} } } }], cb)
    expect(generateContent.mock.calls[0][0].config.tools).toHaveLength(1)
    expect(cb.onToolCall).toHaveBeenCalledTimes(1)
    expect(cb.onReasoningToken).toHaveBeenCalledWith('reason')
    expect(cb.onComplete).toHaveBeenCalledTimes(1)
  })

  it('preserves image input and JSON response format', async () => {
    const { instance, model, generateContent } = mockClient(404)
    const cb = handlers()
    await instance.sendImageUnderstandingStream({ userPrompt: 'Evaluate', images: [{ b64: 'eA==', mimeType: 'image/png' }], responseMimeType: 'application/json' }, model, cb)
    expect(generateContent.mock.calls[0][0].contents[0].parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: 'eA==' } })
    expect(generateContent.mock.calls[0][0].config.responseMimeType).toBe('application/json')
    expect(cb.onComplete).toHaveBeenCalledTimes(1)
  })
})
