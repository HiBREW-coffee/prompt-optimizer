import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
await mkdir(new URL("supabase/.temp/", root), { recursive: true });
await build({
  entryPoints: [
    fileURLToPath(
      new URL("supabase/functions/prompt-studio-api/index.ts", root),
    ),
  ],
  outfile: fileURLToPath(new URL("supabase/.temp/prompt-studio-api.ts", root)),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  plugins: [
    {
      name: "deno-supabase",
      setup(b) {
        b.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({
          path: "npm:@supabase/supabase-js@2.118.0",
          external: true,
        }));
      },
    },
  ],
  logLevel: "info",
  legalComments: "inline",
});
