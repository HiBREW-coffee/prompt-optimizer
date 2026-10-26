// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { generateStudioJson } from "../../../../supabase/functions/_shared/studio-gemini";
const input = {
  system: "fixed instruction",
  text: "保留机位，主体改为银色",
  image: { data: "cG5n", mimeType: "image/png" },
};
const output = (text: string) => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
});
const options = (fetcher: typeof fetch) => ({
  key: "synthetic-test-value",
  model: "gem-3.8-flash",
  signal: new AbortController().signal,
  fetcher,
});
function sse(...texts: string[]) {
  return new Response(
    texts.map((text) => `data: ${JSON.stringify(output(text))}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}
describe("fixed LK888 team transport", () => {
  it("keeps image numbering and byte payloads unchanged when five-image streaming falls back", async () => {
    const images = Array.from({ length: 5 }, (_, i) => ({
      index: i + 1,
      data: btoa(`image-${i + 1}`),
      mimeType: "image/png",
    }));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 405 }))
      .mockResolvedValueOnce(Response.json(output("ok")));
    expect(
      await generateStudioJson(
        { ...input, image: undefined, images },
        options(fetcher),
      ),
    ).toBe("ok");
    expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body);
    const parts = JSON.parse(String(fetcher.mock.calls[0][1]?.body)).contents[0]
      .parts;
    expect(parts).toHaveLength(11);
    images.forEach((image, i) => {
      expect(parts[1 + i * 2].text).toContain(`图${i + 1}`);
      expect(parts[2 + i * 2].inlineData).toEqual({
        data: image.data,
        mimeType: image.mimeType,
      });
    });
    expect(String(fetcher.mock.calls[0][0])).not.toContain(
      "synthetic-test-value",
    );
  });
  it.each([404, 405, 501])(
    "retries missing streaming route %s once, retaining input and shared deadline",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response("unsupported", { status }))
        .mockResolvedValueOnce(Response.json(output('{"ok":true}')));
      const opts = options(fetcher);
      expect(await generateStudioJson(input, opts)).toBe('{"ok":true}');
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[0][0]).toBe(
        "https://api.lk888.ai/v1beta/models/gem-3.8-flash:streamGenerateContent?alt=sse",
      );
      expect(fetcher.mock.calls[1][0]).toBe(
        "https://api.lk888.ai/v1beta/models/gem-3.8-flash:generateContent",
      );
      expect(fetcher.mock.calls[0][1]?.body).toBe(
        fetcher.mock.calls[1][1]?.body,
      );
      for (const call of fetcher.mock.calls) {
        expect(call[1]?.signal).toBe(opts.signal);
        expect(call[1]?.redirect).toBe("error");
      }
      const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
      expect(body.contents[0].parts[1]).toEqual({ inlineData: input.image });
    },
  );
  it.each([400, 401, 403, 408, 429, 500, 502])(
    "never retries upstream %s",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response("private upstream diagnostics", { status }),
        );
      await expect(
        generateStudioJson(input, options(fetcher)),
      ).rejects.toMatchObject({ code: `MODEL_HTTP_${status}` });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("assembles healthy stream without a second call", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(sse('{"ok":', "true}"));
    expect(await generateStudioJson(input, options(fetcher))).toBe(
      '{"ok":true}',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("handles CRLF and UTF8 split across byte boundaries", async () => {
    const bytes = new TextEncoder().encode(
      `data: ${JSON.stringify(output("你好"))}\r\n\r\n`,
    );
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            for (const b of bytes) c.enqueue(new Uint8Array([b]));
            c.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
    expect(await generateStudioJson(input, options(fetcher))).toBe("你好");
  });
  it("does not retry a stream that fails after output", async () => {
    const bytes = new TextEncoder().encode(
      `data: ${JSON.stringify(output("partial"))}\n\ndata: {"error":{"code":404}}\n\n`,
    );
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(bytes, {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    await expect(
      generateStudioJson(input, options(fetcher)),
    ).rejects.toMatchObject({ code: "MODEL_RESPONSE_ERROR" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not retry network errors", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("offline"));
    await expect(generateStudioJson(input, options(fetcher))).rejects.toThrow(
      "offline",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not retry an aborted request", async () => {
    const abort = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      abort.abort();
      return new Response("", { status: 404 });
    });
    await expect(
      generateStudioJson(input, { ...options(fetcher), signal: abort.signal }),
    ).rejects.toMatchObject({ code: "MODEL_HTTP_404" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not recursively retry a failed fallback", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("", { status: 404 }));
    await expect(
      generateStudioJson(input, options(fetcher)),
    ).rejects.toMatchObject({ code: "MODEL_HTTP_404" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects truncated model output and excludes thought text", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(sse("x"));
    fetcher.mockResolvedValueOnce(
      new Response(
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "private reasoning", thought: true }, { text: "answer" }] }, finishReason: "STOP" }] })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
    expect(await generateStudioJson(input, options(fetcher))).toBe("answer");
    fetcher.mockResolvedValue(
      new Response(
        `data: ${JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS" }] })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
    await expect(
      generateStudioJson(input, options(fetcher)),
    ).rejects.toMatchObject({ code: "INCOMPLETE_MODEL_OUTPUT" });
  });
  it("refuses endpoint injection through the configured model", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      generateStudioJson(input, { ...options(fetcher), model: "../secret" }),
    ).rejects.toMatchObject({ code: "SERVER_CONFIGURATION" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
