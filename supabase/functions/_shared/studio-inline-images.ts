import { MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES, StudioError, imageMime, record } from "./studio-contract.ts";
import type { ReferenceImage } from "./studio-contract.ts";
export interface InlineReference { path: string; data: string; mimeType: string; }
export async function inlineReferences(value: unknown, references: ReferenceImage[]) {
  const expected = references.filter(image => image.temporary);
  if (value === undefined && !expected.length) return new Map<string, InlineReference>();
  if (!Array.isArray(value) || value.length !== expected.length)
    throw new StudioError("REFERENCE_REUPLOAD_REQUIRED");
  const result = new Map<string, InlineReference>();
  let total = 0;
  for (const item of value) {
    if (!record(item) || typeof item.path !== "string" || typeof item.data !== "string" ||
        !["image/png", "image/jpeg"].includes(String(item.mimeType)) ||
        item.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
        item.data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(item.data))
      throw new StudioError("INVALID_IMAGE");
    const image = expected.find(reference => reference.path === item.path);
    if (!image || result.has(item.path)) throw new StudioError("INVALID_REFERENCE_IMAGES");
    let binary: string;
    try { binary = atob(item.data); } catch { throw new StudioError("INVALID_IMAGE"); }
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    total += bytes.length;
    if (total > MAX_TOTAL_IMAGE_BYTES) throw new StudioError("IMAGES_TOO_LARGE");
    if (imageMime(bytes) !== item.mimeType) throw new StudioError("INVALID_IMAGE");
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2,"0")).join("");
    if (digest !== image.digest) throw new StudioError("REFERENCE_FILE_MISMATCH");
    result.set(item.path, { path: item.path, data: item.data, mimeType: item.mimeType as string });
  }
  return result;
}

