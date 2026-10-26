/**
 * Prompt Studio's deterministic, text-only integrity hints.
 * This utility cannot establish semantic preservation or visual fidelity.
 */
export type LiteralConstraintKind = 'variable' | 'ratio' | 'measurement' | 'quoted'

export interface LiteralConstraintCheck {
  kind: LiteralConstraintKind
  value: string
  present: boolean
}

export interface PromptConstraintReview {
  literalChecks: LiteralConstraintCheck[]
  manualClauses: string[]
}

const MAX_LITERAL_CHECKS = 40
const MAX_MANUAL_CLAUSES = 12

const literalPatterns: Array<{ kind: LiteralConstraintKind; regex: RegExp }> = [
  { kind: 'variable', regex: /\{\{[^{}\n]{1,80}\}\}/gu },
  { kind: 'ratio', regex: /\b\d{1,5}\s*[:：]\s*\d{1,5}\b/gu },
  { kind: 'measurement', regex: /\b\d+(?:\.\d+)?\s*(?:mm|cm|ml|bar|px|dpi|rpm|°C|°F|kW|MPa|W|V|Hz)\b/giu },
  { kind: 'quoted', regex: /[“「『"]([^”」』"\n]{1,64})[”」』"]/gu },
]

// Imperatives and prohibitions require human semantic review; exact words alone
// cannot prove that a rewritten prompt still enforces the same instruction.
const manualClausePattern = /(?:必须|不得|禁止|不要|不能|避免|不允许|只允许|保持|保留)[^，。；;\n]{1,42}/gu

const normalized = (value: string): string =>
  value.normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase()

export function reviewPromptConstraints(original: string, optimized: string): PromptConstraintReview {
  if (!original.trim() || !optimized.trim()) {
    return { literalChecks: [], manualClauses: [] }
  }

  const source = normalized(optimized)
  const seen = new Set<string>()
  const literalChecks: LiteralConstraintCheck[] = []

  for (const { kind, regex } of literalPatterns) {
    for (const match of original.matchAll(regex)) {
      const value = (kind === 'quoted' ? match[1] : match[0])?.trim()
      if (!value) continue
      const key = `${kind}:${normalized(value)}`
      if (seen.has(key)) continue
      seen.add(key)
      literalChecks.push({ kind, value, present: source.includes(normalized(value)) })
      if (literalChecks.length >= MAX_LITERAL_CHECKS) break
    }
    if (literalChecks.length >= MAX_LITERAL_CHECKS) break
  }

  const manualClauses: string[] = []
  const manualSeen = new Set<string>()
  for (const match of original.matchAll(manualClausePattern)) {
    const clause = match[0].trim()
    const key = normalized(clause)
    if (manualSeen.has(key)) continue
    manualSeen.add(key)
    manualClauses.push(clause)
    if (manualClauses.length >= MAX_MANUAL_CLAUSES) break
  }

  return { literalChecks, manualClauses }
}
