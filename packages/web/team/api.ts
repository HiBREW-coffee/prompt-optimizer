import { createClient } from "@supabase/supabase-js";
import type {
  StudioWorkspace,
  StudioVersion,
  PromptAnalysis,
} from "../../../supabase/functions/_shared/studio-contract";
export type {
  StudioWorkspace,
  StudioVersion,
  PromptBundle,
  PromptAnalysis,
  StudioMode,
} from "../../../supabase/functions/_shared/studio-contract";
const url = import.meta.env.VITE_TEAM_SUPABASE_URL;
const publicKey = import.meta.env.VITE_TEAM_SUPABASE_ANON_KEY;
export const needsPassword = /(?:^#|&)type=(invite|recovery|magiclink)/.test(
  location.hash,
);
export const db =
  url && publicKey
    ? createClient(url, publicKey, {
        auth: { storageKey: "prompt-studio-team-auth" },
      })
    : null;
export const SOURCE_URL =
  "https://github.com/HiBREW-coffee/prompt-optimizer/tree/feature/prompt-studio-design-templates-v1";
export const BUCKET = "prompt-studio-references";
export type AnalysisRow = {
  id: string;
  version_id: string;
  result: PromptAnalysis;
  context: Record<string, unknown>;
  created_at: string;
};
export type LibraryRow = {
  id: string;
  owner_id: string;
  title: string;
  mode: string;
  bundle: StudioVersion["bundle"];
  reference_path: string | null;
  created_at: string;
};
const errors: Record<string, string> = {
  NOT_MEMBER: "此账号尚未加入团队，请联系管理员邀请。",
  UNAUTHENTICATED: "登录已过期，请重新登录。",
  FORBIDDEN: "此操作仅管理员可用。",
  BUSY: "当前正在处理其他任务，请稍后再试。",
  DAILY_LIMIT: "今日调用额度已用完，请联系管理员。",
  MODEL_NOT_CONFIGURED: "管理员尚未在服务器配置模型，请稍后使用。",
  SERVER_CONFIGURATION: "服务器模型配置需要检查。",
  REQUEST_TIMEOUT: "本次处理超时。你可以稍后查询结果，或手动发起新操作。",
  REQUEST_INTERRUPTED: "上次请求未完成，请手动重试。",
  REQUEST_CONFLICT: "这次请求的内容已变化，请重新发起。",
  STALE_ANALYSIS: "需求或版本已变化，请重新分析后再应用建议。",
  INVALID_MODEL_OUTPUT: "模型未返回完整的中英及结构化结果，请重试。",
  INCOMPLETE_MODEL_OUTPUT: "模型返回被截断或拒绝，请调整要求后重试。",
  INVALID_IMAGE: "请上传 10MB 以内的 PNG 或 JPEG 图片。",
  IMAGE_REQUIRED: "请先上传参考图。",
  NOT_FOUND: "未找到记录，或你没有访问权限。",
  REFERENCE_LOCKED: "此作品已有版本。更换参考图请新建作品。",
  MODEL_HTTP_401: "模型身份验证失败，请管理员检查服务器配置。",
  MODEL_HTTP_403: "模型暂不可用，请管理员检查权限。",
  MODEL_HTTP_404: "模型接口不存在，请管理员核对模型名称。",
  MODEL_HTTP_429: "模型服务繁忙或额度不足，请稍后重试。",
  ORIGIN_DENIED: "当前网站地址尚未加入后台允许列表，请管理员检查部署配置。",
  INVITE_FAILED: "邀请未生成，请检查账号状态或稍后重试。",
  INVALID_EMAIL: "请填写有效的成员邮箱。",
  INVALID_PASSWORD: "密码需要 12 至 128 位。",
  MEMBER_EXISTS:
    "这个邮箱已有账号。请通过下方邀请链接将其加入工作室，已有密码不会被修改。",
  MEMBER_CREATE_FAILED: "成员未创建，请检查邮箱和密码要求后重试。",
  PASSWORD_UPDATE_FAILED: "密码未修改，请检查密码要求后重试。",
  SHARED_ACCOUNT_PASSWORD: "此账号也用于其他应用。请让成员登录后自行修改密码。",
};
export function message(error: unknown): string {
  if (error instanceof Error && errors[error.message])
    return errors[error.message];
  return "操作未完成，请检查网络后重试。已保存的版本不会丢失。";
}
export async function call<T = Record<string, unknown>>(
  action: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  if (!db) throw new Error("NOT_CONFIGURED");
  const {
    data: { session },
  } = await db.auth.getSession();
  if (!session) throw new Error("UNAUTHENTICATED");
  // No SDK automatic retry for paid operations. A request ID can be looked up without calling the model again.
  const response = await fetch(`${url}/functions/v1/prompt-studio-api`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: publicKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, ...body }),
    signal: AbortSignal.timeout(128_000),
  });
  const result = await response.json().catch(() => ({ error: "SERVER_ERROR" }));
  if (!response.ok) throw new Error(result.error || "SERVER_ERROR");
  return result as T;
}
export async function rows<T>(
  table: string,
  configure?: (query: any) => any,
  max = Infinity,
): Promise<T[]> {
  if (!db) return [];
  const result: T[] = [];
  while (result.length < max) {
    let query = db.from(table).select("*", { count: "exact" });
    if (configure) query = configure(query);
    const { data, error, count } = await query.range(
      result.length,
      Math.min(result.length + 249, max - 1),
    );
    if (error) throw new Error("DATABASE_ERROR");
    if (!data?.length) break;
    result.push(...data);
    if (count !== null && result.length >= count) break;
  }
  return result;
}
export async function signedImage(path: string): Promise<string> {
  const { data, error } = await db!.storage
    .from(BUCKET)
    .createSignedUrl(path, 60);
  if (error) throw new Error("INVALID_IMAGE");
  return data.signedUrl;
}
export async function uploadImage(
  file: File,
  userId: string,
): Promise<{ path: string; preview: string }> {
  if (
    !["image/png", "image/jpeg"].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error("INVALID_IMAGE");
  const bitmap = await createImageBitmap(file);
  if (bitmap.width * bitmap.height > 40_000_000) {
    bitmap.close();
    throw new Error("INVALID_IMAGE");
  }
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d")!;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // Browser re-encoding strips metadata and limits edge-runtime CPU and upload bandwidth.
  const image = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("INVALID_IMAGE"))),
      file.type,
      0.9,
    ),
  );
  const path = `${userId}/${crypto.randomUUID()}.${file.type === "image/png" ? "png" : "jpg"}`;
  const { error } = await db!.storage
    .from(BUCKET)
    .upload(path, image, { contentType: file.type, upsert: false });
  if (error) throw new Error("INVALID_IMAGE");
  return { path, preview: URL.createObjectURL(image) };
}
export function download(
  name: string,
  value: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export async function exportPrivateData() {
  const [workspaces, versions, analyses] = await Promise.all([
    rows<StudioWorkspace>("ps_workspaces"),
    rows<StudioVersion>("ps_versions"),
    rows<AnalysisRow>("ps_analyses"),
  ]);
  download(
    "prompt-studio-export.json",
    JSON.stringify(
      {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        workspaces: workspaces.map(({ reference_path, ...w }) => ({
          ...w,
          hasReference: Boolean(reference_path),
        })),
        versions: versions.map((v) => ({
          ...v,
          context: { ...v.context, reference_path: undefined },
        })),
        analyses: analyses.map((a) => ({
          ...a,
          context: { ...a.context, reference_path: undefined },
        })),
      },
      null,
      2,
    ),
  );
}
