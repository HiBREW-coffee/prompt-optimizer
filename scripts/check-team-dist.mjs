import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
const root = process.argv[2] || "packages/web/dist-team";
const files = [];
async function visit(path) {
  for (const d of await readdir(path, { withFileTypes: true })) {
    const p = join(path, d.name);
    if (d.isDirectory()) await visit(p);
    else files.push(p);
  }
}
await visit(root);
for (const file of files) {
  const text = await readFile(file, "utf8");
  // Model adapters/settings, private upstream keys and the original image-generation UI must not enter this artifact.
  for (const forbidden of [
    /PS_LK888_API_KEY/,
    /SUPABASE_SERVICE_ROLE_KEY/,
    /sb_secret_[a-zA-Z0-9]{10,}/,
    /api\.lk888\.ai/,
    /\/image\/(?:text2image|image2image|multiimage)/,
    /\/api\/ps-gemini/,
  ]) {
    if (forbidden.test(text))
      throw new Error(`Forbidden team bundle content: ${file}`);
  }
  if (file.endsWith(".map"))
    throw new Error("Production source maps must not be published");
}
if (!files.some((p) => p.endsWith("_headers")))
  throw new Error("Missing security headers");
console.log(`Team artifact verified (${files.length} files).`);
