export const USAGE_PERIODS = ["today", "7d", "30d", "all"] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];
export interface MemberUsage {
  userId: string;
  requests: number;
  generations: number;
  generationSucceeded: number;
  generationFailed: number;
  generationRunning: number;
  polish: number;
  analysis: number;
  lastRequestAt: string | null;
}
export interface MemberUsageReport {
  period: UsagePeriod;
  from: string | null;
  asOf: string;
  timeZone: "Asia/Shanghai";
  members: MemberUsage[];
}

export function isMemberUsageReport(value: unknown): value is MemberUsageReport {
  if (!value || typeof value !== "object") return false;
  const report = value as MemberUsageReport;
  if (!USAGE_PERIODS.includes(report.period) || report.timeZone !== "Asia/Shanghai" ||
    !Number.isFinite(Date.parse(report.asOf)) || !Array.isArray(report.members) ||
    (report.period === "all" ? report.from !== null : !Number.isFinite(Date.parse(report.from ?? "")))) return false;
  const ids = new Set<string>();
  return report.members.every((entry) => {
    if (!entry || typeof entry.userId !== "string" || ids.has(entry.userId)) return false;
    ids.add(entry.userId);
    const counts = [entry.requests, entry.generations, entry.generationSucceeded, entry.generationFailed,
      entry.generationRunning, entry.polish, entry.analysis];
    return counts.every((count) => Number.isSafeInteger(count) && count >= 0) &&
      entry.generations === entry.generationSucceeded + entry.generationFailed + entry.generationRunning &&
      entry.requests === entry.generations + entry.polish + entry.analysis &&
      (entry.lastRequestAt === null || Number.isFinite(Date.parse(entry.lastRequestAt)));
  });
}
