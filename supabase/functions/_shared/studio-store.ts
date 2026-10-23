import type { SupabaseClient } from "@supabase/supabase-js";
import {
  StudioError,
  limitedText,
  normalizeBundle,
  ownsImage,
  record,
  requireId,
  stableJson,
} from "./studio-contract.ts";
import type { StudioVersion, StudioWorkspace } from "./studio-contract.ts";
import type { StudioStore } from "./studio-handler.ts";

const BUCKET = "prompt-studio-references";
function check(error: { message?: string } | null): void {
  if (!error) return;
  const code = [
    "DAILY_LIMIT",
    "BUSY",
    "REQUEST_CONFLICT",
    "NOT_FOUND",
    "REQUEST_INTERRUPTED",
    "NOT_MEMBER",
  ].find((c) => error.message?.includes(c));
  throw new StudioError(
    code ?? "DATABASE_ERROR",
    code === "NOT_FOUND" ? 404 : code === "NOT_MEMBER" ? 403 : code ? 409 : 500,
  );
}
export class SupabaseStudioStore implements StudioStore {
  constructor(
    private db: SupabaseClient,
    private appUrl: string,
    private configured: boolean,
  ) {}
  async user(token: string) {
    const { data, error } = await this.db.auth.getUser(token);
    if (error || !data.user) throw new StudioError("UNAUTHENTICATED", 401);
    return { id: data.user.id };
  }
  async member(user: string) {
    const { data, error } = await this.db
      .from("ps_members")
      .select("role,active")
      .eq("user_id", user)
      .maybeSingle();
    check(error);
    return data;
  }
  async workspace(user: string, id: string): Promise<StudioWorkspace> {
    const { data, error } = await this.db
      .from("ps_workspaces")
      .select("*")
      .eq("id", id)
      .eq("owner_id", user)
      .maybeSingle();
    check(error);
    if (!data) throw new StudioError("NOT_FOUND", 404);
    return data;
  }
  async version(workspace: string, id: string): Promise<StudioVersion> {
    const { data, error } = await this.db
      .from("ps_versions")
      .select("*")
      .eq("id", id)
      .eq("workspace_id", workspace)
      .maybeSingle();
    check(error);
    if (!data) throw new StudioError("NOT_FOUND", 404);
    return data;
  }
  async begin(
    id: string,
    user: string,
    workspace: string,
    action: string,
    hash: string,
  ) {
    const { data, error } = await this.db.rpc("ps_begin_request", {
      p_id: id,
      p_user: user,
      p_workspace: workspace,
      p_action: action,
      p_hash: hash,
    });
    check(error);
    return data;
  }
  async image(path: string) {
    const { data, error } = await this.db.storage.from(BUCKET).download(path);
    check(error);
    if (!data || data.size > 10 * 1024 * 1024)
      throw new StudioError("INVALID_IMAGE");
    return new Uint8Array(await data.arrayBuffer());
  }
  async suggestion(
    user: string,
    analysisId: string,
    versionId: string,
    suggestionId: string,
    context: unknown,
  ) {
    const { data, error } = await this.db
      .from("ps_analyses")
      .select("version_id,result,context")
      .eq("id", analysisId)
      .eq("version_id", versionId)
      .maybeSingle();
    check(error);
    if (!data || stableJson(data.context) !== stableJson(context))
      throw new StudioError("STALE_ANALYSIS", 409);
    // version() is checked against the user's workspace before reaching here.
    void user;
    const suggestion = data.result.suggestions?.find(
      (s: { id: string }) => s.id === suggestionId,
    );
    if (!suggestion) throw new StudioError("NOT_FOUND", 404);
    return limitedText(suggestion.instruction, 2000);
  }
  async save(
    user: string,
    workspace: StudioWorkspace,
    parent: string | null,
    bundle: unknown,
    kind: string,
    request?: string,
  ) {
    const { data, error } = await this.db.rpc("ps_append_version", {
      p_user: user,
      p_workspace: workspace.id,
      p_parent: parent,
      p_bundle: bundle,
      p_context: {
        source: workspace.source_text,
        keep: workspace.keep_text,
        change: workspace.change_text,
        reference_path: workspace.reference_path,
      },
      p_kind: kind,
      p_request: request ?? null,
    });
    check(error);
    return data;
  }
  async analyze(
    user: string,
    versionId: string,
    result: unknown,
    context: unknown,
    request: string,
  ) {
    const { data, error } = await this.db.rpc("ps_complete_analysis", {
      p_user: user,
      p_version: versionId,
      p_result: result,
      p_context: context,
      p_request: request,
    });
    check(error);
    return data;
  }
  async fail(id: string, user: string, code: string) {
    // A timeout must still be able to release its admission slot using a fresh connection signal.
    const { error } = await this.db
      .from("ps_requests")
      .update({
        status: "failed",
        error_code: code,
        finished_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("owner_id", user)
      .eq("status", "running");
    check(error);
  }
  async command(
    user: string,
    admin: boolean,
    action: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    if (action === "status") {
      const day =
        new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10) +
        "T00:00:00+08:00";
      const [settings, usage, member] = await Promise.all([
        this.db.from("ps_settings").select("*").single(),
        this.db
          .from("ps_requests")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", user)
          .gte("created_at", day),
        this.db
          .from("ps_members")
          .select("daily_limit")
          .eq("user_id", user)
          .single(),
      ]);
      check(settings.error);
      check(usage.error);
      check(member.error);
      return {
        configured: this.configured,
        settings: settings.data,
        used: usage.count ?? 0,
        dailyLimit: member.data?.daily_limit ?? settings.data.member_daily,
      };
    }
    if (action === "workspace.save") {
      const mode = body.mode;
      if (mode !== "text" && mode !== "reference")
        throw new StudioError("INVALID_ACTION");
      const path = body.referencePath ?? null;
      if (path !== null && !ownsImage(path, user))
        throw new StudioError("INVALID_IMAGE");
      const changes = {
        title: limitedText(body.title, 120) || "未命名提示词",
        source_text: limitedText(body.sourceText),
        keep_text: limitedText(body.keepText, 8000),
        change_text: limitedText(body.changeText, 8000),
        reference_path: path,
        mode,
        updated_at: new Date().toISOString(),
      };
      if (body.workspaceId) {
        const w = await this.workspace(user, requireId(body.workspaceId));
        if (
          w.mode !== mode ||
          (w.current_version_id && w.reference_path !== path)
        )
          throw new StudioError("REFERENCE_LOCKED", 409);
        const { data, error } = await this.db
          .from("ps_workspaces")
          .update(changes)
          .eq("id", w.id)
          .eq("owner_id", user)
          .select()
          .single();
        check(error);
        return { workspace: data };
      }
      const { data, error } = await this.db
        .from("ps_workspaces")
        .insert({ ...changes, owner_id: user })
        .select()
        .single();
      check(error);
      return { workspace: data };
    }
    if (action === "workspace.favorite") {
      const w = await this.workspace(user, requireId(body.workspaceId));
      if (typeof body.favorite !== "boolean")
        throw new StudioError("INVALID_REQUEST");
      const { error } = await this.db
        .from("ps_workspaces")
        .update({ favorite: body.favorite })
        .eq("id", w.id)
        .eq("owner_id", user);
      check(error);
      return { ok: true };
    }
    if (action === "version.save" || action === "version.restore") {
      const w = await this.workspace(user, requireId(body.workspaceId));
      const parent = body.versionId ? requireId(body.versionId) : null;
      if (parent) await this.version(w.id, parent);
      if (action === "version.restore") {
        const source = await this.version(w.id, requireId(body.restoreId));
        // Preserve the restored version's original source requirements too.
        const context = source.context;
        const restored = {
          ...w,
          source_text: String(context.source ?? ""),
          keep_text: String(context.keep ?? ""),
          change_text: String(context.change ?? ""),
        };
        return await this.save(
          user,
          restored,
          w.current_version_id,
          source.bundle,
          "restore",
        );
      }
      return await this.save(
        user,
        w,
        parent,
        normalizeBundle(body.bundle),
        "manual",
      );
    }
    if (action === "library.publish") {
      const w = await this.workspace(user, requireId(body.workspaceId));
      const v = await this.version(w.id, requireId(body.versionId));
      const includeImage = body.includeImage === true;
      const { data, error } = await this.db
        .from("ps_library")
        .insert({
          owner_id: user,
          title: w.title,
          mode: w.mode,
          bundle: v.bundle,
          context: {
            source: v.bundle.zh,
            keep: "",
            change: "",
            reference_path: null,
          },
          reference_path: includeImage ? w.reference_path : null,
        })
        .select()
        .single();
      check(error);
      return { item: data };
    }
    if (action === "library.unpublish") {
      const { error } = await this.db
        .from("ps_library")
        .delete()
        .eq("id", requireId(body.libraryId))
        .eq("owner_id", user);
      check(error);
      return { ok: true };
    }
    if (action === "library.import") {
      const { data: item, error } = await this.db
        .from("ps_library")
        .select("*")
        .eq("id", requireId(body.libraryId))
        .single();
      check(error);
      let path: string | null = null;
      if (item.reference_path) {
        path = `${user}/${crypto.randomUUID()}.${item.reference_path.endsWith(".png") ? "png" : "jpg"}`;
        const copied = await this.db.storage
          .from(BUCKET)
          .copy(item.reference_path, path);
        check(copied.error);
      }
      const { data: w, error: created } = await this.db
        .from("ps_workspaces")
        .insert({
          owner_id: user,
          title: item.title,
          mode: path ? "reference" : "text",
          source_text: String(item.context.source || item.bundle.zh),
          keep_text: String(item.context.keep ?? ""),
          change_text: String(item.context.change ?? ""),
          reference_path: path,
        })
        .select()
        .single();
      check(created);
      return {
        workspace: w,
        ...((await this.save(
          user,
          w,
          null,
          normalizeBundle(item.bundle),
          "library",
        )) as object),
      };
    }
    if (!admin) throw new StudioError("FORBIDDEN", 403);
    if (action === "member.create") {
      const email = limitedText(body.email, 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new StudioError("INVALID_EMAIL");
      const password = memberPassword(body.password);
      // Never change an existing shared Auth account when adding a studio member.
      const created = await this.db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { prompt_studio_managed: true },
      });
      if (created.error || !created.data.user)
        throw new StudioError(
          ["email_exists", "user_already_exists"].includes(
            created.error?.code ?? "",
          )
            ? "MEMBER_EXISTS"
            : "MEMBER_CREATE_FAILED",
          400,
        );
      const { error } = await this.db.from("ps_members").insert({
        user_id: created.data.user.id,
        email,
        role: "member",
        active: true,
      });
      // An interrupted provision can be completed through the existing invitation flow.
      check(error);
      return { ok: true };
    }
    if (action === "member.password") {
      const target = requireId(body.userId);
      if (target === user) throw new StudioError("CANNOT_EDIT_SELF");
      const password = memberPassword(body.password);
      const member = await this.db
        .from("ps_members")
        .select("role")
        .eq("user_id", target)
        .maybeSingle();
      check(member.error);
      if (member.data?.role !== "member")
        throw new StudioError("FORBIDDEN", 403);
      const account = await this.db.auth.admin.getUserById(target);
      if (
        account.error ||
        account.data.user?.app_metadata?.prompt_studio_managed !== true
      )
        throw new StudioError("SHARED_ACCOUNT_PASSWORD", 403);
      const updated = await this.db.auth.admin.updateUserById(target, {
        password,
      });
      if (updated.error) throw new StudioError("PASSWORD_UPDATE_FAILED", 400);
      return { ok: true };
    }
    if (action === "member.invite") {
      const email = limitedText(body.email, 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new StudioError("INVALID_EMAIL");
      let invitation = await this.db.auth.admin.generateLink({
        type: "invite",
        email,
        options: { redirectTo: this.appUrl },
      });
      if (invitation.error?.code === "email_exists")
        invitation = await this.db.auth.admin.generateLink({
          type: "magiclink",
          email,
          options: { redirectTo: this.appUrl },
        });
      if (
        invitation.error ||
        !invitation.data.user ||
        !invitation.data.properties
      )
        throw new StudioError("INVITE_FAILED", 400);
      const { error } = await this.db.from("ps_members").upsert(
        {
          user_id: invitation.data.user.id,
          email,
          role: "member",
          active: true,
        },
        { onConflict: "user_id", ignoreDuplicates: true },
      );
      check(error);
      // Only the authenticated admin receives this link; it is never logged or saved in app records.
      return { inviteUrl: invitation.data.properties.action_link };
    }
    if (action === "member.update") {
      const target = requireId(body.userId);
      if (target === user) throw new StudioError("CANNOT_EDIT_SELF");
      if (
        typeof body.active !== "boolean" ||
        (body.dailyLimit !== null &&
          (!Number.isInteger(body.dailyLimit) ||
            Number(body.dailyLimit) < 1 ||
            Number(body.dailyLimit) > 10000))
      )
        throw new StudioError("INVALID_REQUEST");
      const { error } = await this.db
        .from("ps_members")
        .update({ active: body.active, daily_limit: body.dailyLimit })
        .eq("user_id", target)
        .eq("role", "member");
      check(error);
      return { ok: true };
    }
    if (action === "settings.update") {
      if (!record(body.settings)) throw new StudioError("INVALID_REQUEST");
      const s = body.settings;
      for (const [key, max] of [
        ["member_daily", 10000],
        ["team_daily", 100000],
        ["user_concurrent", 3],
        ["team_concurrent", 10],
      ] as const) {
        if (
          !Number.isInteger(s[key]) ||
          Number(s[key]) < 1 ||
          Number(s[key]) > max
        )
          throw new StudioError("INVALID_REQUEST");
      }
      const { error } = await this.db
        .from("ps_settings")
        .update({
          member_daily: s.member_daily,
          team_daily: s.team_daily,
          user_concurrent: s.user_concurrent,
          team_concurrent: s.team_concurrent,
        })
        .eq("id", true);
      check(error);
      return { ok: true };
    }
    throw new StudioError("INVALID_ACTION");
  }
}

function memberPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 128)
    throw new StudioError("INVALID_PASSWORD");
  return value;
}
