import {
  AI_ACTIONS,
  REQUEST_TIMEOUT_MS,
  MAX_TOTAL_IMAGE_BYTES,
  StudioError,
  imageMime,
  limitedText,
  normalizeAnalysis,
  normalizeBundle,
  normalizeReferences,
  workspaceReferences,
  workspaceContext,
  validateReferenceMentions,
  parseObject,
  record,
  requireId,
  stableJson,
} from "./studio-contract.ts";
import type {
  AiAction,
  StudioVersion,
  StudioWorkspace,
} from "./studio-contract.ts";
import { buildStudioPrompt } from "./studio-prompts.ts";
import type { GeminiInput } from "./studio-gemini.ts";

export interface StudioStore {
  user(token: string): Promise<{ id: string }>;
  member(user: string): Promise<{ role: string; active: boolean } | null>;
  workspace(user: string, id: string): Promise<StudioWorkspace>;
  version(workspace: string, id: string): Promise<StudioVersion>;
  begin(
    id: string,
    user: string,
    workspace: string,
    action: string,
    hash: string,
  ): Promise<{
    accepted: boolean;
    request?: { status: string; result?: unknown; error_code?: string };
  }>;
  image(path: string): Promise<Uint8Array>;
  suggestion(
    user: string,
    analysisId: string,
    versionId: string | null,
    suggestionId: string,
    context: unknown,
    workspaceId?: string,
  ): Promise<string>;
  save(
    user: string,
    workspace: StudioWorkspace,
    parent: string | null,
    bundle: unknown,
    kind: string,
    request?: string,
  ): Promise<unknown>;
  analyze(
    user: string,
    versionId: string,
    result: unknown,
    context: unknown,
    request: string,
  ): Promise<unknown>;
  inspect(
    user: string,
    workspace: string,
    result: unknown,
    context: unknown,
    request: string,
  ): Promise<unknown>;
  fail(id: string, user: string, code: string): Promise<void>;
  command(
    user: string,
    admin: boolean,
    action: string,
    body: Record<string, unknown>,
  ): Promise<unknown>;
}
export interface HandlerDependencies {
  allowedOrigins: Set<string>;
  createStore(signal: AbortSignal): StudioStore;
  generate(input: GeminiInput, signal: AbortSignal): Promise<string>;
  timeoutMs?: number;
}
export function createStudioHandler(deps: HandlerDependencies) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
    });
    if (origin && !deps.allowedOrigins.has(origin))
      return new Response(JSON.stringify({ error: "ORIGIN_DENIED" }), {
        status: 403,
        headers,
      });
    if (origin) headers.set("Access-Control-Allow-Origin", origin);
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST")
      return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
        status: 405,
        headers,
      });
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      deps.timeoutMs ?? REQUEST_TIMEOUT_MS,
    );
    const store = deps.createStore(controller.signal);
    let admitted: string | null = null,
      userId = "";
    try {
      const bearer = request.headers
        .get("authorization")
        ?.match(/^Bearer (.+)$/i)?.[1];
      if (!bearer) throw new StudioError("UNAUTHENTICATED", 401);
      const user = await store.user(bearer);
      userId = user.id;
      const member = await store.member(user.id);
      if (!member?.active) throw new StudioError("NOT_MEMBER", 403);
      const text = await readBody(request, 200_000);
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(text);
        if (!record(parsed)) throw new Error();
        body = parsed;
      } catch {
        throw new StudioError("INVALID_REQUEST");
      }
      const action = limitedText(body.action, 50);
      if (!AI_ACTIONS.includes(action as AiAction)) {
        const data = await store.command(
          user.id,
          member.role === "admin",
          action,
          body,
        );
        return new Response(JSON.stringify(data), { headers });
      }
      const workspace = await store.workspace(
        user.id,
        requireId(body.workspaceId),
      );
      const version = body.versionId
        ? await store.version(workspace.id, requireId(body.versionId))
        : null;
      if (action === "text.optimize" && workspace.mode !== "text")
        throw new StudioError("INVALID_ACTION");
      if (action.startsWith("reference.") && workspace.mode !== "reference")
        throw new StudioError("INVALID_ACTION");
      if (workspace.mode === "text" && !workspace.source_text.trim())
        throw new StudioError("PROMPT_REQUIRED");
      if (["reference.rewrite", "prompt.evaluate"].includes(action) && !version)
        throw new StudioError("VERSION_REQUIRED");
      if (action === "reference.extract" && version)
        throw new StudioError("INVALID_ACTION");
      const references = normalizeReferences(
        workspaceReferences(workspace),
        user.id,
      );
      if (workspace.mode === "reference" && references.length === 0)
        throw new StudioError("IMAGE_REQUIRED");
      if (workspace.mode === "reference")
        validateReferenceMentions(
          [
            workspace.source_text,
            workspace.keep_text,
            workspace.change_text,
          ].join("\n"),
          references.length,
        );
      const context = workspaceContext(workspace);
      let suggestion = "";
      if (body.analysisId) {
        if (!version) throw new StudioError("VERSION_REQUIRED");
        suggestion = await store.suggestion(
          user.id,
          requireId(body.analysisId),
          version.id,
          limitedText(body.suggestionId, 10),
          context,
        );
      }
      if (body.inspectionId) {
        if (body.analysisId) throw new StudioError("INVALID_REQUEST");
        suggestion = await store.suggestion(
          user.id,
          requireId(body.inspectionId),
          null,
          limitedText(body.suggestionId, 30),
          context,
          workspace.id,
        );
      }
      const id = requireId(body.requestId);
      const hashBytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          stableJson({
            action,
            workspace: workspace.id,
            version: version?.id,
            context,
            suggestion,
          }),
        ),
      );
      const hash = Array.from(new Uint8Array(hashBytes), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      const admission = await store.begin(
        id,
        user.id,
        workspace.id,
        action,
        hash,
      );
      if (!admission.accepted) {
        const previous = admission.request!;
        if (previous.status === "failed")
          throw new StudioError(previous.error_code ?? "REQUEST_FAILED", 409);
        return new Response(
          JSON.stringify(
            previous.status === "succeeded"
              ? previous.result
              : { pending: true, requestId: id },
          ),
          { status: previous.status === "succeeded" ? 200 : 202, headers },
        );
      }
      admitted = id;
      const input = buildStudioPrompt(
        action as AiAction,
        workspace,
        version,
        suggestion,
      );
      if (workspace.mode === "reference") {
        let totalBytes = 0;
        input.images = [];
        for (const [index, reference] of references.entries()) {
          const bytes = await store.image(reference.path);
          totalBytes += bytes.length;
          if (totalBytes > MAX_TOTAL_IMAGE_BYTES)
            throw new StudioError("IMAGES_TOO_LARGE");
          const mimeType = imageMime(bytes);
          // Chunked encoding avoids an argument-stack overflow for a 10MB image.
          let binary = "";
          for (let start = 0; start < bytes.length; start += 8192)
            binary += String.fromCharCode(
              ...bytes.subarray(start, start + 8192),
            );
          input.images.push({ data: btoa(binary), mimeType, index: index + 1 });
        }
      }
      if (controller.signal.aborted)
        throw new StudioError("REQUEST_TIMEOUT", 504);
      const raw = await deps.generate(input, controller.signal);
      if (controller.signal.aborted)
        throw new StudioError("REQUEST_TIMEOUT", 504);
      const parsed = parseObject(raw);
      const isAnalysis =
        action === "prompt.evaluate" || action === "prompt.inspect";
      const bundle = isAnalysis ? null : normalizeBundle(parsed);
      const analysisResult = isAnalysis
        ? normalizeAnalysis(parsed, { requireScale: true })
        : null;
      if (
        analysisResult &&
        (!analysisResult.structure ||
          analysisResult.structure.length < 4 ||
          analysisResult.dimensions.length < 4 ||
          !analysisResult.imageRoles ||
          analysisResult.imageRoles.length !== references.length ||
          analysisResult.imageRoles.some(
            (item) => item.index > references.length,
          ))
      )
        throw new StudioError("INCOMPLETE_PROFESSIONAL_REPORT", 502);
      if (
        bundle &&
        (!bundle.report ||
          bundle.report.sections.length < 4 ||
          bundle.report.imageRoles.length !== references.length ||
          bundle.report.imageRoles.some(
            (item) => item.index > references.length,
          ))
      )
        throw new StudioError("INCOMPLETE_PROFESSIONAL_REPORT", 502);
      if (bundle && version && (action === "reference.rewrite" || suggestion)) {
        if (
          Object.keys(version.bundle.structured).some(
            (key) => !Object.hasOwn(bundle.structured, key),
          )
        )
          throw new StudioError("MODEL_DETAIL_LOSS", 502);
      }
      const result =
        action === "prompt.inspect"
          ? await store.inspect(
              user.id,
              workspace.id,
              analysisResult!,
              context,
              id,
            )
          : action === "prompt.evaluate"
            ? await store.analyze(
                user.id,
                version!.id,
                analysisResult!,
                context,
                id,
              )
            : await store.save(
                user.id,
                workspace,
                version?.id ?? null,
                bundle!,
                action,
                id,
              );
      return new Response(JSON.stringify(result), { headers });
    } catch (error) {
      const known = error instanceof StudioError ? error : null;
      const code = controller.signal.aborted
        ? "REQUEST_TIMEOUT"
        : (known?.code ?? "SERVER_ERROR");
      if (admitted) await store.fail(admitted, userId, code).catch(() => {});
      // Never return upstream errors, headers, user input or credential-bearing SDK diagnostics.
      return new Response(JSON.stringify({ error: code }), {
        status: code === "REQUEST_TIMEOUT" ? 504 : (known?.status ?? 500),
        headers,
      });
    } finally {
      clearTimeout(timer);
    }
  };
}
async function readBody(request: Request, max: number): Promise<string> {
  if (Number(request.headers.get("content-length")) > max)
    throw new StudioError("REQUEST_TOO_LARGE", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new StudioError("INVALID_REQUEST");
  let size = 0,
    body = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new StudioError("REQUEST_TOO_LARGE", 413);
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
}
