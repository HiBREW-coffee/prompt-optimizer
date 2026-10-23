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
      expect(input.contents[0].parts[1].inlineData.mimeType).toBe("image/png");
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
      score: 83,
      summary: "需要更具体的光线描述",
      dimensions: [{ name: "保真度", score: 83, reason: "左侧光线吻合" }],
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
    expect(input.contents[0].parts).toHaveLength(2);
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
  it("rejects a rewrite that merges away existing structured fields without saving or retrying", async () => {
    const h = harness({
      version: vi
        .fn()
        .mockResolvedValue({
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
      (await h.request({ action: "status", padding: "a".repeat(110_000) }))
        .status,
    ).toBe(413);
  });
});
