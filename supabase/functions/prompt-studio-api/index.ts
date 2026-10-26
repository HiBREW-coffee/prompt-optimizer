import { createClient } from "@supabase/supabase-js";
import { createStudioHandler } from "../_shared/studio-handler.ts";
import { SupabaseStudioStore } from "../_shared/studio-store.ts";
import { generateStudioJson } from "../_shared/studio-gemini.ts";
import { StudioError } from "../_shared/studio-contract.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const key = Deno.env.get("PS_LK888_API_KEY") ?? "";
const model = Deno.env.get("PS_LK888_MODEL") || "gem-3.8-flash";
const appUrl = Deno.env.get("PS_APP_URL") ?? "";
const allowedOrigins = new Set(
  (Deno.env.get("PS_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
if (appUrl) allowedOrigins.add(new URL(appUrl).origin);
const handler = createStudioHandler({
  allowedOrigins,
  createStore: (signal) => {
    const client = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.any([
              signal,
              ...(init?.signal ? [init.signal] : []),
            ]),
          }),
      },
    });
    const store = new SupabaseStudioStore(
      client,
      appUrl,
      Boolean(key && model),
    );
    // Cleanup should survive the request deadline, while every normal call shares its deadline.
    store.fail = (id, user, code) =>
      new SupabaseStudioStore(
        createClient(url, service, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            fetch: (input, init) =>
              fetch(input, { ...init, signal: AbortSignal.timeout(5000) }),
          },
        }),
        appUrl,
        Boolean(key),
      ).fail(id, user, code);
    return store;
  },
  generate: (input, signal) => {
    if (!key) throw new StudioError("MODEL_NOT_CONFIGURED", 503);
    return generateStudioJson(input, { key, model, signal });
  },
});
Deno.serve(handler);
