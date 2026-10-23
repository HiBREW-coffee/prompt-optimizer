import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
const f = vi.hoisted(() => ({
  call: vi.fn(),
  rows: vi.fn(),
  upload: vi.fn(),
  logout: vi.fn(),
  getSession: vi.fn(),
  recovery: vi.fn(),
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
      resetPasswordForEmail: f.recovery,
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
import ProfessionalReport from "../../team/ProfessionalReport.vue";
import { workspaceContext } from "../../../../supabase/functions/_shared/studio-contract";
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
  f.recovery.mockResolvedValue({ error: null });
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
        reference_images: body.referenceImages,
        intent: body.intent,
        template_id: body.templateId,
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
    if (action === "prompt.evaluate" || action === "prompt.inspect") {
      const w = f.data.workspaces[0];
      const analysis = {
        id: crypto.randomUUID(),
        version_id: body.versionId,
        context: workspaceContext(w),
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
      if (action === "prompt.inspect")
        return {
          inspection: { ...analysis, workspace_id: w.id, owner_id: uid },
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
  it("saves only temporary image metadata and requires the original file after reopening", async () => {
    const prepared = {path:uid+"/abc.png",preview:"blob:temporary",temporary:true,
      digest:"a".repeat(64),sourceDigest:"b".repeat(64),data:"aGVsbG8=",mimeType:"image/png"};
    f.upload.mockResolvedValue(prepared);
    const wrapper=await ready();
    await extract(wrapper);
    const saved=f.call.mock.calls.find(([action])=>action==="workspace.save")![1];
    expect(saved.referenceImages).toEqual([{path:prepared.path,role:"auto",note:"",temporary:true,digest:prepared.digest,sourceDigest:prepared.sourceDigest}]);
    expect(JSON.stringify(saved)).not.toContain(prepared.data);
    expect(JSON.stringify(saved)).not.toContain("blob:temporary");
    expect(f.call).toHaveBeenCalledWith("reference.extract",expect.objectContaining({referenceData:[{path:prepared.path,data:prepared.data,mimeType:"image/png"}]}));
    await button(wrapper,"历史与版本").trigger("click");await flushPromises();
    await button(wrapper,"打开作品").trigger("click");await flushPromises();
    expect(wrapper.text()).toContain("原图未长期保存");
    const previous=f.call.mock.calls.filter(([action])=>action==="reference.rewrite").length;
    await button(wrapper,"按要求生成新版本").trigger("click");await flushPromises();
    expect(f.call.mock.calls.filter(([action])=>action==="reference.rewrite")).toHaveLength(previous);
    expect(wrapper.text()).toContain("请重新选择对应原图");
    const restore=wrapper.get('input[aria-label="重新选择图1原文件"]');
    Object.defineProperty(restore.element,"files",{value:[new File(["original"],"product.png",{type:"image/png"})],configurable:true});
    f.upload.mockResolvedValueOnce({...prepared,sourceDigest:"c".repeat(64)});
    await restore.trigger("change");await flushPromises();
    expect(wrapper.text()).toContain("REFERENCE_FILE_MISMATCH");
    await restore.trigger("change");await flushPromises();
    await button(wrapper,"按要求生成新版本").trigger("click");await flushPromises();
    expect(f.call.mock.calls.filter(([action])=>action==="reference.rewrite")).toHaveLength(previous+1);
    wrapper.unmount();
  });
  it("saves only an explicitly confirmed reusable memory without a model call", async () => {
    const original=f.call.getMockImplementation()!;
    f.call.mockImplementation(async(action:string,body:any)=>{
      if(action==="memory.get")return{enabled:false,rules:[]};
      if(action==="memory.save")return body.memory;
      return original(action,body);
    });
    const wrapper=await ready();
    await button(wrapper,"创作经验").trigger("click");
    await button(wrapper,"添加经验").trigger("click");
    await wrapper.get('input[aria-label="经验1标题"]').setValue("外观底线");
    await wrapper.get('textarea[aria-label="经验1规则"]').setValue("保持产品几何，场景光影匹配主体");
    await wrapper.get('[role="dialog"] input[type="checkbox"]').setValue(true);
    expect(f.call.mock.calls.some(([action])=>action==="memory.save")).toBe(false);
    await wrapper.get('[role="dialog"] form').trigger("submit");await flushPromises();
    expect(f.call).toHaveBeenCalledWith("memory.save",{memory:expect.objectContaining({enabled:true,rules:[expect.objectContaining({title:"外观底线",rule:"保持产品几何，场景光影匹配主体"})]})});
    expect(f.call.mock.calls.some(([action])=>["reference.extract","reference.rewrite","text.optimize","prompt.inspect","prompt.evaluate"].includes(action))).toBe(false);
    expect(wrapper.text()).toContain("本次参考经验：外观底线");
    wrapper.unmount();
  });
  it("shows complete bilingual prompts alongside the professional breakdown", () => {
    const wrapper = mount(ProfessionalReport, {
      props: {
        zh: "中文完整提示词",
        en: "Complete English prompt",
        report: {
          intent: "合成产品场景",
          imageRoles: [
            { index: 1, role: "产品", evidence: "白底产品", use: "保留几何" },
          ],
          anchors: [{ title: "身份", content: "产品几何不变" }],
          changes: [{ title: "场景", content: "借用图2桌面" }],
          sections: [{ title: "构图", content: "匹配透视与接触阴影" }],
          negative: { zh: "不变形", en: "no distortion" },
          parameters: [{ name: "画幅", value: "9:16", reason: "沿用竖屏构图" }],
          checks: ["产品几何正确"],
        },
      },
    });
    for (const text of [
      "中文完整提示词",
      "Complete English prompt",
      "产品几何不变",
      "借用图2桌面",
      "匹配透视与接触阴影",
      "no distortion",
      "9:16",
      "产品几何正确",
    ])
      expect(wrapper.text()).toContain(text);
    wrapper.unmount();
  });
  it("defaults to reference extraction and exposes no image generation or model settings", async () => {
    const wrapper = await ready();
    expect(wrapper.text()).toContain("把参考图，提炼成创作语言");
    expect(wrapper.text()).not.toMatch(/文生图|图生图|模型管理|API Key/);
    expect(wrapper.find('a[href*="/image/"]').exists()).toBe(false);
    expect(wrapper.find("input[type=file]").attributes("multiple")).toBe("");
    expect(wrapper.text()).not.toMatch(/今日请求|今日使用|今日模型请求|每日上限|每日不限/);
    expect(wrapper.find("progress").exists()).toBe(false);
    wrapper.unmount();
  });
  it("shows administrators request counts without a false provider balance or zero denominator", async () => {
    const originalRows = f.rows.getMockImplementation()!;
    f.rows.mockImplementation(async (table: string, ...args: any[]) =>
      table === "ps_members"
        ? [{ user_id: uid, email: "admin@example.com", role: "admin", active: true }]
        : originalRows(table, ...args),
    );
    f.call.mockImplementationOnce(async () => ({
      configured: true,
      settings: { member_daily: 0, team_daily: 0, user_concurrent: 1, team_concurrent: 2 },
      used: 72, dailyLimit: 0,
    }));
    const wrapper = await ready();
    expect(wrapper.text()).toContain("今日请求 72 次 · 每日不限");
    expect(wrapper.text()).toContain("非供应商余额");
    expect(wrapper.text()).not.toContain("72 / 0");
    expect(wrapper.find("progress").exists()).toBe(false);
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
    const input = wrapper.get("#studio-prompt");
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
  it("brands the studio with the supplied avatar and restores modes, inspiration and templates", async () => {
    const wrapper = await ready();
    expect(wrapper.text()).toContain("@DONGWU");
    expect(wrapper.text()).not.toContain("HiBREW");
    expect(wrapper.findAll('img[alt="@DONGWU头像"]').length).toBeGreaterThan(0);
    expect(
      wrapper.findAll("textarea").filter((t) => !t.attributes("aria-label")),
    ).toHaveLength(2);
    expect(wrapper.text()).toContain("风格学习");
    expect(wrapper.findAll("option").map((o) => o.text())).toContain(
      "电商产品摄影",
    );
    await wrapper.get("#studio-prompt").setValue("保留我的产品机位");
    await button(wrapper, "灵感").trigger("click");
    expect(button(wrapper, "灵感").attributes("aria-pressed")).toBe("true");
    expect(wrapper.get('[role="dialog"]').text()).toContain(
      "白底产品进入真实场景",
    );
    const card = wrapper.findAll(".inspiration-grid article")[0];
    await card.get("button").trigger("click");
    expect(
      (wrapper.get("#studio-prompt").element as HTMLTextAreaElement).value,
    ).toContain("图1的白底产品");
    expect(
      (wrapper.get("#studio-prompt").element as HTMLTextAreaElement).value,
    ).toContain("保留我的产品机位");
    expect(f.call.mock.calls.some((c) => c[0] === "reference.extract")).toBe(
      false,
    );
    wrapper.unmount();
  });
  it("uploads five numbered images, analyzes raw input and applies that input suggestion before V1", async () => {
    f.upload.mockImplementation(async () => ({
      path: `${uid}/${crypto.randomUUID()}.png`,
      preview: "blob:preview",
    }));
    const wrapper = await ready();
    const input = wrapper.get("input[type=file]");
    Object.defineProperty(input.element, "files", {
      value: Array.from(
        { length: 5 },
        (_, i) => new File(["image"], `image${i}.png`, { type: "image/png" }),
      ),
      configurable: true,
    });
    await input.trigger("change");
    await flushPromises();
    expect(wrapper.findAll(".reference-card")).toHaveLength(5);
    expect(
      wrapper.findAll(".reference-photo img").map((i) => i.attributes("alt")),
    ).toEqual([
      "图1参考图",
      "图2参考图",
      "图3参考图",
      "图4参考图",
      "图5参考图",
    ]);
    await wrapper
      .get("#studio-prompt")
      .setValue("图1产品放入图2场景，图3人物，图4光线，图5细节");
    await wrapper.findAll(".reference-card select")[1].setValue("scene");
    await button(wrapper, "分析原文与参考图").trigger("click");
    await flushPromises();
    expect(f.call).toHaveBeenCalledWith(
      "prompt.inspect",
      expect.objectContaining({ versionId: undefined }),
    );
    expect(
      f.call.mock.calls.filter((c) => c[0] === "workspace.save").at(-1)?.[1]
        .referenceImages[1].role,
    ).toBe("scene");
    expect(f.data.versions).toHaveLength(0);
    await button(wrapper, "按此建议优化提示词").trigger("click");
    await flushPromises();
    expect(f.call).toHaveBeenCalledWith(
      "reference.extract",
      expect.objectContaining({
        inspectionId: expect.any(String),
        suggestionId: "1",
      }),
    );
    expect(f.data.versions).toHaveLength(1);
    wrapper.unmount();
  });
  it("rejects six uploads before storing any file or calling the model", async () => {
    const wrapper = await ready();
    const input = wrapper.get("input[type=file]");
    Object.defineProperty(input.element, "files", {
      value: Array.from(
        { length: 6 },
        () => new File(["x"], "test.png", { type: "image/png" }),
      ),
      configurable: true,
    });
    await input.trigger("change");
    await flushPromises();
    expect(f.upload).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("INVALID_REFERENCE_IMAGES");
    expect(f.call.mock.calls.some((c) => c[0] === "reference.extract")).toBe(
      false,
    );
    wrapper.unmount();
  });
  it("renumbers image roles in the same order after removal and movement", async () => {
    f.upload.mockImplementation(async (file) => ({
      path: `${uid}/${file.name}`,
      preview: "blob:preview",
    }));
    const wrapper = await ready();
    const input = wrapper.get("input[type=file]");
    Object.defineProperty(input.element, "files", {
      value: ["a.png", "b.png", "c.png"].map(
        (name) => new File(["x"], name, { type: "image/png" }),
      ),
      configurable: true,
    });
    await input.trigger("change");
    await flushPromises();
    await wrapper.get('[aria-label="移除图2"]').trigger("click");
    await wrapper.get('[aria-label="上移图2"]').trigger("click");
    await button(wrapper, "分析原文与参考图").trigger("click");
    await flushPromises();
    expect(
      f.call.mock.calls
        .filter((c) => c[0] === "workspace.save")
        .at(-1)?.[1]
        .referenceImages.map((i: any) => i.path),
    ).toEqual([`${uid}/c.png`, `${uid}/a.png`]);
    wrapper.unmount();
  });
  it("lets an administrator create a member without keeping the entered password", async () => {
    const previousRows = f.rows.getMockImplementation()!;
    f.rows.mockImplementation(async (table, configure) =>
      table === "ps_members"
        ? [
            {
              user_id: uid,
              email: "admin@example.com",
              role: "admin",
              active: true,
            },
          ]
        : previousRows(table, configure),
    );
    const wrapper = await ready();
    await button(wrapper, "团队管理").trigger("click");
    await flushPromises();
    await wrapper.get('input[autocomplete="off"]').setValue("new@example.com");
    const field = wrapper.get('input[autocomplete="new-password"]');
    await field.setValue("Synthetic-initial-password");
    await button(wrapper, "创建成员").trigger("submit");
    await flushPromises();
    expect(f.call).toHaveBeenCalledWith("member.create", {
      email: "new@example.com",
      password: "Synthetic-initial-password",
    });
    expect((field.element as HTMLInputElement).value).toBe("");
    expect(wrapper.text()).toContain("成员已添加");
    expect(localStorage.length).toBe(0);
    wrapper.unmount();
  });
  it("does not expose team management to ordinary members", async () => {
    const wrapper = await ready();
    expect(wrapper.findAll("button").some((b) => b.text() === "团队管理")).toBe(
      false,
    );
    expect(
      wrapper
        .findAll("input")
        .some((i) => i.attributes("autocomplete") === "new-password"),
    ).toBe(false);
    wrapper.unmount();
  });
  it("sends a user-requested password reset back to this site without changing project defaults", async () => {
    f.getSession.mockResolvedValue({ data: { session: null } });
    const wrapper = await ready();
    await wrapper.get('input[type="email"]').setValue("admin@example.com");
    await button(wrapper, "忘记密码 / 首次设置密码").trigger("click");
    await flushPromises();
    expect(f.recovery).toHaveBeenCalledWith("admin@example.com", {
      redirectTo: location.origin,
    });
    expect(wrapper.text()).toContain("你会收到密码重设链接");
    wrapper.unmount();
  });
});

