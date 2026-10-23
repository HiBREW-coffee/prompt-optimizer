import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
const f = vi.hoisted(() => ({
  call: vi.fn(),
  rows: vi.fn(),
  upload: vi.fn(),
  logout: vi.fn(),
  getSession: vi.fn(),
  data: {
    workspaces: [] as any[],
    versions: [] as any[],
    analyses: [] as any[],
    library: [] as any[],
  },
}));
vi.mock("../../team/api", () => ({
  db: {
    auth: {
      getSession: f.getSession,
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      signOut: f.logout,
      signInWithPassword: vi.fn(),
    },
  },
  call: f.call,
  rows: f.rows,
  uploadImage: f.upload,
  signedImage: vi.fn().mockResolvedValue("blob:preview"),
  download: vi.fn(),
  exportPrivateData: vi.fn(),
  message: (e: Error) => e.message,
  needsPassword: false,
  SOURCE_URL: "https://github.com/HiBREW-coffee/prompt-optimizer",
}));
import App from "../../team/App.vue";
const uid = "11111111-1111-4111-8111-111111111111",
  wid = "22222222-2222-4222-8222-222222222222";
const bundle = {
  zh: "银色咖啡机，左侧柔光",
  en: "Silver coffee machine, soft light from the left",
  structured: { subject: "silver coffee machine" },
  observations: ["左侧柔光"],
  uncertainties: ["品牌未知"],
};
function button(wrapper: ReturnType<typeof mount>, name: string) {
  const b = wrapper.findAll("button").find((b) => b.text() === name);
  if (!b) throw new Error(`Button not found: ${name}`);
  return b;
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  f.data = { workspaces: [], versions: [], analyses: [], library: [] };
  f.getSession.mockResolvedValue({ data: { session: { user: { id: uid } } } });
  f.upload.mockResolvedValue({
    path: `${uid}/abc.png`,
    preview: "blob:preview",
  });
  f.rows.mockImplementation(async (table: string) => {
    if (table === "ps_members")
      return [
        {
          user_id: uid,
          email: "member@example.com",
          role: "member",
          active: true,
        },
      ];
    return (
      {
        ps_workspaces: f.data.workspaces,
        ps_versions: f.data.versions,
        ps_analyses: f.data.analyses,
        ps_library: f.data.library,
        ps_library_favorites: [],
        ps_requests: [],
      }[table] || []
    );
  });
  f.call.mockImplementation(async (action: string, body: any) => {
    if (action === "status")
      return {
        configured: true,
        settings: {
          member_daily: 50,
          team_daily: 200,
          user_concurrent: 1,
          team_concurrent: 2,
        },
        used: 0,
        dailyLimit: 50,
      };
    if (action === "workspace.save") {
      const workspace = {
        id: wid,
        owner_id: uid,
        title: body.title,
        mode: body.mode,
        source_text: body.sourceText,
        keep_text: body.keepText,
        change_text: body.changeText,
        reference_path: body.referencePath,
        current_version_id: f.data.versions[0]?.id ?? null,
        favorite: false,
      };
      f.data.workspaces = [workspace];
      return { workspace };
    }
    if (
      [
        "reference.extract",
        "reference.rewrite",
        "text.optimize",
        "version.save",
      ].includes(action)
    ) {
      const version = {
        id: crypto.randomUUID(),
        workspace_id: wid,
        sequence: f.data.versions.length + 1,
        parent_id: body.versionId || null,
        bundle: body.bundle || bundle,
        context: {},
        kind: action,
        created_at: new Date().toISOString(),
      };
      f.data.versions.unshift(version);
      f.data.workspaces[0].current_version_id = version.id;
      return { version, became_current: true };
    }
    if (action === "prompt.evaluate") {
      const w = f.data.workspaces[0];
      const analysis = {
        id: crypto.randomUUID(),
        version_id: body.versionId,
        context: {
          source: w.source_text,
          keep: w.keep_text,
          change: w.change_text,
        },
        result: {
          score: 83,
          summary: "原图机位已保留",
          dimensions: [{ name: "保真度", score: 83, reason: "主体关系吻合" }],
          suggestions: [
            {
              id: "1",
              title: "补充光线方向",
              reason: "图中有依据",
              instruction: "写明左侧柔光",
            },
          ],
        },
      };
      f.data.analyses = [analysis];
      return { analysis };
    }
    return { ok: true };
  });
});
async function ready() {
  const wrapper = mount(App);
  await flushPromises();
  return wrapper;
}
async function extract(wrapper: ReturnType<typeof mount>) {
  const file = wrapper.get("input[type=file]");
  Object.defineProperty(file.element, "files", {
    value: [new File(["image"], "reference.png", { type: "image/png" })],
    configurable: true,
  });
  await file.trigger("change");
  await flushPromises();
  await button(wrapper, "提炼参考图提示词").trigger("click");
  await flushPromises();
}
describe("real team Vue workflow", () => {
  it("defaults to reference extraction and exposes no image generation or model settings", async () => {
    const wrapper = await ready();
    expect(wrapper.text()).toContain("把参考图，提炼成创作语言");
    expect(wrapper.text()).not.toMatch(/文生图|图生图|模型管理|API Key/);
    expect(wrapper.find('a[href*="/image/"]').exists()).toBe(false);
    expect(
      wrapper.find("input[type=file]").attributes("multiple"),
    ).toBeUndefined();
    wrapper.unmount();
  });
  it("uploads, extracts bilingual JSON, evaluates and applies suggestion as a new version", async () => {
    const wrapper = await ready();
    await extract(wrapper);
    expect(wrapper.get('textarea[aria-label="中文提示词"]').element.value).toBe(
      bundle.zh,
    );
    expect(wrapper.get('textarea[aria-label="英文提示词"]').element.value).toBe(
      bundle.en,
    );
    expect(
      JSON.parse(
        wrapper.get('textarea[aria-label="结构化提示词"]').element.value,
      ),
    ).toEqual(bundle.structured);
    await button(wrapper, "分析与修改建议").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("83");
    expect(wrapper.text()).toContain("补充光线方向");
    await button(wrapper, "按此建议生成新版本").trigger("click");
    await flushPromises();
    expect(f.call).toHaveBeenCalledWith(
      "reference.rewrite",
      expect.objectContaining({
        analysisId: expect.any(String),
        suggestionId: "1",
        versionId: expect.any(String),
      }),
    );
    expect(f.data.versions).toHaveLength(2);
    wrapper.unmount();
  });
  it("manual edits save a new version before analysis", async () => {
    const wrapper = await ready();
    await extract(wrapper);
    await wrapper
      .get('textarea[aria-label="中文提示词"]')
      .setValue("银色咖啡机，保留原始仰视机位");
    await button(wrapper, "分析与修改建议").trigger("click");
    await flushPromises();
    expect(f.call).toHaveBeenCalledWith(
      "version.save",
      expect.objectContaining({
        bundle: expect.objectContaining({ zh: "银色咖啡机，保留原始仰视机位" }),
      }),
    );
    const evaluated = f.call.mock.calls.find((x) => x[0] === "prompt.evaluate");
    expect(evaluated?.[1].versionId).toBe(f.data.versions[0].id);
    wrapper.unmount();
  });
  it("changing requirements disables stale suggestions", async () => {
    const wrapper = await ready();
    await extract(wrapper);
    await button(wrapper, "分析与修改建议").trigger("click");
    await flushPromises();
    const input = wrapper
      .findAll("textarea")
      .find((t) => t.attributes("placeholder")?.startsWith("例如：主体换成"))!;
    await input.setValue("改变背景");
    expect(
      button(wrapper, "按此建议生成新版本").attributes("disabled"),
    ).toBeDefined();
    expect(wrapper.text()).toContain("请重新分析后再应用建议");
    wrapper.unmount();
  });
  it("publishing defaults to prompt only and requires explicit image choice", async () => {
    const wrapper = await ready();
    await extract(wrapper);
    await button(wrapper, "发布到团队库").trigger("click");
    expect(
      (wrapper.get("input[type=checkbox]").element as HTMLInputElement).checked,
    ).toBe(false);
    await button(wrapper, "确认发布").trigger("click");
    await flushPromises();
    expect(f.call).toHaveBeenCalledWith(
      "library.publish",
      expect.objectContaining({ includeImage: false }),
    );
    wrapper.unmount();
  });
  it("guards reference calls until an image is selected", async () => {
    const wrapper = await ready();
    await button(wrapper, "提炼参考图提示词").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("请先上传参考图");
    expect(f.call.mock.calls.some((c) => c[0] === "reference.extract")).toBe(
      false,
    );
    wrapper.unmount();
  });
  it("keeps failed AI request discoverable instead of auto retrying", async () => {
    const wrapper = await ready();
    const defaultCall = f.call.getMockImplementation()!;
    f.call.mockImplementation(async (action, body) => {
      if (action === "reference.extract") throw new Error("REQUEST_TIMEOUT");
      return defaultCall(action, body);
    });
    await extract(wrapper);
    expect(wrapper.text()).toContain("查询上次结果");
    expect(
      f.call.mock.calls.filter((c) => c[0] === "reference.extract"),
    ).toHaveLength(1);
    expect(localStorage.getItem(`ps-pending-${uid}`)).toBeTruthy();
    wrapper.unmount();
  });
  it("shows invite-only login without registration", async () => {
    f.getSession.mockResolvedValue({ data: { session: null } });
    const wrapper = await ready();
    expect(wrapper.text()).toContain("仅限受邀成员");
    expect(wrapper.text()).not.toContain("注册账号");
    wrapper.unmount();
  });
});
