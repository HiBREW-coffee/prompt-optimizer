# LK888 Gemini-compatible API in Codespaces (Prompt Studio)

This integration is **development-only**. It fixes browser CORS restrictions by
forwarding requests through the existing Vite dev server. It does not supply an
API key, provide free model access, change the model's capabilities, or bypass
provider authentication.

## Quick start

1. Use branch `feature/prompt-studio-design-templates-v1` in your Codespace.
2. Run `git pull --ff-only` and restart `pnpm dev` (Ctrl+C, then `pnpm dev`).
3. Open the forwarded **private** port **18181**.
4. Select **Model Manager → Google Gemini → Edit**.
5. Keep your existing API key; click **Use LK888 bridge**.
6. The preset sets **Base URL** to `https://<current-codespace-origin>/api/ps-gemini`
   and **Model ID** to `gem-3.8-flash`, following your vendor's documented Gemini
   compatibility endpoint. The user-visible name can be edited.
7. Click **Test connection**, then **Save** and select the model in the
   optimization workspace.

The development server forwards:
```
Browser (same origin):
  /api/ps-gemini/v1beta/models/gem-3.8-flash:generateContent
Vite -> fixed upstream:
  https://api.lk888.ai/v1beta/models/gem-3.8-flash:generateContent
```
The project's existing Gemini SDK still assembles `/v1beta/models/...`.
**Do not append `/v1beta` or `:generateContent` to the base URL field.**

## Connection passes, but optimization / prompt-quality evaluation returns 404

The connection test (`LLMService.testConnection`) calls the non-streaming
`GeminiAdapter.sendMessage` / SDK `models.generateContent` route. Interactive
optimization (`PromptService` streaming methods) and text quality evaluation
(`EvaluationService.evaluateStream` → `LLMService.sendMessageStream`) call SDK
`models.generateContentStream`. The actual installed SDK requests:

```
POST /api/ps-gemini/v1beta/models/gem-3.8-flash:streamGenerateContent?alt=sse
```

The development proxy allows this exact operation and preserves `alt=sse`.
A successful connection test therefore does not establish streaming support.
The reported symptoms are consistent with an upstream streaming route missing;
this has been reproduced with a simulated 404, not verified against a live account.

For the fixed `/api/ps-gemini` bridge (or the exact `https://api.lk888.ai` origin),
the Gemini adapter retries once using `generateContent` when streaming returns
HTTP **404, 405 or 501 before any response chunk**. It preserves the model ID,
contents, system instruction, parameters, image data and tools. Existing stream
callbacks receive the complete answer once, so optimization can finish and the
quality evaluator can parse its JSON normally. During fallback the answer appears
all at once after a wait. Healthy streaming continues unchanged.

There is no fallback for other providers, authentication failures, rate limits,
timeouts, cancellation, or a stream that has already yielded any chunk (including
metadata, reasoning or tools). A failed non-streaming request remains an error;
the adapter does not probe alternate models or hosts. If both routes return 404,
check the configured model ID and the vendor's route availability.

After pulling this change, restart `pnpm dev` to rebuild core/UI, reload the page,
save/select the LK888 model, then try optimization and prompt-quality evaluation.
The current origin must use the Vite development bridge; production deployments
still require their own server route. No API key is needed for the regression tests:

```
pnpm -F @prompt-optimizer/core exec vitest run tests/unit/llm tests/unit/evaluation tests/unit/template/prompt-studio-presets.test.ts
pnpm -F @prompt-optimizer/core typecheck
pnpm -F @prompt-optimizer/core build
pnpm -F @prompt-optimizer/web exec vitest run tests/unit/gemini-bridge.spec.ts
```

## Security / deployment notes

- Keep Codespaces port **18181 private**. The API key is still configured in the
  browser-side model manager; it is not embedded in the GitHub repository or
  baked into Vite. Requests pass through the Codespaces instance.
- This Vite proxy is **not deployed by `pnpm build`**. For a public Vercel,
  Cloudflare, or other deployment, implement a corresponding authenticated
  same-origin server route (plus request limits) before enabling this preset.
- The proxy target is intentionally fixed to `https://api.lk888.ai` to avoid
  turning your site into a general open proxy.
- If the request returns 401/403 after using the bridge, confirm the upstream
  API key and account access locally, without sharing the key. If both generation
  routes return 404, verify the model ID. If the
  upstream connection times out, check Codespaces network reachability.
- Only use API keys provided to you by the vendor. Do not paste secrets into
  chat or commit `.env` with credentials.
