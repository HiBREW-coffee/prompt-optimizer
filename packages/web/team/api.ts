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
  ReferenceImage,
  ReferenceIntent,
  ProfessionalReport,
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
  reference_images?: import("../../../supabase/functions/_shared/studio-contract").ReferenceImage[];
  created_at: string;
};
export type InspectionRow = Omit<AnalysisRow, "version_id"> & {
  workspace_id: string;
  owner_id: string;
};
const errors: Record<string, string> = {
  INVALID_SCORE_SCALE:
    "模型评分的量表或分值不符合要求，本次未保存分数。请稍后手动重新分析。",
  INCOMPLETE_PROFESSIONAL_REPORT:
    "模型未返回完整的专业报告，本次没有保存不完整版本。请稍后手动重试。",
  INVALID_REFERENCE_IMAGES:
    "最多上传 5 张 PNG / JPEG 图片，图片不能重复且必须属于你的私人空间。",
  REFERENCE_INDEX_MISSING:
    "提示词引用了未上传的图片编号。请检查图1～图5与当前图片是否对应。",
  IMAGES_TOO_LARGE: "图片处理后合计超过 20MB，请压缩图片后再试。",
  NOT_MEMBER: "此账号尚未加入团队，请联系管理员邀请。",
  UNAUTHENTICATED: "登录已过期，请重新登录。",
  FORBIDDEN: "此操作仅管理员可用。",
  BUSY: "当前正在处理其他任务，请稍后再试。",
  DAILY_LIMIT: "今日调用额度已用完，请联系管理员。",
  INVALID_MEMORY: "请填写简短、可复用的经验，或合并过多的经验卡。",
  DUPLICATE_MEMORY: "已有相同的经验规则，请合并后保存。",
  MEMORY_TOO_LARGE: "经验内容过多，请只保留最重要的文字规则。",
  MODEL_NOT_CONFIGURED: "管理员尚未在服务器配置模型，请稍后使用。",
  SERVER_CONFIGURATION: "服务器模型配置需要检查。",
  REQUEST_TIMEOUT: "本次处理超时。你可以稍后查询结果，或手动发起新操作。",
  REQUEST_INTERRUPTED: "上次请求未完成，请手动重试。",
  REQUEST_CONFLICT: "这次请求的内容已变化，请重新发起。",
  STALE_ANALYSIS: "需求或版本已变化，请重新分析后再应用建议。",
  STALE_WORKSPACE: "另一页面修改了本次需求，已停止调用模型。请核对当前提示词、保留项和图片后重新操作。",
  INVALID_MODEL_OUTPUT: "模型未返回完整的中英及结构化结果，请重试。",
  MODEL_DETAIL_LOSS:
    "这次改写遗漏了原版本的结构字段，未保存新版本。请缩小修改范围后手动重试。",
  INCOMPLETE_MODEL_OUTPUT: "模型返回被截断或拒绝，请调整要求后重试。",
  INVALID_IMAGE: "请上传 10MB 以内的 PNG 或 JPEG 图片。",
  IMAGE_REQUIRED: "请先上传参考图。",
  REFERENCE_REUPLOAD_REQUIRED: "本次参考图未长期保存。请重新选择对应原图后再看图分析或继续优化。",
  REFERENCE_FILE_MISMATCH: "所选文件与这张参考图不一致。请使用原文件；更换参考图请新建作品。",
  TEMPORARY_REFERENCE_NOT_SHAREABLE: "本次参考图未存入云端，团队库可以分享文字提示词。",
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
  RECOVERY_FAILED:
    "暂时无法发送密码重设邮件。请稍后重试，或联系管理员检查邮件设置。",
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
) {
  if (
    !["image/png", "image/jpeg"].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error("INVALID_IMAGE");
  const sourceDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), byte => byte.toString(16).padStart(2,"0")).join("");
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
  if (image.size > 10 * 1024 * 1024) throw new Error("INVALID_IMAGE");
  const bytes = new Uint8Array(await image.arrayBuffer());
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2,"0")).join("");
  let binary = "";
  for (let index=0; index<bytes.length; index+=8192)
    binary += String.fromCharCode(...bytes.subarray(index,index+8192));
  return { path, preview: URL.createObjectURL(image), temporary: true as const,
    digest, sourceDigest, data: btoa(binary), mimeType: file.type };
}
export async function originalReferenceFile(path:string,owner:string,index:number):Promise<File> {
  if(!db||!path.startsWith(owner+"/")||!/^[-a-f0-9]+\.(png|jpe?g)$/.test(path.slice(owner.length+1)))throw new Error("参考图访问无效。");
  const {data,error}=await db.storage.from(BUCKET).download(path);
  if(error||!data||!data.size||data.size>10*1024*1024)throw new Error("无法读取历史参考图，请补选原文件。");
  const type=/\.png$/i.test(path)?"image/png":"image/jpeg";
  return new File([data],`图${index}-历史保存版本.${type==='image/png'?'png':'jpg'}`,{type});
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
  const [workspaces, versions, analyses, inspections, memory] = await Promise.all([
    rows<StudioWorkspace>("ps_workspaces"),
    rows<StudioVersion>("ps_versions"),
    rows<AnalysisRow>("ps_analyses"),
    rows<InspectionRow>("ps_inspections"),
    rows("ps_memory"),
  ]);
  download(
    "prompt-studio-export.json",
    JSON.stringify(
      {
        schemaVersion: 3,
        memory: memory.map(({ enabled, rules }: any) => ({ enabled, rules })),
        exportedAt: new Date().toISOString(),
        workspaces: workspaces.map(
          ({ reference_path, reference_images, ...w }) => ({
            ...w,
            hasReference: Boolean(reference_path),
            referenceCount:
              reference_images?.length || (reference_path ? 1 : 0),
          }),
        ),
        versions: versions.map((v) => ({
          ...v,
          context: {
            ...v.context,
            reference_path: undefined,
            reference_images: undefined,
          },
        })),
        analyses: analyses.map((a) => ({
          ...a,
          context: {
            ...a.context,
            reference_path: undefined,
            reference_images: undefined,
          },
        })),
        inspections: inspections.map((a) => ({
          ...a,
          context: {
            ...a.context,
            reference_path: undefined,
            reference_images: undefined,
          },
        })),
      },
      null,
      2,
    ),
  );
}
