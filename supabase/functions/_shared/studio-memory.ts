import { StudioError, record, requireId, TEMPLATE_IDS } from "./studio-contract.ts";
import type { StudioMode } from "./studio-contract.ts";

export interface MemoryRule {
  id: string;
  title: string;
  rule: string;
  scope: "all" | StudioMode;
  template: string;
}
export interface StudioMemory {
  enabled: boolean;
  rules: MemoryRule[];
}
export const MAX_MEMORY_BYTES = 16 * 1024;
export function normalizeMemory(value: unknown): StudioMemory {
  if (!record(value) || typeof value.enabled !== "boolean" ||
      !Array.isArray(value.rules) || value.rules.length > 12)
    throw new StudioError("INVALID_MEMORY");
  const ids = new Set<string>(), instructions = new Set<string>();
  const rules = value.rules.map((item): MemoryRule => {
    if (!record(item) || typeof item.title !== "string" || typeof item.rule !== "string" ||
        !["all", "text", "reference"].includes(String(item.scope)) ||
        typeof item.template !== "string" ||
        (item.template !== "" && !TEMPLATE_IDS.includes(item.template as typeof TEMPLATE_IDS[number])))
      throw new StudioError("INVALID_MEMORY");
    const id = requireId(item.id), title = item.title.trim(), rule = item.rule.trim();
    if (!title || title.length > 60 || !rule || rule.length > 280 || ids.has(id))
      throw new StudioError("INVALID_MEMORY");
    const signature = rule.replace(/\s+/g, " ").toLowerCase();
    if (instructions.has(signature)) throw new StudioError("DUPLICATE_MEMORY");
    ids.add(id); instructions.add(signature);
    return { id, title, rule, scope: item.scope as MemoryRule["scope"], template: item.template };
  });
  const memory = { enabled: value.enabled, rules };
  if (new TextEncoder().encode(JSON.stringify(memory)).length > MAX_MEMORY_BYTES)
    throw new StudioError("MEMORY_TOO_LARGE");
  return memory;
}
export function applicableMemory(memory: StudioMemory, mode: StudioMode, template: string): MemoryRule[] {
  if (!memory.enabled) return [];
  return memory.rules.filter(item =>
    (item.scope === "all" || item.scope === mode) &&
    (item.template === "" || item.template === template)
  ).slice(0, 4);
}

