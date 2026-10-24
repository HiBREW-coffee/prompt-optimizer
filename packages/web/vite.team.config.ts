import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

// This build deliberately does not load the original app's VITE_* model settings.
export default defineConfig(() => {
  const url = process.env.VITE_TEAM_SUPABASE_URL || "";
  const publicKey = process.env.VITE_TEAM_SUPABASE_ANON_KEY || "";
  if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))
    throw new Error("Use the Supabase public project URL");
  if (publicKey.startsWith("sb_secret_"))
    throw new Error("A server secret cannot be used as a public key");
  if (publicKey.split(".").length === 3) {
    try {
      if (
        JSON.parse(Buffer.from(publicKey.split(".")[1], "base64url").toString())
          .role !== "anon"
      )
        throw new Error();
    } catch {
      throw new Error(
        "Use only the Supabase publishable/anon key in the frontend",
      );
    }
  } else if (publicKey && !publicKey.startsWith("sb_publishable_"))
    throw new Error("Use only the Supabase publishable/anon key");
  return {
    root: resolve(__dirname, "team"),
    envDir: false,
    envPrefix: "TEAM_UNUSED_",
    plugins: [vue()],
    define: {
      "import.meta.env.VITE_TEAM_SUPABASE_URL": JSON.stringify(url),
      "import.meta.env.VITE_TEAM_SUPABASE_ANON_KEY": JSON.stringify(publicKey),
    },
    build: {
      outDir: resolve(__dirname, "dist-team"),
      emptyOutDir: true,
      sourcemap: false,
    },
    server: { host: "127.0.0.1", port: 18182, strictPort: true },
  };
});
