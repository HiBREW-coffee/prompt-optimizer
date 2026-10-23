// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createStudioHandler } from "../../../../supabase/functions/_shared/studio-handler";
import type { StudioStore } from "../../../../supabase/functions/_shared/studio-handler";
import { StudioError } from "../../../../supabase/functions/_shared/studio-contract";
import { generateStudioJson } from "../../../../supabase/functions/_shared/studio-gemini";
const uid = "11111111-1111-4111-8111-111111111111",
  wid = "22222222-2222-4222-8222-222222222222",
  vid = "33333333-3333-4333-8333-333333333333",
  rid = "44444444-4444-4444-8444-444444444444";
const bundle = {
  zh: "银色咖啡机，侧面柔光",
  en: "Silver coffee machine, soft side lighting",
  structured: { subject: "silver coffee machine" },
  observations: ["左侧柔光"],
  uncertainties: ["品牌无法确认"],
  report: {
    intent: "保留图1咖啡机并调整银色",
    imageRoles: [
      { index: 1, role: "产品主体", evidence: "咖啡机", use: "保留机位与外形" },
    ],
    anchors: [{ title: "主体", content: "咖啡机外形" }],
    changes: [],
    sections: [
      { title: "主体", content: "银色咖啡机" },
      { title: "构图", content: "保持机位" },
      { title: "光线", content: "左侧柔光" },
      { title: "材质", content: "金属" },
    ],
    negative: { zh: "不改外形", en: "no structural changes" },
    parameters: [],
    checks: ["主体一致"],
  },
};
const workspace = {
  id: wid,
  owner_id: uid,
  title: "产品",
  mode: "reference" as const,
  source_text: "咖啡机",
  keep_text: "保持机位与光线",
  change_text: "改为银色",
  reference_path: `${uid}/abc.png`,
  current_version_id: vid,
  favorite: false,
};
const version = {
  id: vid,
  workspace_id: wid,
  sequence: 1,
  parent_id: null,
  bundle,
  context: {},
  kind: "reference.extract",
  created_at: new Date().toISOString(),
};
function harness(overrides: Partial<StudioStore> = {}) {
  const store: StudioStore = {
    user: vi.fn().mockResolvedValue({ id: uid }),
    member: vi.fn().mockResolvedValue({ role: "member", active: true }),
    workspace: vi.fn().mockResolvedValue(workspace),
    version: vi.fn().mockResolvedValue(version),
    begin: vi.fn().mockResolvedValue({ accepted: true }),
    image: vi
      .fn()
      .mockResolvedValue(
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
      ),
    suggestion: vi.fn().mockResolvedValue("具体修改"),
    save: vi.fn().mockImplementation(async (_u, _w, _p, b) => ({
      version: { ...version, bundle: b },
      became_current: true,
    })),
    analyze: vi.fn().mockImplementation(async (_u, _v, result, context) => ({
      analysis: { version_id: vid, result, context },
    })),
    fail: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockImplementation(async (_u, _w, result, context) => ({
      inspection: { id: rid, workspace_id: wid, result, context },
    })),
    command: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("", { status: 404 }))
    .mockResolvedValueOnce(
      Response.json({
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify(bundle) }] },
            finishReason: "STOP",
          },
        ],
      }),
    );
  const generate = vi.fn((input, signal) =>
    generateStudioJson(input, {
      key: "synthetic-test-value",
      model: "gem-3.8-flash",
      signal,
      fetcher,
    }),
  );
  const handler = createStudioHandler({
    allowedOrigins: new Set(["https://studio.example"]),
    createStore: () => store,
    generate,
  });
  const request = (
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) =>
    handler(
      new Request(
        "https://project.supabase.co/functions/v1/prompt-studio-api",
        {
          method: "POST",
          headers: {
            origin: "https://studio.example",
            authorization: "Bearer synthetic-session",
            "content-type": "application/json",
            ...headers,
          },
          body: JSON.stringify(body),
        },
      ),
    );
  return { store, fetcher, generate, handler, request };
}
describe("authenticated team AI chain", () => {
  it("sends five temporary references through the LK888 fallback without storing or downloading images", async () => {
    const images = await Promise.all(Array.from({length:5},async(_,index)=>{
      const bytes = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,index]);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
      return {path:`${uid}/${index+1}.png`,role:"product",note:"图"+(index+1),temporary:true,digest,sourceDigest:digest,
        data:btoa(String.fromCharCode(...bytes)),mimeType:"image/png"};
    }));
    const references = images.map(({data,mimeType,...metadata})=>metadata);
    const w = {...workspace,reference_path:references[0].path,reference_images:references};
    const h = harness({workspace:vi.fn().mockResolvedValue(w)});
    h.fetcher.mockReset().mockResolvedValueOnce(new Response("",{status:404}))
      .mockResolvedValueOnce(Response.json({candidates:[{content:{parts:[{text:JSON.stringify({
        ...bundle,report:{...bundle.report,imageRoles:references.map((_,index)=>({index:index+1,role:"产品",evidence:"可见主体",use:"保留"}))}
      })}]},finishReason:"STOP"}]}));
    const response = await h.request({action:"reference.extract",workspaceId:wid,requestId:rid,
      referenceData:images.map(({path,data,mimeType})=>({path,data,mimeType}))});
    expect(response.status).toBe(200);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(h.store.image).not.toHaveBeenCalled();
    const first = JSON.parse(String(h.fetcher.mock.calls[0][1]?.body));
    const fallback = JSON.parse(String(h.fetcher.mock.calls[1][1]?.body));
    expect(fallback.contents).toEqual(first.contents);
    expect(first.contents[0].parts.filter((part:any)=>part.inlineData).map((part:any)=>part.inlineData.data)).toEqual(images.map(image=>image.data));
    expect(h.store.save).toHaveBeenCalledTimes(1);
    for (const image of images) expect(JSON.stringify(h.store.save.mock.calls)).not.toContain(image.data);
  });
  it.each(["missing","wrong-file","foreign-slot"])("rejects temporary image %s before admission or generation",async(kind)=>{
    const bytes=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
    const reference={path:workspace.reference_path,role:"product",note:"",temporary:true,digest,sourceDigest:digest};
    const h=harness({workspace:vi.fn().mockResolvedValue({...workspace,reference_images:[reference]})});
    const response=await h.request({action:"reference.extract",workspaceId:wid,requestId:rid,
      ...(kind==="missing"?{}:{referenceData:[{path:kind==="foreign-slot"?uid+"/def.png":reference.path,
        mimeType:"image/png",data:btoa(String.fromCharCode(...(kind==="wrong-file"?new Uint8Array([...bytes,1]):bytes)))}]})});
    expect(response.status).toBe(400);
    expect(h.store.begin).not.toHaveBeenCalled();
    expect(h.generate).not.toHaveBeenCalled();
  });
  it("binds confirmed memory to analysis context and version saving",async()=>{
    const memory=[{id:rid,title:"外观底线",rule:"不改产品几何",scope:"reference" as const,template:""}];
    const h=harness({memory:vi.fn().mockResolvedValue(memory)});
    expect((await h.request({action:"reference.rewrite",workspaceId:wid,versionId:vid,requestId:rid})).status).toBe(200);
    expect(JSON.parse(h.generate.mock.calls[0][0].text).confirmedPreferences).toEqual([{title:"外观底线",rule:"不改产品几何"}]);
    expect(h.store.save).toHaveBeenCalledWith(uid,workspace,vid,expect.any(Object),"reference.rewrite",rid,
      expect.objectContaining({confirmed_preferences:memory}));
  });
  it.each(["prompt.inspect", "prompt.evaluate"])(
    "rejects ambiguous scoring from %s without persisting it or retrying",
    async (action) => {
      const h = harness();
      h.generate.mockResolvedValue(
        JSON.stringify({
          score: 6.8,
          summary: "整体较好，但仍有细节可补充",
          dimensions: ["主体", "机位", "光线", "材质"].map((name) => ({
            name,
            score: 6.9,
            reason: "有视觉依据",
          })),
          structure: ["主体", "机位", "光线", "材质"].map((title) => ({
            title,
            content: "可观察的结构",
          })),
          imageRoles: [
            { index: 1, role: "产品", evidence: "咖啡机", use: "保留外观" },
          ],
          suggestions: [],
        }),
      );
      const response = await h.request({
        action,
        workspaceId: wid,
        requestId: rid,
        ...(action === "prompt.evaluate" ? { versionId: vid } : {}),
      });
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "INVALID_SCORE_SCALE" });
      expect(h.store.inspect).not.toHaveBeenCalled();
      expect(h.store.analyze).not.toHaveBeenCalled();
      expect(h.generate).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["reference.extract", "reference.rewrite"])(
    "%s includes original image and requirements through fallback and saves one version",
    async (action) => {
      const h = harness();
      const response = await h.request({
        action,
        workspaceId: wid,
        requestId: rid,
        ...(action.endsWith("rewrite") ? { versionId: vid } : {}),
      });
      expect(response.status).toBe(200);
      expect(h.fetcher).toHaveBeenCalledTimes(2);
      expect(h.store.save).toHaveBeenCalledTimes(1);
      const input = JSON.parse(String(h.fetcher.mock.calls[0][1]?.body));
      expect(input.contents[0].parts[2].inlineData.mimeType).toBe("image/png");
      expect(input.contents[0].parts[1].text).toContain("图1");
      expect(input.contents[0].parts[0].text).toContain("保持机位与光线");
      expect(input.contents[0].parts[0].text).toContain("改为银色");
      expect(input.systemInstruction.parts[0].text).toContain(
        "团队版最终输出协议",
      );
      expect(h.store.begin).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(await response.json())).not.toContain(
        "synthetic-test-value",
      );
    },
  );
  it("prompt-only evaluation is genuinely multimodal and retains version/context binding", async () => {
    const h = harness();
    const result = {
      scoreScale: 100,
      score: 83,
      summary: "需要更具体的光线描述",
      dimensions: ["保真度", "构图", "光线", "一致性"].map((name) => ({
        name,
        score: 83,
        reason: "有图像证据",
      })),
      structure: ["主体", "构图", "光线", "材质"].map((title) => ({
        title,
        content: "可观察事实与约束",
      })),
      imageRoles: [
        { index: 1, role: "产品", evidence: "咖啡机", use: "保持主体" },
      ],
      suggestions: [
        {
          title: "补充光线方向",
          instruction: "写明来自左侧",
          reason: "图中可见",
        },
      ],
    };
    h.fetcher
      .mockReset()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({
          candidates: [
            {
              content: { parts: [{ text: JSON.stringify(result) }] },
              finishReason: "STOP",
            },
          ],
        }),
      );
    const response = await h.request({
      action: "prompt.evaluate",
      workspaceId: wid,
      versionId: vid,
      requestId: rid,
    });
    expect(response.status).toBe(200);
    const input = JSON.parse(String(h.fetcher.mock.calls[1][1]?.body));
    expect(input.contents[0].parts).toHaveLength(3);
    expect(input.contents[0].parts[0].text).toContain(bundle.en);
    expect(h.store.analyze).toHaveBeenCalledWith(
      uid,
      vid,
      expect.objectContaining({ score: 83 }),
      expect.objectContaining({ keep: workspace.keep_text }),
      rid,
    );
    expect(h.store.save).not.toHaveBeenCalled();
  });
  it("text optimization does not download an image", async () => {
    const h = harness({
      workspace: vi.fn().mockResolvedValue({
        ...workspace,
        mode: "text",
        reference_path: null,
      }),
    });
    h.generate.mockResolvedValue(
      JSON.stringify({
        ...bundle,
        report: { ...bundle.report, imageRoles: [] },
      }),
    );
    expect(
      (
        await h.request({
          action: "text.optimize",
          workspaceId: wid,
          requestId: rid,
        })
      ).status,
    ).toBe(200);
    expect(h.store.image).not.toHaveBeenCalled();
  });
  it("labels all five images and carries their roles, intent and template into the same request", async () => {
    const refs = ["product", "scene", "person", "style", "detail"].map(
      (role, index) => ({
        path: `${uid}/${index + 1}.png`,
        role,
        note: `图${index + 1}用途`,
      }),
    );
    const h = harness({
      workspace: vi.fn().mockResolvedValue({
        ...workspace,
        source_text: "图1产品使用图2场景、图3人物、图4光线、图5细节",
        reference_images: refs,
        intent: "style",
        template_id: "multiimage",
      }),
    });
    h.generate.mockResolvedValue(
      JSON.stringify({
        ...bundle,
        report: {
          ...bundle.report,
          imageRoles: refs.map((r, i) => ({
            index: i + 1,
            role: r.role,
            evidence: "可见事实",
            use: r.note,
          })),
        },
      }),
    );
    const response = await h.request({
      action: "reference.extract",
      workspaceId: wid,
      requestId: rid,
    });
    expect(response.status).toBe(200);
    const input = h.generate.mock.calls[0][0];
    expect(input.images?.map((i) => i.index)).toEqual([1, 2, 3, 4, 5]);
    const context = JSON.parse(input.text);
    expect(context.images.map((i: any) => i.label)).toEqual([
      "图1",
      "图2",
      "图3",
      "图4",
      "图5",
    ]);
    expect(context.images.map((i: any) => i.role)).toEqual(
      refs.map((i) => i.role),
    );
    expect(context).toMatchObject({ intent: "style", template: "multiimage" });
    expect(input.system).toContain("风格学习");
    expect(h.store.image).toHaveBeenCalledTimes(5);
  });
  it("analyzes raw input and images before any generated version, without appending a version", async () => {
    const h = harness();
    h.generate.mockResolvedValue(
      JSON.stringify({
        scoreScale: 100,
        score: 68,
        summary: "主体明确，场景用途需要补充",
        dimensions: ["主体", "构图", "光线", "一致性"].map((name) => ({
          name,
          score: 68,
          reason: "图1可见",
        })),
        structure: ["目标", "约束", "关系", "格式"].map((title) => ({
          title,
          content: "原文要求保持机位",
        })),
        anchors: [],
        conflicts: [],
        imageRoles: [
          { index: 1, role: "产品", evidence: "咖啡机", use: "保持" },
        ],
        suggestions: [
          {
            title: "补充支撑面",
            reason: "空间缺口",
            instruction: "说明台面和接触阴影",
          },
        ],
      }),
    );
    const response = await h.request({
      action: "prompt.inspect",
      workspaceId: wid,
      requestId: rid,
    });
    expect(response.status).toBe(200);
    expect(h.store.inspect).toHaveBeenCalledWith(
      uid,
      wid,
      expect.objectContaining({ structure: expect.any(Array) }),
      expect.objectContaining({ source: workspace.source_text }),
      rid,
    );
    expect(h.store.save).not.toHaveBeenCalled();
    expect(h.store.version).not.toHaveBeenCalled();
    expect(h.generate.mock.calls[0][0].images).toHaveLength(1);
  });
  it("applies an input-analysis suggestion using its workspace and current full context", async () => {
    const h = harness();
    const inspectId = "55555555-5555-4555-8555-555555555555";
    const response = await h.request({
      action: "reference.extract",
      workspaceId: wid,
      requestId: rid,
      inspectionId: inspectId,
      suggestionId: "1",
    });
    expect(response.status).toBe(200);
    expect(h.store.suggestion).toHaveBeenCalledWith(
      uid,
      inspectId,
      null,
      "1",
      expect.objectContaining({ reference_images: expect.any(Array) }),
      wid,
    );
    expect(
      JSON.parse(h.generate.mock.calls[0][0].text).requestedSuggestion,
    ).toBe("具体修改");
  });
  it("rebuilds from original input after inspection while retaining the version parent for saving", async () => {
    const h = harness({
      version: vi.fn().mockResolvedValue({
        ...version,
        bundle: {
          ...bundle,
          zh: "过短摘要和未经确认的品牌",
          structured: { obsoleteModelGuess: "未经图像证实的功能" },
        },
      }),
    });
    const response = await h.request({
      action: "reference.rewrite",
      workspaceId: wid,
      versionId: vid,
      requestId: rid,
      inspectionId: "55555555-5555-4555-8555-555555555555",
      suggestionId: "1",
    });
    expect(response.status).toBe(200);
    const input = h.generate.mock.calls[0][0];
    expect(JSON.parse(input.text)).toMatchObject({
      original: workspace.source_text,
      keep: workspace.keep_text,
      requestedSuggestion: "具体修改",
      current: null,
    });
    expect(input.text).not.toContain("未经确认的品牌");
    expect(input.images).toHaveLength(1);
    expect(h.store.save).toHaveBeenCalledWith(
      uid, workspace, vid, expect.any(Object), "reference.rewrite", rid,
    );
  });
  it("keeps the full current version as the baseline for a result-analysis suggestion", async () => {
    const h = harness();
    const response = await h.request({
      action: "reference.rewrite",
      workspaceId: wid,
      versionId: vid,
      requestId: rid,
      analysisId: "55555555-5555-4555-8555-555555555555",
      suggestionId: "1",
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(h.generate.mock.calls[0][0].text).current).toEqual(bundle);
    expect(h.store.save).toHaveBeenCalledWith(
      uid, workspace, vid, expect.any(Object), "reference.rewrite", rid,
    );
  });
  it.each(["six", "foreign", "missing-index"])(
    "rejects unsafe image mapping %s before quota admission or model usage",
    async (type) => {
      const refs = Array.from({ length: type === "six" ? 6 : 2 }, (_, i) => ({
        path: `${type === "foreign" && i === 1 ? "another-user" : uid}/${i + 1}.png`,
        role: "auto",
        note: "",
      }));
      const h = harness({
        workspace: vi.fn().mockResolvedValue({
          ...workspace,
          reference_images: refs,
          source_text: type === "missing-index" ? "用图3做背景" : "组合参考图",
        }),
      });
      const response = await h.request({
        action: "reference.extract",
        workspaceId: wid,
        requestId: rid,
      });
      expect(response.status).toBe(400);
      expect(h.store.begin).not.toHaveBeenCalled();
      expect(h.generate).not.toHaveBeenCalled();
    },
  );
  it("rejects an abbreviated report rather than saving a superficially successful result", async () => {
    const h = harness();
    const { report, ...abbreviated } = bundle;
    void report;
    h.generate.mockResolvedValue(JSON.stringify(abbreviated));
    const response = await h.request({
      action: "reference.extract",
      workspaceId: wid,
      requestId: rid,
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "INCOMPLETE_PROFESSIONAL_REPORT",
    });
    expect(h.store.save).not.toHaveBeenCalled();
    expect(h.generate).toHaveBeenCalledTimes(1);
  });
  it("rejects a rewrite that merges away existing structured fields without saving or retrying", async () => {
    const h = harness({
      version: vi.fn().mockResolvedValue({
        ...version,
        bundle: {
          ...bundle,
          structured: {
            主体: "白色竖条纹咖啡机、黑屏、橙色标牌",
            光线: "左侧柔光",
            场景: "厨房",
          },
        },
      }),
    });
    h.generate.mockResolvedValue(
      JSON.stringify({
        ...bundle,
        structured: { 主体: "白色咖啡机", 场景光线: "厨房左侧柔光" },
      }),
    );
    const response = await h.request({
      action: "reference.rewrite",
      workspaceId: wid,
      versionId: vid,
      requestId: rid,
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "MODEL_DETAIL_LOSS" });
    expect(h.store.save).not.toHaveBeenCalled();
    expect(h.store.fail).toHaveBeenCalledWith(rid, uid, "MODEL_DETAIL_LOSS");
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(h.generate.mock.calls[0][0].text).current.structured,
    ).toEqual({
      主体: "白色竖条纹咖啡机、黑屏、橙色标牌",
      光线: "左侧柔光",
      场景: "厨房",
    });
  });
  it("saves a complete reference revision retaining every existing structured field", async () => {
    const h = harness();
    h.generate.mockResolvedValue(
      JSON.stringify({
        ...bundle,
        structured: {
          ...bundle.structured,
          accessory: "right-side storage shelf",
        },
      }),
    );
    const response = await h.request({
      action: "reference.rewrite",
      workspaceId: wid,
      versionId: vid,
      requestId: rid,
    });
    expect(response.status).toBe(200);
    expect(h.store.save).toHaveBeenCalledWith(
      uid,
      expect.anything(),
      vid,
      expect.objectContaining({
        structured: {
          subject: "silver coffee machine",
          accessory: "right-side storage shelf",
        },
      }),
      "reference.rewrite",
      rid,
    );
  });
  it.each([null, { role: "member", active: false }])(
    "rejects non-members without touching model or workspaces (%s)",
    async (member) => {
      const h = harness({ member: vi.fn().mockResolvedValue(member) });
      expect(
        (
          await h.request({
            action: "reference.extract",
            workspaceId: wid,
            requestId: rid,
          })
        ).status,
      ).toBe(403);
      expect(h.store.workspace).not.toHaveBeenCalled();
      expect(h.generate).not.toHaveBeenCalled();
    },
  );
  it("rejects another user’s reference path before admission", async () => {
    const h = harness({
      workspace: vi.fn().mockResolvedValue({
        ...workspace,
        reference_path: "another-user/abc.png",
      }),
    });
    expect(
      (
        await h.request({
          action: "reference.extract",
          workspaceId: wid,
          requestId: rid,
        })
      ).status,
    ).toBe(400);
    expect(h.store.begin).not.toHaveBeenCalled();
  });
  it("rejects another user’s workspace", async () => {
    const h = harness({
      workspace: vi.fn().mockRejectedValue(new StudioError("NOT_FOUND", 404)),
    });
    expect(
      (
        await h.request({
          action: "reference.extract",
          workspaceId: wid,
          requestId: rid,
        })
      ).status,
    ).toBe(404);
    expect(h.generate).not.toHaveBeenCalled();
  });
  it.each(["BUSY", "DAILY_LIMIT"])(
    "does not call paid model if admission reports %s",
    async (code) => {
      const h = harness({
        begin: vi.fn().mockRejectedValue(new StudioError(code, 409)),
      });
      expect(
        (
          await h.request({
            action: "reference.extract",
            workspaceId: wid,
            requestId: rid,
          })
        ).status,
      ).toBe(409);
      expect(h.generate).not.toHaveBeenCalled();
    },
  );
  it("replays a completed request without charging again", async () => {
    const h = harness({
      begin: vi.fn().mockResolvedValue({
        accepted: false,
        request: { status: "succeeded", result: { version } },
      }),
    });
    expect(
      (
        await h.request({
          action: "reference.extract",
          workspaceId: wid,
          requestId: rid,
        })
      ).status,
    ).toBe(200);
    expect(h.generate).not.toHaveBeenCalled();
  });
  it("reports pending duplicates without launching a worker", async () => {
    const h = harness({
      begin: vi
        .fn()
        .mockResolvedValue({ accepted: false, request: { status: "running" } }),
    });
    expect(
      (
        await h.request({
          action: "reference.extract",
          workspaceId: wid,
          requestId: rid,
        })
      ).status,
    ).toBe(202);
    expect(h.generate).not.toHaveBeenCalled();
  });
  it("stale suggestion is rejected before charging or generation", async () => {
    const h = harness({
      suggestion: vi
        .fn()
        .mockRejectedValue(new StudioError("STALE_ANALYSIS", 409)),
    });
    expect(
      (
        await h.request({
          action: "reference.rewrite",
          workspaceId: wid,
          versionId: vid,
          requestId: rid,
          analysisId: rid,
          suggestionId: "1",
        })
      ).status,
    ).toBe(409);
    expect(h.store.begin).not.toHaveBeenCalled();
  });
  it("refuses spoofed image content and marks the request failed", async () => {
    const h = harness({
      image: vi
        .fn()
        .mockResolvedValue(
          new TextEncoder().encode("<svg>not a raster image</svg>"),
        ),
    });
    expect(
      (
        await h.request({
          action: "reference.extract",
          workspaceId: wid,
          requestId: rid,
        })
      ).status,
    ).toBe(400);
    expect(h.store.fail).toHaveBeenCalledWith(rid, uid, "INVALID_IMAGE");
    expect(h.generate).not.toHaveBeenCalled();
  });
  it("reports invalid bilingual output instead of saving a fake success", async () => {
    const h = harness();
    h.fetcher
      .mockReset()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({
          candidates: [
            { content: { parts: [{ text: '{"zh":"only Chinese"}' }] } },
          ],
        }),
      );
    expect(
      (
        await h.request({
          action: "reference.extract",
          workspaceId: wid,
          requestId: rid,
        })
      ).status,
    ).toBe(502);
    expect(h.store.save).not.toHaveBeenCalled();
  });
  it("does not leak raw upstream or database exceptions", async () => {
    const h = harness({
      workspace: vi
        .fn()
        .mockRejectedValue(new Error("synthetic-secret-in-error")),
    });
    const response = await h.request({
      action: "reference.extract",
      workspaceId: wid,
      requestId: rid,
    });
    expect(await response.text()).toBe('{"error":"SERVER_ERROR"}');
  });
  it("aborts the entire operation once and releases its slot on timeout", async () => {
    const h = harness();
    const generate = vi.fn(
      (_input, signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) =>
          signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    );
    const handler = createStudioHandler({
      allowedOrigins: new Set(),
      createStore: () => h.store,
      generate,
      timeoutMs: 15,
    });
    const response = await handler(
      new Request("https://example/api", {
        method: "POST",
        headers: { authorization: "Bearer synthetic-session" },
        body: JSON.stringify({
          action: "reference.extract",
          workspaceId: wid,
          requestId: rid,
        }),
      }),
    );
    expect(response.status).toBe(504);
    expect(h.store.fail).toHaveBeenCalledWith(rid, uid, "REQUEST_TIMEOUT");
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("denies unapproved origins and oversized requests", async () => {
    const h = harness();
    expect(
      (
        await h.request(
          { action: "status" },
          { origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403);
    expect(
      (await h.request({ action: "status", padding: "a".repeat(210_000) }))
        .status,
    ).toBe(413);
  });
});

