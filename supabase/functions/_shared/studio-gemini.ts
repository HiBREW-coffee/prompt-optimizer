import { StudioError } from "./studio-contract.ts";

export interface GeminiInput {
  system: string;
  text: string;
  image?: { data: string; mimeType: string };
}
type Fetcher = typeof fetch;
const LK888 = "https://api.lk888.ai";

/** Fixed upstream. No caller-provided host, model, headers or tools are accepted. */
export async function generateStudioJson(
  input: GeminiInput,
  options: {
    key: string;
    model: string;
    signal: AbortSignal;
    fetcher?: Fetcher;
  },
): Promise<string> {
  if (!/^[a-zA-Z0-9._-]+$/.test(options.model))
    throw new StudioError("SERVER_CONFIGURATION", 503);
  const transport = options.fetcher ?? fetch;
  const parts: Record<string, unknown>[] = [{ text: input.text }];
  if (input.image) parts.push({ inlineData: input.image });
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: input.system }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
    },
  });
  const request = (stream: boolean) =>
    transport(
      `${LK888}/v1beta/models/${options.model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`,
      {
        method: "POST",
        redirect: "error",
        signal: options.signal,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": options.key,
        },
        body,
      },
    );
  let response = await request(true);
  // Retry only a missing/unsupported LK888 stream route, before consuming any chunk.
  if ([404, 405, 501].includes(response.status) && !options.signal.aborted) {
    await response.body?.cancel();
    response = await request(false);
    if (!response.ok)
      throw new StudioError(`MODEL_HTTP_${response.status}`, 502);
    return extractText(await response.json());
  }
  if (!response.ok) throw new StudioError(`MODEL_HTTP_${response.status}`, 502);
  if (
    !response.headers.get("content-type")?.includes("text/event-stream") ||
    !response.body
  ) {
    throw new StudioError("INVALID_MODEL_STREAM", 502);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    output = "",
    consumed = 0;
  const event = (block: string) => {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return;
    let chunk: unknown;
    try {
      chunk = JSON.parse(data);
    } catch {
      throw new StudioError("INVALID_MODEL_STREAM", 502);
    }
    output += extractText(chunk, true);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      consumed += value.length;
      if (consumed > 2_000_000)
        throw new StudioError("MODEL_OUTPUT_TOO_LARGE", 502);
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(
        /\r\n/g,
        "\n",
      );
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        event(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) event(buffer);
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!output.trim()) throw new StudioError("EMPTY_MODEL_OUTPUT", 502);
  return output;
}

function extractText(value: unknown, allowEmpty = false): string {
  const v = value as {
    error?: unknown;
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      finishReason?: string;
    }>;
  };
  if (v.error) throw new StudioError("MODEL_RESPONSE_ERROR", 502);
  const candidate = v.candidates?.[0];
  if (
    candidate?.finishReason &&
    !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(candidate.finishReason)
  ) {
    throw new StudioError("INCOMPLETE_MODEL_OUTPUT", 502);
  }
  const text =
    candidate?.content?.parts
      ?.filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("") ?? "";
  if (!allowEmpty && !text.trim())
    throw new StudioError("EMPTY_MODEL_OUTPUT", 502);
  return text;
}
