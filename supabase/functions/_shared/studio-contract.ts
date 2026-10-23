/** Portable contract shared by the team UI, Edge Function and transport tests. */
export type StudioMode = "text" | "reference";
export type AiAction =
  | "text.optimize"
  | "reference.extract"
  | "reference.rewrite"
  | "prompt.evaluate";
export interface PromptBundle {
  zh: string;
  en: string;
  structured: Record<string, unknown>;
  observations: string[];
  uncertainties: string[];
}
export interface PromptAnalysis {
  score: number;
  summary: string;
  dimensions: Array<{ name: string; score: number; reason: string }>;
  suggestions: Array<{
    id: string;
    title: string;
    instruction: string;
    reason: string;
  }>;
}
export interface StudioWorkspace {
  id: string;
  owner_id: string;
  title: string;
  mode: StudioMode;
  source_text: string;
  keep_text: string;
  change_text: string;
  reference_path: string | null;
  current_version_id: string | null;
  favorite: boolean;
}
export interface StudioVersion {
  id: string;
  workspace_id: string;
  sequence: number;
  parent_id: string | null;
  bundle: PromptBundle;
  context: Record<string, unknown>;
  kind: string;
  created_at: string;
}
export class StudioError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
export const AI_ACTIONS: AiAction[] = [
  "text.optimize",
  "reference.extract",
  "reference.rewrite",
  "prompt.evaluate",
];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 120_000;
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function requireId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value))
    throw new StudioError("INVALID_ID");
  return value;
}
export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function limitedText(value: unknown, max = 16_000): string {
  if (typeof value !== "string" || value.length > max)
    throw new StudioError("INVALID_TEXT");
  return value.trim();
}
function list(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 40 ||
    value.some((v) => typeof v !== "string" || v.length > 2000)
  ) {
    throw new StudioError("INVALID_MODEL_OUTPUT", 502);
  }
  return value as string[];
}
export function parseObject(raw: string): Record<string, unknown> {
  try {
    const result: unknown = JSON.parse(
      raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    );
    if (!record(result)) throw new Error();
    return result;
  } catch {
    throw new StudioError("INVALID_MODEL_OUTPUT", 502);
  }
}
export function normalizeBundle(value: unknown): PromptBundle {
  if (
    !record(value) ||
    typeof value.zh !== "string" ||
    typeof value.en !== "string" ||
    !value.zh.trim() ||
    !value.en.trim() ||
    value.zh.length > 30_000 ||
    value.en.length > 30_000 ||
    !record(value.structured) ||
    !Object.keys(value.structured).length ||
    JSON.stringify(value.structured).length > 40_000
  )
    throw new StudioError("INVALID_MODEL_OUTPUT", 502);
  return {
    zh: value.zh.trim(),
    en: value.en.trim(),
    structured: value.structured,
    observations: list(value.observations),
    uncertainties: list(value.uncertainties),
  };
}
export function normalizeAnalysis(value: unknown): PromptAnalysis {
  const score = (s: unknown) =>
    typeof s === "number" && Number.isFinite(s) && s >= 0 && s <= 100;
  if (
    !record(value) ||
    !score(value.score) ||
    typeof value.summary !== "string" ||
    value.summary.length > 4000 ||
    !Array.isArray(value.dimensions) ||
    value.dimensions.length < 1 ||
    value.dimensions.length > 10 ||
    !Array.isArray(value.suggestions) ||
    value.suggestions.length > 10
  )
    throw new StudioError("INVALID_MODEL_OUTPUT", 502);
  const dimensions = value.dimensions.map((d) => {
    if (
      !record(d) ||
      !score(d.score) ||
      typeof d.name !== "string" ||
      typeof d.reason !== "string" ||
      d.name.length > 100 ||
      d.reason.length > 2000
    )
      throw new StudioError("INVALID_MODEL_OUTPUT", 502);
    return { name: d.name, score: d.score as number, reason: d.reason };
  });
  const suggestions = value.suggestions.map((s, i) => {
    if (
      !record(s) ||
      typeof s.title !== "string" ||
      typeof s.instruction !== "string" ||
      typeof s.reason !== "string" ||
      s.title.length > 200 ||
      s.instruction.length > 2000 ||
      s.reason.length > 2000
    )
      throw new StudioError("INVALID_MODEL_OUTPUT", 502);
    return {
      id: String(i + 1),
      title: s.title,
      instruction: s.instruction,
      reason: s.reason,
    };
  });
  return {
    score: value.score as number,
    summary: value.summary,
    dimensions,
    suggestions,
  };
}
export function ownsImage(path: unknown, userId: string): path is string {
  return (
    typeof path === "string" &&
    new RegExp(`^${userId}/[a-f0-9-]+\\.(png|jpg|jpeg)$`, "i").test(path)
  );
}
export function imageMime(bytes: Uint8Array): "image/png" | "image/jpeg" {
  if (bytes.length > MAX_IMAGE_BYTES || bytes.length < 12)
    throw new StudioError("INVALID_IMAGE");
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b))
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  throw new StudioError("INVALID_IMAGE");
}
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (record(value))
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
