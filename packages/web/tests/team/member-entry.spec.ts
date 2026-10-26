import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  getSession: vi.fn(), rows: vi.fn(), call: vi.fn(), signOut: vi.fn(),
  listener: undefined as undefined | ((event: string, session: any) => void),
  members: [] as any[],
}));
vi.mock("../../team/api", () => ({
  db: { auth: {
    getSession: f.getSession,
    onAuthStateChange: (listener: typeof f.listener) => { f.listener = listener; return { data: { subscription: { unsubscribe: vi.fn() } } }; },
    signOut: f.signOut,
  } },
  rows: f.rows, call: f.call, uploadImage: vi.fn(), signedImage: vi.fn(),
  download: vi.fn(), exportPrivateData: vi.fn(), originalReferenceFile: vi.fn(),
  message: (error: Error) => error.message, needsPassword: false,
  SOURCE_URL: "https://github.com/HiBREW-coffee/prompt-optimizer/tree/feature/prompt-studio-design-templates-v1",
}));
import App from "../../team/App.vue";

const adminId = "11111111-1111-4111-8111-111111111111";
const memberId = "33333333-3333-4333-8333-333333333333";
const status = { configured: true, settings: { member_daily: 0, team_daily: 0, user_concurrent: 1, team_concurrent: 2 }, used: 0, dailyLimit: 0 };
function report(period = 'today', count = 0) {
  return { period, from: period === 'all' ? null : '2026-10-25T16:00:00Z', asOf: '2026-10-26T08:00:00Z', timeZone: 'Asia/Shanghai',
    members: f.members.map((m) => ({ userId: m.user_id, requests: count+5, generations: count+2, generationSucceeded: count+1,
      generationFailed: 1, generationRunning: 0, polish: 1, analysis: 2, lastRequestAt: '2026-10-26T07:00:00Z' })) };
}
function queryOwner(configure: any): string | undefined {
  const query = { eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis() };
  configure?.(query);
  return query.eq.mock.calls.find(([field]) => field === "user_id")?.[1];
}
const wrappers: VueWrapper[] = [];
async function ready() { const w = mount(App); wrappers.push(w); await flushPromises(); return w; }
function button(w: VueWrapper, name: string) {
  const found = w.findAll("button").find((b) => b.text() === name);
  if (!found) throw new Error(`Missing button ${name}`);
  return found;
}
function identity(id: string | null, event = id ? "SIGNED_IN" : "SIGNED_OUT") {
  f.listener?.(event, id ? { user: { id } } : null);
}
function expectMemberEditor(w: VueWrapper) {
  expect(w.find(".reference-board").exists()).toBe(true);
  expect(w.get(".topbar").text()).toContain("design001");
  expect(w.find(".admin-grid").exists()).toBe(false);
  expect(w.text()).not.toContain("TEAM SETTINGS");
  expect(w.text()).not.toContain("添加成员");
  expect(w.text()).not.toContain("请求统计与可选上限");
  expect(w.findAll("button").some((b) => b.text() === "团队管理")).toBe(false);
}
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  f.members = [
    { user_id: adminId, email: "owner@example.com", role: "admin", active: true },
    { user_id: memberId, email: "design001@accounts.dongwu.invalid", role: "member", active: true },
  ];
  f.getSession.mockResolvedValue({ data: { session: { user: { id: adminId } } } });
  f.rows.mockImplementation(async (table: string, configure: any) => {
    if (table !== "ps_members") return [];
    const owner = queryOwner(configure);
    return owner ? f.members.filter((m) => m.user_id === owner) : f.members;
  });
  f.call.mockImplementation(async (action: string, body: any) => action === "status" ? status : action === "memory.get" ? { enabled: false, rules: [] } : action === 'member.usage' ? report(body.period) : { ok: true });
  f.signOut.mockImplementation(async () => { identity(null); return { error: null }; });
});
afterEach(() => { wrappers.splice(0).forEach((w) => w.unmount()); });

describe("member landing and account transitions", () => {
  it('shows per-member generation outcomes, separate other operations and refreshable calendar periods only to admins', async () => {
    const w = await ready();
    expect(f.call.mock.calls.some(([action]) => action === 'member.usage')).toBe(false);
    await button(w,'团队管理').trigger('click'); await flushPromises();
    expect(f.call).toHaveBeenCalledWith('member.usage',{period:'today'});
    const row = w.findAll('.member-row').find((r) => r.text().includes('design001'))!;
    expect(row.text()).toContain('生成请求'); expect(row.text()).toContain('成功 1 · 失败 1 · 进行中 0');
    expect(row.text()).toContain('AI 润色'); expect(row.text()).toContain('分析评估'); expect(row.text()).toContain('全部请求');
    expect(w.get('.member-usage-summary').text()).toContain('生成 4 次 · 全部请求 10 次');
    await w.get('[aria-label="成员统计时段"]').setValue('all'); await flushPromises();
    expect(f.call).toHaveBeenLastCalledWith('member.usage',{period:'all'});
    await button(w,'刷新统计').trigger('click'); await flushPromises();
    expect(f.call.mock.calls.filter(([action]) => action === 'member.usage')).toHaveLength(3);
    expect(f.call.mock.calls.every(([action]) => ['status','memory.get','member.usage'].includes(action))).toBe(true);
    identity(memberId); await flushPromises(); expectMemberEditor(w);
    expect(w.find('[aria-label="成员统计时段"]').exists()).toBe(false); expect(w.find('.member-usage').exists()).toBe(false);
  });
  it('reports failed statistics reads instead of fabricating zero and can recover with a manual refresh', async () => {
    const original = f.call.getMockImplementation()!;
    f.call.mockImplementation((action: string, body: any) => action === 'member.usage' ? Promise.reject(new Error('DATABASE_ERROR')) : original(action,body));
    const w = await ready(); await button(w,'团队管理').trigger('click'); await flushPromises();
    expect(w.text()).toContain('暂时无法读取成员统计'); expect(w.find('.member-usage-summary').exists()).toBe(false);
    expect(w.findAll('.member-usage-empty')).toHaveLength(2); expect(w.find('.member-usage').exists()).toBe(false);
    f.call.mockImplementation(original);
    await button(w,'刷新统计').trigger('click'); await flushPromises();
    expect(w.find('.member-usage-error').exists()).toBe(false); expect(w.findAll('.member-usage')).toHaveLength(2);
  });
  it('discards a slow report after another administrator signs in and shows only the current report', async () => {
    f.members[1].role = 'admin';
    const original = f.call.getMockImplementation()!;
    const w = await ready(); await button(w,'团队管理').trigger('click'); await flushPromises();
    let finish: (value: any) => void = () => {};
    f.call.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await button(w,'刷新统计').trigger('click');
    expect(button(w,'刷新统计').attributes('aria-busy')).toBe('true');
    identity(memberId); await flushPromises();
    f.call.mockImplementation(original);
    await button(w,'团队管理').trigger('click'); await flushPromises();
    finish(report('today',999)); await flushPromises();
    expect(w.get('.member-usage-summary').text()).toContain('生成 4 次 · 全部请求 10 次');
    expect(w.get('.member-usage-summary').text()).not.toContain('999');
    expect(button(w,'刷新统计').attributes('disabled')).toBeUndefined();
  });
  it("opens reference extraction for a fresh member and keeps admin controls out of member navigation", async () => {
    f.getSession.mockResolvedValue({ data: { session: { user: { id: memberId } } } });
    const w = await ready(); expectMemberEditor(w);
    expect(w.get("footer").text()).not.toContain("查看源码");
    expect(w.find("footer a").exists()).toBe(false);
    await button(w, "文字提示词").trigger("click");
    expect(w.find(".reference-board").exists()).toBe(false);
    identity(memberId, "TOKEN_REFRESHED"); await flushPromises();
    expect(w.text()).toContain("把一句想法，写成清晰的创作指令");
    await button(w, "参考图创作").trigger("click"); expectMemberEditor(w);
    expect(f.call.mock.calls.every(([action]) => !action.startsWith("member.") && action !== "settings.update")).toBe(true);
  });
  it.each(["sign out first", "direct identity switch"])("leaves the old admin page behind on %s", async (transition) => {
    const w = await ready();
    await button(w, "团队管理").trigger("click"); await flushPromises();
    expect(w.find(".admin-grid").exists()).toBe(true);
    await w.get('input[autocomplete="off"]').setValue("unfinished-admin-account");
    await w.get('input[autocomplete="new-password"]').setValue("Synthetic-unsent-password");
    f.call.mockClear();
    if (transition === "sign out first") {
      await button(w, "退出").trigger("click"); await flushPromises();
      expect(w.text()).toContain("登录工作室");
    }
    identity(memberId); await flushPromises(); expectMemberEditor(w);
    expect(w.text()).not.toContain("owner@example.com");
    expect(w.html()).not.toContain("unfinished-admin-account");
    expect(w.html()).not.toContain("Synthetic-unsent-password");
    expect(w.get("#studio-prompt").element.value).toBe("");
    expect(f.call.mock.calls.every(([action]) => !action.startsWith("member.") && action !== "settings.update")).toBe(true);
  });
  it("retains an accessible source/license offer under About while the footer stays clean", async () => {
    const w = await ready();
    expect(w.find("footer a").exists()).toBe(false);
    await button(w, "关于").trigger("click");
    const about = w.get('[aria-labelledby="about-title"]');
    expect(about.text()).toContain("AGPL-3.0-only");
    expect(about.get("a").attributes("href")).toContain("feature/prompt-studio-design-templates-v1");
    await w.get('[aria-label="关闭关于"]').trigger("click");
    expect(w.find('[aria-labelledby="about-title"]').exists()).toBe(false);
  });
  it.each(["resolve", "reject"])("discards an old membership %s after the new member is ready", async (result) => {
    const original = f.rows.getMockImplementation()!;
    let resolveOld: (rows: any[]) => void = () => {}, rejectOld: (error: Error) => void = () => {};
    f.rows.mockImplementation((table: string, configure: any) => table === "ps_members" && queryOwner(configure) === adminId
      ? new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }) : original(table, configure));
    const w = await ready(); identity(memberId); await flushPromises(); expectMemberEditor(w);
    if (result === "resolve") resolveOld([f.members[0]]); else rejectOld(new Error("OLD_ADMIN_REQUEST"));
    await flushPromises(); expectMemberEditor(w);
    expect(w.text()).not.toContain("OLD_ADMIN_REQUEST");
    expect(w.get(".topbar").text()).not.toContain("owner@example.com");
  });
  it("ignores old settings and memory initialization when an administrator status response arrives late", async () => {
    let finish: (value: any) => void = () => {};
    f.call.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const w = await ready(); identity(memberId); await flushPromises(); expectMemberEditor(w);
    await w.get("#studio-prompt").setValue("这个成员自己的需求");
    finish({ ...status, configured: false, used: 9999 }); await flushPromises();
    expectMemberEditor(w); expect(w.get("#studio-prompt").element.value).toBe("这个成员自己的需求");
    expect(w.text()).not.toContain("9999"); expect(w.text()).not.toContain("模型尚未在服务器配置");
    expect(f.call.mock.calls.filter(([action]) => action === "memory.get")).toHaveLength(1);
  });
  it("does not let an initial session snapshot override a newer sign-in event", async () => {
    let finish: (value: any) => void = () => {};
    f.getSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const w = await ready(); identity(memberId); await flushPromises(); expectMemberEditor(w);
    finish({ data: { session: { user: { id: adminId } } } }); await flushPromises(); expectMemberEditor(w);
  });
  it("does not restore the old roster if another administrator signs in while the member list is loading", async () => {
    f.members[1].role = "admin";
    const original = f.rows.getMockImplementation()!;
    let listRequests = 0, finish: (rows: any[]) => void = () => {};
    f.rows.mockImplementation((table: string, configure: any) => {
      if (table === "ps_members" && !queryOwner(configure)) {
        if (++listRequests === 1) return new Promise((resolve) => { finish = resolve; });
        return Promise.resolve([f.members[1]]);
      }
      return original(table, configure);
    });
    const w = await ready(); identity(memberId); await flushPromises();
    await button(w, "团队管理").trigger("click"); await flushPromises();
    finish([{ user_id: "old-roster", email: "old-roster@example.com", role: "member", active: true }]); await flushPromises();
    expect(w.text()).toContain("design001"); expect(w.text()).not.toContain("old-roster@example.com");
    expect(w.findAll(".member-row")).toHaveLength(1);
  });
  it("keeps password recovery available and closes that account's dialog on a subsequent identity change", async () => {
    f.getSession.mockResolvedValue({ data: { session: null } });
    const w = await ready(); identity(memberId, "PASSWORD_RECOVERY"); await flushPromises();
    expect(w.text()).toContain("设置你的登录密码");
    identity(adminId); await flushPromises();
    expect(w.text()).not.toContain("设置你的登录密码"); expect(w.find(".reference-board").exists()).toBe(true);
  });
});
