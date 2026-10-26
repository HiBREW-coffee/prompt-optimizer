// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { SupabaseStudioStore } from "../../../../supabase/functions/_shared/studio-store";
import { isMemberUsageReport } from "../../../../supabase/functions/_shared/studio-usage";

function harness() {
  const settings = { member_daily: 0, team_daily: 0, user_concurrent: 1, team_concurrent: 2 };
  const queries = new Map<string, any>();
  const db = { from: vi.fn((table: string) => {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      gte: vi.fn().mockResolvedValue({ count: 72, error: null }),
      single: vi.fn().mockResolvedValue({
        data: table === "ps_settings" ? settings : { daily_limit: null }, error: null,
      }),
    };
    queries.set(table, query);
    return query;
  }) };
  const store = new SupabaseStudioStore(db as any, "https://studio.example", true);
  return { db, queries, settings, store };
}
describe("application usage controls", () => {
  it("exposes only aggregate report data through an administrator-only service RPC", async () => {
    const report = { period: 'today', from: '2026-10-25T16:00:00Z', asOf: '2026-10-26T08:00:00Z', timeZone: 'Asia/Shanghai', members: [] };
    const db = { rpc: vi.fn().mockResolvedValue({ data: report, error: null }) };
    const store = new SupabaseStudioStore(db as any,'https://studio.example',true);
    await expect(store.command('member',false,'member.usage',{ period: 'today' })).rejects.toThrow('FORBIDDEN');
    expect(db.rpc).not.toHaveBeenCalled();
    expect(await store.command('admin',true,'member.usage',{})).toEqual(report);
    expect(db.rpc).toHaveBeenCalledWith('ps_member_usage',{ p_admin: 'admin', p_period: 'today' });
    await expect(store.command('admin',true,'member.usage',{ period: 'unbounded sql' })).rejects.toThrow('INVALID_REQUEST');
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed or inconsistent reports instead of presenting false zero counts", () => {
    const member = { userId: 'test', requests: 5, generations: 3, generationSucceeded: 1, generationFailed: 1, generationRunning: 1, polish: 1, analysis: 1, lastRequestAt: null };
    const report = { period: 'today', from: '2026-10-25T16:00:00Z', asOf: '2026-10-26T08:00:00Z', timeZone: 'Asia/Shanghai', members: [member] };
    expect(isMemberUsageReport(report)).toBe(true);
    for (const invalid of [null,{}, { ...report, members: [member,member] }, { ...report, asOf: 'bad' },
      { ...report, members: [{...member,polish:-1}] }, { ...report, members: [{...member,generationRunning:0}] },
      { ...report, members: [{...member,requests:4}] }]) expect(isMemberUsageReport(invalid)).toBe(false);
  });
  it("returns member availability without fetching or exposing request statistics", async () => {
    const h = harness();
    const result = await h.store.command("member", false, "status", {});
    expect(result).toMatchObject({ configured: true, used: 0, dailyLimit: 0 });
    expect(h.db.from).not.toHaveBeenCalled();
  });
  it("retains administrator counts while zero means unlimited", async () => {
    const h = harness();
    expect(await h.store.command("admin", true, "status", {}))
      .toMatchObject({ used: 72, dailyLimit: 0, settings: h.settings });
    expect(h.queries.get("ps_requests").eq).toHaveBeenCalledWith("owner_id", "admin");
  });
  it("lets administrators disable daily caps but not concurrency protection", async () => {
    const h = harness();
    expect(await h.store.command("admin", true, "settings.update", { settings: h.settings })).toEqual({ ok: true });
    expect(h.queries.get("ps_settings").update).toHaveBeenCalledWith(h.settings);
    await expect(h.store.command("admin", true, "settings.update", {
      settings: { ...h.settings, user_concurrent: 0 },
    })).rejects.toThrow("INVALID_REQUEST");
    await expect(h.store.command("admin", true, "settings.update", {
      settings: { ...h.settings, team_daily: -1 },
    })).rejects.toThrow("INVALID_REQUEST");
  });
  it("does not allow a member to change application caps", async () => {
    const h = harness();
    await expect(h.store.command("member", false, "settings.update", { settings: h.settings })).rejects.toThrow("FORBIDDEN");
    expect(h.db.from).not.toHaveBeenCalled();
  });
});
