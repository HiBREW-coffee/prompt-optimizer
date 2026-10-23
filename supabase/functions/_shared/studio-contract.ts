/** Portable contract shared by the team UI, Edge Function and transport tests. */
export type StudioMode = "text" | "reference";
export type AiAction =
  | "prompt.inspect"
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
  report?: ProfessionalReport;
}
export type ReferenceRole =
  | "auto"
  | "product"
  | "scene"
  | "person"
  | "style"
  | "detail";
export interface ReferenceImage {
  path: string;
  role: ReferenceRole;
  note: string;
}
export type ReferenceIntent = "replicate" | "style" | "inspiration";
export const TEMPLATE_IDS = [
  "ecommerce",
  "photography",
  "identity",
  "multiimage",
  "lighting",
  "structured",
  "general",
] as const;
export interface ReportItem {
  title: string;
  content: string;
}
export interface ProfessionalReport {
  intent: string;
  imageRoles: Array<{
    index: number;
    role: string;
    evidence: string;
    use: string;
  }>;
  anchors: ReportItem[];
  changes: ReportItem[];
  sections: ReportItem[];
  negative: { zh: string; en: string };
  parameters: Array<{ name: string; value: string; reason: string }>;
  checks: string[];
}
export interface PromptAnalysis {
  score: number;
  // Absent on legacy records: never infer a scale from a small numeric value.
  scoreScale?: 100;
  summary: string;
  dimensions: Array<{ name: string; score: number; reason: string }>;
  suggestions: Array<{
    id: string;
    title: string;
    instruction: string;
    reason: string;
  }>;
  structure?: ReportItem[];
  anchors?: ReportItem[];
  conflicts?: string[];
  imageRoles?: ProfessionalReport["imageRoles"];
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
  reference_images?: ReferenceImage[];
  intent?: ReferenceIntent;
  template_id?: string;
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
  "prompt.inspect",
  "text.optimize",
  "reference.extract",
  "reference.rewrite",
  "prompt.evaluate",
];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_REFERENCE_IMAGES = 5;
export const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;
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
  const bundle: PromptBundle = {
    zh: value.zh.trim(),
    en: value.en.trim(),
    structured: value.structured,
    observations: list(value.observations),
    uncertainties: list(value.uncertainties),
    ...(value.report === undefined
      ? {}
      : { report: normalizeReport(value.report) }),
  };
  if (new TextEncoder().encode(JSON.stringify(bundle)).byteLength > 115000)
    throw new StudioError("INVALID_MODEL_OUTPUT", 502);
  return bundle;
}
export function normalizeAnalysis(
  value: unknown,
  options: { requireScale?: boolean } = {},
): PromptAnalysis {
  if (!record(value)) throw new StudioError("INVALID_MODEL_OUTPUT", 502);
  const scale = value.scoreScale;
  if (
    (scale !== undefined && scale !== 10 && scale !== 100) ||
    (options.requireScale && scale === undefined)
  )
    throw new StudioError("INVALID_SCORE_SCALE", 502);
  const score = (s: unknown) =>
    typeof s === "number" &&
    Number.isFinite(s) &&
    s >= 0 &&
    s <= (scale ?? 100) &&
    (scale !== 100 || Number.isInteger(s));
  const normalizedScore = (s: number) =>
    scale === undefined ? s : Math.round((s * 100) / scale);
  const invalidScore = () =>
    new StudioError(
      scale === undefined ? "INVALID_MODEL_OUTPUT" : "INVALID_SCORE_SCALE",
      502,
    );
  if (!score(value.score)) throw invalidScore();
  if (
    !record(value) ||
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
    if (!record(d)) throw new StudioError("INVALID_MODEL_OUTPUT", 502);
    if (!score(d.score)) throw invalidScore();
    if (
      !record(d) ||
      typeof d.name !== "string" ||
      typeof d.reason !== "string" ||
      d.name.length > 100 ||
      d.reason.length > 2000
    )
      throw new StudioError("INVALID_MODEL_OUTPUT", 502);
    return {
      name: d.name,
      score: normalizedScore(d.score as number),
      reason: d.reason,
    };
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
    score: normalizedScore(value.score as number),
    ...(scale === undefined ? {} : { scoreScale: 100 as const }),
    summary: value.summary,
    dimensions,
    suggestions,
    ...(value.structure === undefined
      ? {}
      : { structure: reportItems(value.structure) }),
    ...(value.anchors === undefined
      ? {}
      : { anchors: reportItems(value.anchors) }),
    ...(value.conflicts === undefined
      ? {}
      : { conflicts: list(value.conflicts) }),
    ...(value.imageRoles === undefined
      ? {}
      : { imageRoles: imageRoles(value.imageRoles) }),
  };
}

function reportItems(value: unknown): ReportItem[] {
  if (!Array.isArray(value) || value.length > 16)
    throw new StudioError("INVALID_MODEL_OUTPUT", 502);
  return value.map((item) => {
    if (
      !record(item) ||
      typeof item.title !== "string" ||
      typeof item.content !== "string" ||
      item.title.length > 160 ||
      item.content.length > 4000
    )
      throw new StudioError("INVALID_MODEL_OUTPUT", 502);
    return { title: item.title, content: item.content };
  });
}
function imageRoles(value: unknown): ProfessionalReport["imageRoles"] {
  if (!Array.isArray(value) || value.length > MAX_REFERENCE_IMAGES)
    throw new StudioError("INVALID_MODEL_OUTPUT", 502);
  const seen = new Set<number>();
  return value.map((item) => {
    if (
      !record(item) ||
      !Number.isInteger(item.index) ||
      Number(item.index) < 1 ||
      Number(item.index) > 5 ||
      seen.has(Number(item.index))
    )
      throw new StudioError("INVALID_MODEL_OUTPUT", 502);
    seen.add(Number(item.index));
    for (const key of ["role", "evidence", "use"])
      if (typeof item[key] !== "string" || (item[key] as string).length > 3000)
        throw new StudioError("INVALID_MODEL_OUTPUT", 502);
    return {
      index: Number(item.index),
      role: item.role as string,
      evidence: item.evidence as string,
      use: item.use as string,
    };
  });
}
export function normalizeReport(value: unknown): ProfessionalReport {
  if (
    !record(value) ||
    typeof value.intent !== "string" ||
    value.intent.length > 4000 ||
    !record(value.negative) ||
    typeof value.negative.zh !== "string" ||
    typeof value.negative.en !== "string" ||
    value.negative.zh.length > 4000 ||
    value.negative.en.length > 4000 ||
    !Array.isArray(value.parameters) ||
    value.parameters.length > 12
  )
    throw new StudioError("INVALID_MODEL_OUTPUT", 502);
  const parameters = value.parameters.map((item) => {
    if (
      !record(item) ||
      ["name", "value", "reason"].some(
        (key) =>
          typeof item[key] !== "string" || (item[key] as string).length > 2000,
      )
    )
      throw new StudioError("INVALID_MODEL_OUTPUT", 502);
    return {
      name: item.name as string,
      value: item.value as string,
      reason: item.reason as string,
    };
  });
  return {
    intent: value.intent,
    imageRoles: imageRoles(value.imageRoles),
    anchors: reportItems(value.anchors),
    changes: reportItems(value.changes),
    sections: reportItems(value.sections),
    negative: { zh: value.negative.zh, en: value.negative.en },
    parameters,
    checks: list(value.checks),
  };
}
export function normalizeReferences(
  value: unknown,
  user: string,
): ReferenceImage[] {
  if (!Array.isArray(value) || value.length > MAX_REFERENCE_IMAGES)
    throw new StudioError("INVALID_REFERENCE_IMAGES");
  const seen = new Set<string>();
  return value.map((item) => {
    if (
      !record(item) ||
      !ownsImage(item.path, user) ||
      seen.has(item.path) ||
      !["auto", "product", "scene", "person", "style", "detail"].includes(
        String(item.role),
      )
    )
      throw new StudioError("INVALID_REFERENCE_IMAGES");
    seen.add(item.path);
    return {
      path: item.path,
      role: item.role as ReferenceRole,
      note: limitedText(item.note, 1000),
    };
  });
}
export function workspaceReferences(
  workspace: StudioWorkspace,
): ReferenceImage[] {
  return workspace.reference_images?.length
    ? workspace.reference_images
    : workspace.reference_path
      ? [{ path: workspace.reference_path, role: "auto", note: "" }]
      : [];
}
export function workspaceContext(workspace: StudioWorkspace) {
  return {
    source: workspace.source_text,
    keep: workspace.keep_text,
    change: workspace.change_text,
    reference_path: workspace.reference_path,
    reference_images: workspaceReferences(workspace),
    intent: workspace.intent ?? "replicate",
    template_id: workspace.template_id ?? "ecommerce",
  };
}
export function validateReferenceMentions(text: string, count: number) {
  for (const match of text.matchAll(/(?:图\s*|\bimage\s*)(\d+)/gi)) {
    const index = Number(match[1]);
    if (index < 1 || index > count)
      throw new StudioError("REFERENCE_INDEX_MISSING");
  }
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
