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
  API key and account access. If it returns 404, verify the model ID. If the
  upstream connection times out, check Codespaces network reachability.
- Only use API keys provided to you by the vendor. Do not paste secrets into
  chat or commit `.env` with credentials.
