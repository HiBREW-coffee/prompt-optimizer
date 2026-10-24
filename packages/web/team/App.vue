<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import ReferenceBoard from "./ReferenceBoard.vue";
import ProfessionalReportView from "./ProfessionalReport.vue";
import AnalysisPanel from "./AnalysisPanel.vue";
import StudioIcon from "./StudioIcon.vue";
import Wordmark from "./Wordmark.vue";
import { useRunFeedback } from "./useRunFeedback";
import MemoryPanel from "./MemoryPanel.vue";
import { applicableMemory } from "../../../supabase/functions/_shared/studio-memory";
import type { StudioMemory } from "../../../supabase/functions/_shared/studio-memory";
import {
  STUDIO_TEMPLATES,
  STUDIO_INSPIRATIONS,
} from "../../../supabase/functions/_shared/studio-catalog";
import {
  workspaceReferences,
  workspaceContext,
  stableJson,
  normalizeReferences,
} from "../../../supabase/functions/_shared/studio-contract";
import type {
  ReferenceImage,
  ReferenceIntent,
  AiAction,
} from "../../../supabase/functions/_shared/studio-contract";
import type { User } from "@supabase/supabase-js";
import {
  db,
  call,
  rows,
  uploadImage,
  signedImage,
  download,
  exportPrivateData,
  message,
  needsPassword,
  SOURCE_URL,
} from "./api";
import type {
  StudioMode,
  StudioWorkspace,
  StudioVersion,
  PromptBundle,
  AnalysisRow,
  InspectionRow,
  LibraryRow,
} from "./api";
import { normalizeBundle } from "../../../supabase/functions/_shared/studio-contract";
const AVATAR_URL = "/dongwu-avatar.png";
const memoryOpen = ref(false);
const memoryState = ref<StudioMemory>({ enabled: false, rules: [] });
const feedback = useRunFeedback();
const runningAction = ref("");
const polishPreview = ref<{ originalPrompt: string; polishedPrompt: string } | null>(null);
const generationRunning = computed(() => busy.value && ["text.optimize","reference.extract","reference.rewrite"].includes(runningAction.value));
const elapsedLabel = computed(() => {
  const seconds = feedback.elapsed.value;
  return String(Math.floor(seconds/60)).padStart(2,"0") + ":" + String(seconds%60).padStart(2,"0");
});

type Page =
  | "reference"
  | "text"
  | "history"
  | "library"
  | "favorites"
  | "admin";
type Member = {
  user_id: string;
  email: string;
  role: string;
  active: boolean;
  daily_limit: number | null;
};
const user = ref<User | null>(null),
  member = ref<Member | null>(null),
  page = ref<Page>("reference");
const loading = ref(true),
  busy = ref(false),
  notice = ref(""),
  error = ref(""),
  email = ref(""),
  password = ref(""),
  setPassword = ref(needsPassword);
const title = ref(""),
  source = ref(""),
  keep = ref(""),
  change = ref(""),
  images = ref<Array<ReferenceImage & { preview: string; data?: string; mimeType?: string }>>([]),
  intent = ref<ReferenceIntent>("replicate"),
  templateId = ref("ecommerce"),
  inspirationOpen = ref(false),
  inspection = ref<InspectionRow | null>(null);
const imagePath = computed(() => images.value[0]?.path ?? null);
const workspace = ref<StudioWorkspace | null>(null),
  versions = ref<StudioVersion[]>([]),
  selected = ref<StudioVersion | null>(null);
const draftZh = ref(""),
  draftEn = ref(""),
  draftJson = ref(""),
  outputTab = ref<"report" | "zh" | "en" | "json">("report"),
  analysis = ref<AnalysisRow | null>(null);
const workspaces = ref<StudioWorkspace[]>([]),
  library = ref<LibraryRow[]>([]),
  favoriteIds = ref<string[]>([]),
  members = ref<Member[]>([]);
const settings = ref({
    member_daily: 0,
    team_daily: 0,
    user_concurrent: 1,
    team_concurrent: 2,
  }),
  used = ref(0),
  dailyLimit = ref(0),
  configured = ref(true);
const search = ref(""),
  compareId = ref(""),
  publishOpen = ref(false),
  shareImage = ref(false),
  inviteEmail = ref(""),
  inviteUrl = ref(""),
  newMemberEmail = ref(""),
  newMemberPassword = ref(""),
  passwordMember = ref<Member | null>(null),
  resetMemberPassword = ref(""),
  pendingId = ref("");
const mode = computed<StudioMode>(() =>
  page.value === "text" ? "text" : "reference",
);
const isEditor = computed(
  () => page.value === "reference" || page.value === "text",
);
const activeMemory = computed(() => applicableMemory(memoryState.value, mode.value, templateId.value));
async function saveMemory(memory: StudioMemory) {
  await attempt(async () => {
    memoryState.value = await call<StudioMemory>("memory.save", { memory });
    memoryOpen.value = false;
    notice.value = "创作经验已保存，仅用于你自己的后续创作。";
  });
}
const dirty = computed(
  () =>
    !!selected.value &&
    (draftZh.value !== selected.value.bundle.zh ||
      draftEn.value !== selected.value.bundle.en ||
      draftJson.value !==
        JSON.stringify(selected.value.bundle.structured, null, 2)),
);
function editorContext() {
  return { ...workspaceContext({
    id: workspace.value?.id ?? "",
    owner_id: user.value?.id ?? "",
    title: title.value,
    mode: mode.value,
    source_text: source.value,
    keep_text: keep.value,
    change_text: "",
    reference_path: imagePath.value,
    reference_images: referenceMetadata(),
    intent: intent.value,
    template_id: templateId.value,
    current_version_id: workspace.value?.current_version_id ?? null,
    favorite: false,
  }), ...(activeMemory.value.length ? { confirmed_preferences: activeMemory.value } : {}) };
}
function referenceMetadata() {
  return normalizeReferences(images.value, user.value?.id ?? "");
}
const analysisStale = computed(
  () =>
    !analysis.value ||
    analysis.value.version_id !== selected.value?.id ||
    dirty.value ||
    stableJson(analysis.value.context) !== stableJson(editorContext()),
);
const inspectionStale = computed(
  () =>
    !inspection.value ||
    stableJson(inspection.value.context) !== stableJson(editorContext()),
);
const previous = computed(() =>
  versions.value.find((v) => v.id === compareId.value),
);
const filteredHistory = computed(() =>
  workspaces.value.filter(
    (w) =>
      (page.value !== "favorites" || w.favorite) &&
      w.title.toLowerCase().includes(search.value.toLowerCase()),
  ),
);
const filteredLibrary = computed(() =>
  library.value.filter(
    (w) =>
      (page.value !== "favorites" || favoriteIds.value.includes(w.id)) &&
      w.title.toLowerCase().includes(search.value.toLowerCase()),
  ),
);
let authSubscription: { unsubscribe(): void } | undefined;
const explain = (e: unknown) => {
  error.value = message(e);
};
async function attempt(fn: () => Promise<void>, action = "") {
  if (busy.value) return;
  busy.value = true;
  runningAction.value = action;
  feedback.begin();
  error.value = "";
  notice.value = "";
  try {
    await fn();
  } catch (e) {
    explain(e);
  } finally {
    feedback.end();
    runningAction.value = "";
    busy.value = false;
  }
}
async function login() {
  await attempt(async () => {
    const { error: e } = await db!.auth.signInWithPassword({
      email: email.value,
      password: password.value,
    });
    if (e) throw new Error("UNAUTHENTICATED");
    password.value = "";
  });
}
async function savePassword() {
  await attempt(async () => {
    if (password.value.length < 12) {
      error.value = "请使用至少 12 位的密码。";
      return;
    }
    const { error: e } = await db!.auth.updateUser({
      password: password.value,
    });
    if (e) throw e;
    password.value = "";
    setPassword.value = false;
    notice.value = "密码已设置。";
  });
}
async function recoverPassword() {
  await attempt(async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
      error.value = "请先填写账号邮箱。";
      return;
    }
    const { error: recoveryError } = await db!.auth.resetPasswordForEmail(
      email.value.trim(),
      {
        redirectTo: location.origin,
      },
    );
    if (recoveryError) throw new Error("RECOVERY_FAILED");
    password.value = "";
    notice.value =
      "如该邮箱可以接收账号邮件，你会收到密码重设链接。请在邮件中打开链接设置新密码。";
  });
}
async function logout() {
  if (busy.value || !mayLeaveEditor()) return;
  await attempt(async () => {
  await db!.auth.signOut();
  member.value = null;
  memoryState.value = { enabled: false, rules: [] };
  memoryOpen.value = false;
  user.value = null;
  resetEditor();
  workspaces.value = [];
  library.value = [];
  members.value = [];
  inviteUrl.value = "";
  pendingId.value = "";
  });
}
async function loadMember() {
  if (!user.value || !db) return;
  loading.value = true;
  error.value = "";
  try {
    const found = await rows<Member>("ps_members", (q) =>
      q.eq("user_id", user.value!.id),
    );
    member.value = found[0] ?? null;
    if (!member.value?.active) return;
    const status = await call<{
      configured: boolean;
      settings: typeof settings.value;
      used: number;
      dailyLimit: number;
    }>("status");
    settings.value = status.settings;
    used.value = status.used;
    dailyLimit.value = status.dailyLimit;
    configured.value = status.configured;
    const savedMemory = await call<StudioMemory>("memory.get");
    memoryState.value = { enabled: savedMemory.enabled === true, rules: savedMemory.rules ?? [] };
    pendingId.value = localStorage.getItem(`ps-pending-${user.value.id}`) || "";
    await loadLists();
  } catch (e) {
    explain(e);
  } finally {
    loading.value = false;
  }
}
async function loadLists() {
  const owner = user.value?.id;
  const [w, l, f] = await Promise.all([
    rows<StudioWorkspace>("ps_workspaces", (q) =>
      q.order("updated_at", { ascending: false }),
    ),
    rows<LibraryRow>("ps_library", (q) =>
      q.order("created_at", { ascending: false }),
    ),
    rows<{ library_id: string }>("ps_library_favorites"),
  ]);
  if (user.value?.id !== owner) return;
  workspaces.value = w;
  library.value = l;
  favoriteIds.value = f.map((x) => x.library_id);
  if (member.value?.role === "admin")
    members.value = await rows<Member>("ps_members", (q) =>
      q.order("created_at"),
    );
}
function resetEditor() {
  polishPreview.value = null;
  workspace.value = null;
  versions.value = [];
  selected.value = null;
  analysis.value = null;
  title.value = "";
  source.value = "";
  keep.value = "";
  change.value = "";
  releasePreviews();
  images.value = [];
  inspection.value = null;
  intent.value = "replicate";
  templateId.value = "ecommerce";
  draftZh.value = "";
  draftEn.value = "";
  draftJson.value = "";
  compareId.value = "";
  outputTab.value = "report";
}
function navigate(target: Page) {
  if (busy.value || !mayLeaveEditor()) return;
  if (target !== "admin") {
    newMemberPassword.value = "";
    resetMemberPassword.value = "";
    passwordMember.value = null;
    inviteUrl.value = "";
  }
  if ((target === "reference" || target === "text") && target !== page.value)
    resetEditor();
  page.value = target;
  search.value = "";
  error.value = "";
  notice.value = "";
  if (!isEditor.value) void loadLists().catch(explain);
}
function newWork() {
  if (!mayLeaveEditor()) return;
  resetEditor();
  notice.value = "已新建，之前保存的作品可在历史记录中查看。";
}
function releasePreviews() {
  for (const image of images.value)
    if (image.preview.startsWith("blob:")) URL.revokeObjectURL(image.preview);
}
async function loadReferences(w: StudioWorkspace) {
  const owner = user.value?.id;
  const result = await Promise.all(
    workspaceReferences(w).map(async (image) => ({
      ...image,
      preview: image.temporary ? "" : await signedImage(image.path),
    })),
  );
  if (user.value?.id === owner) images.value = result;
}
function removeImage(index: number) {
  if (busy.value) return;
  const [image] = images.value.splice(index, 1);
  if (image?.preview.startsWith("blob:")) URL.revokeObjectURL(image.preview);
  notice.value = "已从本次参考中删除图片，图号已更新，请核对提示词中的图号。旧成果仍可查看。";
}
function moveImage(index: number, direction: number) {
  if (busy.value) return;
  const next = index + direction;
  if (next < 0 || next >= images.value.length) return;
  const [image] = images.value.splice(index, 1);
  images.value.splice(next, 0, image!);
}
function updateImage(index: number, key: "role" | "note", value: string) {
  if (busy.value) return;
  const image = images.value[index];
  if (!image) return;
  if (key === "role") image.role = value as ReferenceImage["role"];
  else image.note = value;
}
async function chooseImage(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  await attempt(async () => {
    if (!files.length) return;
    if (images.value.length + files.length > 5)
      throw new Error("INVALID_REFERENCE_IMAGES");
    if (
      files.some(
        (file) =>
          !["image/png", "image/jpeg"].includes(file.type) ||
          file.size > 10 * 1024 * 1024,
      )
    )
      throw new Error("INVALID_IMAGE");
    for (const file of files) {
      const result = await uploadImage(file, user.value!.id);
      const bytes = (value: string) => Math.floor(value.length * 3 / 4) - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
      if (bytes(result.data ?? "") + images.value.reduce((sum,image) => sum + bytes(image.data ?? ""),0) > 20 * 1024 * 1024) {
        URL.revokeObjectURL(result.preview);
        throw new Error("IMAGES_TOO_LARGE");
      }
      images.value.push({ ...result, role: "auto", note: "" });
    }
    notice.value = "参考图仅供本次页面使用，不存入工作室云端；刷新后需重新选择原图。图号按当前顺序对应。";
  });
  input.value = "";
}
async function restoreImage(index: number, event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  if (!file) return;
  await attempt(async () => {
    const image = images.value[index];
    if (!image?.temporary) throw new Error("INVALID_IMAGE");
    const prepared = await uploadImage(file, user.value!.id);
    if (prepared.sourceDigest !== image.sourceDigest) {
      URL.revokeObjectURL(prepared.preview);
      throw new Error("REFERENCE_FILE_MISMATCH");
    }
    images.value[index] = { ...image, data: prepared.data, mimeType: prepared.mimeType,
      digest: prepared.digest, preview: prepared.preview };
    notice.value = "原图已重新载入本次页面，不会长期保存。";
  });
  input.value = "";
}
function useInspiration(index: number) {
  if (busy.value) return;
  const item = STUDIO_INSPIRATIONS[index];
  if (!item) return;
  const combined = source.value.trim()
    ? `${source.value}\n\n灵感方向：${item.prompt}`
    : item.prompt;
  if (combined.length > 32000) {
    error.value = "提示词已接近长度上限，请先精简后再加入灵感。";
    return;
  }
  source.value = combined;
  intent.value = "inspiration";
  templateId.value = item.template;
  inspirationOpen.value = false;
  notice.value = "灵感已带入提示词；请按实际图片调整图号与要求。";
}
async function loadInspection() {
  if (!workspace.value) return;
  const id = workspace.value.id;
  const found = await rows<InspectionRow>(
    "ps_inspections",
    (q) => q.eq("workspace_id", id).order("created_at", { ascending: false }),
    1,
  );
  if (workspace.value?.id === id) inspection.value = found[0] ?? null;
}
async function refreshUsage() {
  if (member.value?.role !== "admin") return;
  try {
    const status = await call<{ used: number; dailyLimit: number }>("status");
    used.value = status.used;
    dailyLimit.value = status.dailyLimit;
  } catch {}
}
async function saveWorkspace() {
  const result = await call<{ workspace: StudioWorkspace }>("workspace.save", {
    workspaceId: workspace.value?.id,
    mode: mode.value,
    title: title.value || source.value.slice(0, 28) || "参考图提炼",
    sourceText: source.value,
    keepText: keep.value,
    changeText: "",
    referencePath: imagePath.value,
    referenceImages:
      mode.value === "reference"
        ? referenceMetadata()
        : [],
    intent: intent.value,
    templateId: templateId.value,
  });
  if (result.workspace.owner_id !== user.value?.id)
    throw new Error("UNAUTHENTICATED");
  workspace.value = result.workspace;
  title.value = result.workspace.title;
  return result.workspace;
}
async function showVersion(version: StudioVersion) {
  selected.value = version;
  draftZh.value = version.bundle.zh;
  draftEn.value = version.bundle.en;
  draftJson.value = JSON.stringify(version.bundle.structured, null, 2);
  analysis.value = null;
  const found = await rows<AnalysisRow>(
    "ps_analyses",
    (q) =>
      q.eq("version_id", version.id).order("created_at", { ascending: false }),
    1,
  );
  if (selected.value?.id === version.id) analysis.value = found[0] ?? null;
}
async function loadVersions(prefer?: string) {
  if (!workspace.value) return;
  versions.value = await rows<StudioVersion>("ps_versions", (q) =>
    q
      .eq("workspace_id", workspace.value!.id)
      .order("sequence", { ascending: false }),
  );
  const version =
    versions.value.find(
      (v) => v.id === (prefer || workspace.value!.current_version_id),
    ) || versions.value[0];
  if (version) await showVersion(version);
}
function mayLeaveEditor() {
  if (!dirty.value) return true;
  error.value = "还有未保存的编辑，请先保存后再切换。";
  return false;
}
async function chooseVersion(event: Event) {
  const input = event.target as HTMLSelectElement;
  if (!mayLeaveEditor()) {
    input.value = selected.value?.id ?? "";
    return;
  }
  const version = versions.value.find((v) => v.id === input.value);
  if (version) await attempt(() => showVersion(version));
}
async function openWork(w: StudioWorkspace) {
  await attempt(async () => {
    resetEditor();
    page.value = w.mode === "reference" ? "reference" : "text";
    workspace.value = w;
    title.value = w.title;
    source.value = w.source_text;
    keep.value = w.keep_text;
    change.value = w.change_text;
    source.value = [
      w.source_text,
      w.change_text ? "需要修改：" + w.change_text : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    change.value = "";
    intent.value = w.intent ?? "replicate";
    templateId.value = w.template_id ?? "ecommerce";
    await loadReferences(w);
    await loadVersions();
    await loadInspection();
  });
}
function bundleFromEditor(): PromptBundle {
  let structured: unknown;
  try {
    structured = JSON.parse(draftJson.value);
  } catch {
    throw new Error("INVALID_MODEL_OUTPUT");
  }
  return normalizeBundle({
    zh: draftZh.value,
    en: draftEn.value,
    structured,
    observations: selected.value?.bundle.observations ?? [],
    uncertainties: selected.value?.bundle.uncertainties ?? [],
    ...(selected.value?.bundle.report
      ? { report: selected.value.bundle.report }
      : {}),
  });
}
async function saveDraft() {
  const w = await saveWorkspace();
  if (!selected.value || !dirty.value) return;
  const data = await call<{ version: StudioVersion; became_current: boolean }>(
    "version.save",
    {
      workspaceId: w.id,
      versionId: selected.value.id,
      bundle: bundleFromEditor(),
    },
  );
  await acceptVersion(data);
  notice.value = "编辑已保存为新版本。";
}
async function acceptVersion(data: {
  version: StudioVersion;
  became_current: boolean;
}) {
  if (data.became_current && workspace.value)
    workspace.value.current_version_id = data.version.id;
  await loadVersions(data.version.id);
  if (!data.became_current)
    notice.value =
      "其他页面已更新当前版本，本次结果仍已保存。可查看对比后恢复为新版本。";
}
async function run(action: AiAction, suggestionId?: string, fromInput = false) {
  await attempt(async () => {
    const owner = user.value?.id;
    if (mode.value === "reference" && !imagePath.value && action !== "prompt.polish") {
      error.value = "请先上传参考图。";
      return;
    }
    if (mode.value === "reference" && images.value.some(image => image.temporary && !image.data)) {
      error.value = "本次参考图未长期保存，请重新选择对应原图后再看图分析或继续优化。";
      return;
    }
    if ((mode.value === "text" || action === "prompt.polish") && !source.value.trim()) {
      error.value = "请先输入需要优化的文字。";
      return;
    }
    if (
      suggestionId &&
      (fromInput ? inspectionStale.value : analysisStale.value)
    ) {
      error.value = "请重新分析当前版本后应用建议。";
      return;
    }
    const analysisId = fromInput ? inspection.value?.id : analysis.value?.id;
    await saveDraft();
    const id = crypto.randomUUID();
    pendingId.value = id;
    localStorage.setItem(`ps-pending-${user.value!.id}`, id);
    try {
      const result = await call<{
        version?: StudioVersion;
        became_current?: boolean;
        analysis?: AnalysisRow;
        inspection?: InspectionRow;
        pending?: boolean;
        polishedPrompt?: string;
        originalPrompt?: string;
      }>(action, {
        workspaceId: workspace.value!.id,
        versionId: ["prompt.inspect","prompt.polish"].includes(action) ? undefined : selected.value?.id,
        requestId: id,
        ...(mode.value === "reference" && images.value.some(image => image.temporary)
          ? { referenceData: images.value.filter(image => image.temporary).map(({path,data,mimeType}) => ({path,data,mimeType})) }
          : {}),
        ...(suggestionId
          ? {
              [fromInput ? "inspectionId" : "analysisId"]: analysisId,
              suggestionId,
            }
          : {}),
      });
      if (user.value?.id !== owner) return;
      if (result.pending) {
        notice.value = "请求仍在处理，可点击查询上次结果。";
        return;
      }
      if (result.version)
        await acceptVersion({
          version: result.version,
          became_current: result.became_current === true,
        });
      if (result.analysis) analysis.value = result.analysis;
      if (result.inspection) inspection.value = result.inspection;
      if (typeof result.polishedPrompt === "string")
        polishPreview.value = { originalPrompt: result.originalPrompt ?? source.value, polishedPrompt: result.polishedPrompt };
      pendingId.value = "";
      localStorage.removeItem(`ps-pending-${user.value!.id}`);
      await refreshUsage();
      await loadLists();
    } catch (e) {
      if (
        e instanceof Error &&
        [
          "MODEL_HTTP_401",
          "MODEL_HTTP_403",
          "MODEL_NOT_CONFIGURED",
          "SERVER_CONFIGURATION",
          "MODEL_DETAIL_LOSS",
          "INCOMPLETE_PROFESSIONAL_REPORT",
          "INVALID_SCORE_SCALE",
          "REFERENCE_INDEX_MISSING",
        ].includes(e.message)
      ) {
        pendingId.value = "";
        localStorage.removeItem("ps-pending-" + user.value!.id);
        notice.value = "本次操作未生成新版本。请修正提示信息后手动重试。";
      } else notice.value = "可查询上次结果，避免重复发起模型调用。";
      await refreshUsage();
      throw e;
    }
  }, action);
}
function applyPolish() {
  if (!polishPreview.value || source.value !== polishPreview.value.originalPrompt) return;
  source.value = polishPreview.value.polishedPrompt;
  polishPreview.value = null;
}
async function checkPending() {
  await attempt(async () => {
    const result = await rows<{
      status: string;
      result: {
        version?: StudioVersion;
        became_current?: boolean;
        analysis?: AnalysisRow;
        inspection?: InspectionRow;
        polishedPrompt?: string;
        originalPrompt?: string;
      };
      error_code: string;
      workspace_id: string;
      expires_at: string;
    }>("ps_requests", (q) => q.eq("id", pendingId.value));
    const request = result[0];
    if (!request) {
      notice.value = "上次请求未被后台接收，可以重新发起。";
    } else if (
      request.status === "running" &&
      new Date(request.expires_at).getTime() > Date.now()
    ) {
      notice.value = "上次请求仍在处理，请稍后再查询。";
      return;
    } else if (request.status === "succeeded") {
      const found = workspaces.value.find((w) => w.id === request.workspace_id);
      if (found) {
        resetEditor();
        page.value = found.mode === "reference" ? "reference" : "text";
        workspace.value = found;
        title.value = found.title;
        source.value = found.source_text;
        keep.value = found.keep_text;
        change.value = found.change_text;
        source.value = [
          found.source_text,
          found.change_text ? "需要修改：" + found.change_text : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        change.value = "";
        intent.value = found.intent ?? "replicate";
        templateId.value = found.template_id ?? "ecommerce";
        await loadReferences(found);
        await loadVersions(
          request.result.version?.id || request.result.analysis?.version_id,
        );
        if (request.result.analysis) analysis.value = request.result.analysis;
        if (request.result.inspection)
          inspection.value = request.result.inspection;
        if (request.result.polishedPrompt)
          polishPreview.value = { originalPrompt: request.result.originalPrompt ?? source.value, polishedPrompt: request.result.polishedPrompt };
      }
      notice.value = "上次结果已恢复。";
    } else {
      notice.value = "上次请求未完成，可以手动重试。";
    }
    pendingId.value = "";
    localStorage.removeItem(`ps-pending-${user.value!.id}`);
  });
}
async function restore() {
  await attempt(async () => {
    if (!selected.value || !workspace.value) return;
    const data = await call<{
      version: StudioVersion;
      became_current: boolean;
    }>("version.restore", {
      workspaceId: workspace.value.id,
      versionId: workspace.value.current_version_id,
      restoreId: selected.value.id,
    });
    source.value = [
      String(data.version.context.source ?? ""),
      data.version.context.change
        ? "需要修改：" + String(data.version.context.change)
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    keep.value = String(data.version.context.keep ?? "");
    change.value = "";
    intent.value = (data.version.context.intent ??
      "replicate") as ReferenceIntent;
    templateId.value = String(data.version.context.template_id ?? "ecommerce");
    if (workspace.value && Array.isArray(data.version.context.reference_images))
      await loadReferences({
        ...workspace.value,
        reference_images: data.version.context
          .reference_images as ReferenceImage[],
      });
    await acceptVersion(data);
    notice.value = "已恢复为新版本，历史版本仍保留。";
  });
}
async function copy() {
  await attempt(async () => {
    await navigator.clipboard.writeText(
      outputTab.value === "report"
        ? reportText()
        : outputTab.value === "zh"
          ? draftZh.value
          : outputTab.value === "en"
            ? draftEn.value
            : draftJson.value,
    );
    notice.value = "已复制。";
  });
}
function reportText() {
  const r = selected.value?.bundle.report;
  if (!r) return draftZh.value;
  return [
    "# @DONGWU 专业提炼报告",
    r.intent,
    "## 固定要素",
    ...r.anchors.map((x) => x.title + "：" + x.content),
    "## 重构要素",
    ...r.changes.map((x) => x.title + "：" + x.content),
    "## 专业结构",
    ...r.sections.map((x) => x.title + "：" + x.content),
    "## 中文提示词",
    draftZh.value,
    "## English prompt",
    draftEn.value,
    "## 负向提示词",
    r.negative.zh,
    r.negative.en,
    "## 推荐参数",
    ...r.parameters.map(
      (x) => x.name + "：" + x.value + "（" + x.reason + "）",
    ),
  ].join("\n\n");
}
async function publish() {
  await attempt(async () => {
    await saveDraft();
    await call("library.publish", {
      workspaceId: workspace.value!.id,
      versionId: selected.value!.id,
      includeImage: shareImage.value,
    });
    publishOpen.value = false;
    shareImage.value = false;
    notice.value = "已发布到团队精品库。";
    await loadLists();
  });
}
async function favorite(w: StudioWorkspace) {
  await attempt(async () => {
    await call("workspace.favorite", {
      workspaceId: w.id,
      favorite: !w.favorite,
    });
    w.favorite = !w.favorite;
    if (workspace.value?.id === w.id) workspace.value.favorite = w.favorite;
  });
}
async function favoriteLibrary(item: LibraryRow) {
  await attempt(async () => {
    const query = db!.from("ps_library_favorites");
    const { error: e } = favoriteIds.value.includes(item.id)
      ? await query
          .delete()
          .eq("library_id", item.id)
          .eq("user_id", user.value!.id)
      : await query.insert({ user_id: user.value!.id, library_id: item.id });
    if (e) throw e;
    await loadLists();
  });
}
async function importLibrary(item: LibraryRow) {
  await attempt(async () => {
    const data = await call<{
      workspace: StudioWorkspace;
      version: StudioVersion;
    }>("library.import", { libraryId: item.id });
    resetEditor();
    const w = data.workspace;
    page.value = w.mode === "reference" ? "reference" : "text";
    workspace.value = w;
    title.value = w.title;
    source.value = w.source_text;
    keep.value = w.keep_text;
    change.value = w.change_text;
    source.value = [
      w.source_text,
      w.change_text ? "需要修改：" + w.change_text : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    change.value = "";
    intent.value = w.intent ?? "replicate";
    templateId.value = w.template_id ?? "ecommerce";
    await loadReferences(w);
    await loadVersions(data.version.id);
    notice.value = "已复制到私人空间，可以继续编辑。";
  });
}
async function unpublish(item: LibraryRow) {
  await attempt(async () => {
    await call("library.unpublish", { libraryId: item.id });
    await loadLists();
    notice.value = "已撤回分享。";
  });
}
async function invite() {
  await attempt(async () => {
    inviteUrl.value = "";
    const result = await call<{ inviteUrl: string }>("member.invite", {
      email: inviteEmail.value,
    });
    inviteUrl.value = result.inviteUrl;
    await loadLists();
  });
}
async function createMember() {
  const initialPassword = newMemberPassword.value;
  newMemberPassword.value = "";
  await attempt(async () => {
    await call("member.create", {
      email: newMemberEmail.value,
      password: initialPassword,
    });
    newMemberEmail.value = "";
    await loadLists();
    notice.value =
      "成员已添加。请私下告知邮箱和初始密码，成员登录后可自行修改。";
  });
}
async function changeMemberPassword() {
  const target = passwordMember.value;
  if (!target) return;
  const nextPassword = resetMemberPassword.value;
  resetMemberPassword.value = "";
  await attempt(async () => {
    await call("member.password", {
      userId: target.user_id,
      password: nextPassword,
    });
    passwordMember.value = null;
    notice.value = "成员密码已重设。请私下告知对应成员。";
  });
}
async function copyInvite() {
  await attempt(async () => {
    await navigator.clipboard.writeText(inviteUrl.value);
    notice.value = "邀请链接已复制。";
  });
}
async function updateMember(m: Member) {
  await attempt(async () => {
    await call("member.update", {
      userId: m.user_id,
      active: !m.active,
      dailyLimit: m.daily_limit,
    });
    await loadLists();
  });
}
watch(
  () => user.value?.id,
  () => {
    resetEditor();
    workspaces.value = [];
    memoryState.value = { enabled: false, rules: [] };
    memoryOpen.value = false;
    library.value = [];
    members.value = [];
    inviteUrl.value = "";
    newMemberEmail.value = "";
    newMemberPassword.value = "";
    passwordMember.value = null;
    resetMemberPassword.value = "";
    password.value = "";
    pendingId.value = "";
    member.value = null;
    if (user.value) void loadMember();
    else loading.value = false;
  },
);
onMounted(async () => {
  if (!db) {
    loading.value = false;
    return;
  }
  const { data } = db.auth.onAuthStateChange((event, session) => {
    user.value = session?.user ?? null;
    if (event === "PASSWORD_RECOVERY") setPassword.value = true;
  });
  authSubscription = data.subscription;
  const {
    data: { session },
  } = await db.auth.getSession();
  user.value = session?.user ?? null;
  if (!session) loading.value = false;
});
onBeforeUnmount(() => {
  newMemberPassword.value = "";
  resetMemberPassword.value = "";
  password.value = "";
  authSubscription?.unsubscribe();
  releasePreviews();
});
</script>

<template>
  <div v-if="!db" class="gate">
    <div class="gate-card">
      <img class="gate-avatar" :src="AVATAR_URL" alt="@DONGWU头像" /><span
        class="eyebrow"
        >@DONGWU / CREATIVE STUDIO</span
      >
      <h1>团队工作室即将就绪</h1>
      <p>网站已构建。管理员连接团队后台后，即可邀请成员使用。</p>
      <a
        :href="SOURCE_URL + '/docs/deploy/prompt-studio-team.md'"
        target="_blank"
        rel="noopener"
        >查看部署说明</a
      >
    </div>
  </div>
  <div v-else-if="!user" class="gate" @click.capture="feedback.capture" @submit.capture="feedback.capture">
    <form class="gate-card" @submit.prevent="login">
      <span class="eyebrow">@DONGWU / CREATIVE STUDIO</span>
      <h1>让好的画面，<br />成为可复用的提示词。</h1>
      <p>登录团队工作室，提炼参考图，打磨每一次表达。</p>
      <label
        >账号邮箱<input
          v-model="email"
          type="email"
          autocomplete="username"
          required /></label
      ><label
        >密码<input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
      /></label>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <button class="primary" :disabled="busy">
        登录工作室</button
      ><button
        type="button"
        class="quiet"
        :disabled="busy"
        @click="recoverPassword"
      >
        忘记密码 / 首次设置密码
      </button>
      <p v-if="notice" role="status">{{ notice }}</p>
      <small>仅限受邀成员。首次使用请联系管理员获取账号。</small>
    </form>
  </div>
  <div v-else-if="loading" class="gate" role="status">
    正在打开你的私人工作空间…
  </div>
  <div v-else-if="!member?.active" class="gate" @click.capture="feedback.capture">
    <div class="gate-card">
      <h1>等待团队邀请</h1>
      <p>{{ error || "此账号尚未加入工作室，请联系管理员邀请。" }}</p>
      <button @click="attempt(loadMember)">重新检查</button
      ><button @click="logout">退出登录</button>
    </div>
  </div>
  <div v-else class="studio" @click.capture="feedback.capture" @submit.capture="feedback.capture">
    <aside class="sidebar">
      <a class="brand" href="#" @click.prevent="navigate('reference')"
        ><img :src="AVATAR_URL" alt="@DONGWU头像" /><span
          ><Wordmark /><small>创作工作室</small></span
        ></a
      >
      <span class="nav-label">创作空间</span>
      <nav aria-label="主要功能">
        <button
          :class="{ active: page === 'reference' }"
          @click="navigate('reference')"
        >
          <StudioIcon name="image" />参考图提炼<i>创作</i></button
        ><button :class="{ active: page === 'text' }" @click="navigate('text')">
          <StudioIcon name="text" />文字提示词
        </button>
      </nav>
      <span class="nav-label">我的资产</span>
      <nav aria-label="作品管理">
        <button
          :class="{ active: page === 'history' }"
          @click="navigate('history')"
        >
          <StudioIcon name="clock" />历史与版本</button
        ><button
          :class="{ active: page === 'favorites' }"
          @click="navigate('favorites')"
        >
          <StudioIcon name="star" />我的收藏</button
        ><button
          :class="{ active: page === 'library' }"
          @click="navigate('library')"
        >
          <StudioIcon name="grid" />团队精品库</button
        ><button :disabled="busy" @click="memoryOpen = true">
          <StudioIcon name="spark" />创作经验</button
        ><button
          v-if="member.role === 'admin'"
          :class="{ active: page === 'admin' }"
          @click="navigate('admin')"
        >
          <StudioIcon name="people" />团队管理
        </button>
      </nav>
      <div class="sidebar-bottom">
        <p>私人保存 · 按需分享</p>
        <template v-if="member?.role === 'admin'">
          <small>今日请求 {{ used }} 次{{ dailyLimit > 0 ? ` / ${dailyLimit}` : ' · 每日不限' }}</small>
          <progress v-if="dailyLimit > 0" :value="used" :max="dailyLimit"></progress>
        </template>
      </div>
    </aside>
    <main>
      <header class="topbar">
        <span class="workspace-wordmark"><Wordmark /></span>
        <nav class="topnav" aria-label="顶部导航">
          <button
            :class="{ active: page === 'reference' }"
            @click="navigate('reference')"
          >
            参考图创作</button
          ><button
            :class="{ active: page === 'text' }"
            @click="navigate('text')"
          >
            文字创作</button
          ><button
            :class="{ active: page === 'history' }"
            @click="navigate('history')"
          >
            历史资产</button
          ><button
            :class="{ active: page === 'library' }"
            @click="navigate('library')"
          >
            团队精品
          </button>
        </nav>
        <div>
          <img
            class="account-avatar"
            :src="AVATAR_URL"
            alt="@DONGWU头像"
          /><span class="account"
            ><b>@DONGWU</b><small>{{ member.email }}</small></span
          ><button class="quiet" :disabled="busy" @click="setPassword = true">
            修改密码</button
          ><button class="quiet" @click="logout">退出</button>
        </div>
        <details class="compact-account">
          <summary aria-label="账号菜单">
            <img :src="AVATAR_URL" alt="@DONGWU头像" />
          </summary>
          <section>
            <strong>@DONGWU</strong><small>{{ member.email }}</small>
            <button :disabled="busy" @click="setPassword = true">
              修改密码
            </button>
            <button :disabled="busy" @click="logout">退出</button>
          </section>
        </details>
      </header>
      <div class="main-content">
        <div v-if="error" class="banner error" role="alert">
          {{ error }}<button class="quiet" @click="error = ''">关闭</button>
        </div>
        <div v-if="notice" class="banner" role="status">{{ notice }}</div>
        <div v-if="pendingId && !busy" class="banner pending">
          有一次请求可以查询，查询不会再次调用模型。<button
            :disabled="busy"
            @click="checkPending"
          >
            查询上次结果
          </button>
        </div>
        <div v-if="!configured" class="banner error">
          模型尚未在服务器配置，请管理员完成配置后再使用。
        </div>
        <template v-if="isEditor"
          ><div class="page-title">
            <div>
              <span class="eyebrow">{{
                mode === "reference"
                  ? "SHAPE YOUR CREATIVE DIRECTION"
                  : "FROM AN IDEA TO A CLEAR BRIEF"
              }}</span>
              <h1>
                {{
                  mode === "reference"
                    ? "让想法，精准落在画面里"
                    : "把一句想法，写成清晰的创作指令"
                }}
              </h1>
              <p>
                {{
                  mode === "reference"
                    ? "从参考图出发，梳理画面关系，让每个细节都有明确的创作依据。"
                    : "说出想做什么，让表达更有条理；再由你审定每一个细节。"
                }}
              </p>
            </div>
            <button class="new-work" :disabled="busy" @click="newWork">
              <StudioIcon name="plus" />新建作品
            </button>
          </div>
          <div class="workspace-overview">
            <article class="overview-primary">
              <StudioIcon name="spark" />
              <div>
                <span>创作空间</span
                ><strong>{{
                  mode === "reference"
                    ? "让每张参考图，各司其职。"
                    : "先润色表达，再打磨结构。"
                }}</strong>
                <p>
                  {{
                    mode === "reference"
                      ? "最多 5 张图片，明确主体、场景与风格的借用边界。"
                      : "从原始大意到可执行的提示词，逐步完善目标、限制与输出。"
                  }}
                </p>
              </div>
            </article>
            <article v-if="member?.role === 'admin'">
              <span>今日模型请求</span>
              <strong>{{ used }}<small> 次</small></strong>
              <p>{{ dailyLimit > 0 ? `本站每日上限 ${dailyLimit} 次` : '每日不限 · 非供应商余额' }}</p>
            </article>
            <article v-else>
              <span>创作流程</span>
              <strong>分析 · 提炼</strong>
              <p>按建议继续优化，保留每次成果</p>
            </article>
            <article>
              <span>我的创作资产</span
              ><strong>{{ workspaces.length }}<small> 份</small></strong>
              <p>历史、报告与每次版本都在</p>
            </article>
          </div>
          <div class="editor-grid">
            <section class="panel input-panel">
              <div class="panel-head">
                <h2>
                  01
                  <span>{{
                    mode === "reference" ? "参考与要求" : "原文与要求"
                  }}</span>
                </h2>
                <span class="tag">私人空间</span>
              </div>
              <label
                >作品名称<input
                  v-model="title"
                  maxlength="120"
                  placeholder="给这次创作起个名字"
                  :disabled="busy"
              /></label>
              <ReferenceBoard
                v-if="mode === 'reference'"
                :images="images"
                :busy="busy"
                @change="chooseImage"
                @remove="removeImage"
                @move="moveImage"
                @update="updateImage"
                @restore="restoreImage"
              />
              <div class="prompt-heading">
                <span>提示词</span>
                <div class="intent-controls">
                  <button class="polish-button" :disabled="busy || !configured || !source.trim()" @click="run('prompt.polish')">
                    <StudioIcon name="spark" />AI 润色
                  </button>
                  <button
                    :class="{ active: intent === 'inspiration' }"
                    :aria-pressed="intent === 'inspiration'"
                    :disabled="busy"
                    @click="
                      intent = 'inspiration';
                      inspirationOpen = true;
                    "
                  >
                    <StudioIcon name="spark" />灵感</button
                  ><button
                    :class="{ active: intent === 'replicate' }"
                    :aria-pressed="intent === 'replicate'"
                    :disabled="busy"
                    @click="intent = 'replicate'"
                  >
                    复刻</button
                  ><button
                    :class="{ active: intent === 'style' }"
                    :aria-pressed="intent === 'style'"
                    :disabled="busy"
                    @click="intent = 'style'"
                  >
                    风格学习
                  </button>
                </div>
              </div>
              <label class="sr-only" for="studio-prompt">提示词</label
              ><textarea
                id="studio-prompt"
                v-model="source"
                rows="7"
                maxlength="32000"
                :disabled="busy"
                :placeholder="
                  mode === 'reference'
                    ? '例如：将图1白底产品放入图2风格的场景，借用桌面、背景和人物；图3提供人物动作。产品外观保持不变，匹配透视、光影、景深和大小。'
                    : '写下原始提示词、任务目标、补充说明与需要修改的内容…'
                "
              ></textarea>
              <section v-if="polishPreview" class="polish-preview" aria-label="AI 润色建议">
                <div class="panel-head"><strong>润色建议</strong><span class="tag">待你审定</span></div>
                <textarea v-model="polishPreview.polishedPrompt" aria-label="润色后的提示词" rows="5" maxlength="32000" :disabled="busy"></textarea>
                <details><summary>查看润色前文本</summary><p>{{ polishPreview.originalPrompt }}</p></details>
                <p v-if="source !== polishPreview.originalPrompt" class="hint">原文已调整，可先核对并手动复制需要的内容。</p>
                <div class="actions">
                  <button class="primary" :disabled="busy || !polishPreview.polishedPrompt.trim() || source !== polishPreview.originalPrompt" @click="applyPolish">采用润色</button>
                  <button :disabled="busy" @click="polishPreview = null">暂不采用</button>
                </div>
              </section>
              <p class="intent-description">
                {{
                  intent === "style"
                    ? "保留你的主体，只学习指定参考图的风格、构图、色彩和光影。"
                    : intent === "inspiration"
                      ? "以你的意图为中心拓展方案，明确区分图中事实和新增创意。"
                      : "忠实复现；如需多图重构，请明确每张图要借用的内容。"
                }}
              </p>
              <label
                >需要保留<textarea
                  v-model="keep"
                  rows="2"
                  maxlength="8000"
                  :disabled="busy"
                  placeholder="例如：相同机位、主体比例、侧面柔光"
                ></textarea>
              </label>
              <label
                >优化模板<select v-model="templateId" :disabled="busy">
                  <option
                    v-for="item in STUDIO_TEMPLATES"
                    :key="item.id"
                    :value="item.id"
                  >
                    {{ item.name }}
                  </option>
                </select></label
              >
              <p class="template-description">
                {{
                  STUDIO_TEMPLATES.find((item) => item.id === templateId)
                    ?.description
                }}
              </p>
              <p v-if="activeMemory.length" class="hint">
                本次参考经验：{{ activeMemory.map(item => item.title).join('、') }}。本次明确要求优先。
              </p>
              <div class="input-actions">
                <button
                  class="analyze-input"
                  :disabled="busy || !configured"
                  @click="run('prompt.inspect')"
                >
                  <StudioIcon name="chart" />{{
                    mode === "reference" ? "分析原文与参考图" : "分析原文"
                  }}
                </button>
                <button
                  class="primary full"
                  :disabled="busy || !configured"
                  @click="
                    run(
                      mode === 'text'
                        ? 'text.optimize'
                        : selected
                          ? 'reference.rewrite'
                          : 'reference.extract',
                    )
                  "
                >
                  {{
                    mode === "text"
                        ? "优化并提炼"
                        : selected
                          ? "按要求生成新版本"
                          : "提炼参考图提示词"
                  }}
                </button>
              </div>
              <small class="hint"
                >结果自动保存 · 可先润色，再分析与生成</small
              >
              <div v-if="generationRunning" class="generation-progress" role="status">
                <span class="progress-orbit" aria-hidden="true"></span>
                <span>生成中 · 已用 {{ elapsedLabel }}</span><small>单次最长约2分钟</small>
              </div>
            </section>
            <section class="panel result-panel">
              <div class="panel-head">
                <h2>02 <span>提炼结果</span></h2>
                <span v-if="selected" class="tag"
                  >V{{ selected.sequence }}</span
                >
              </div>
              <div v-if="!selected" class="empty-result">
                <span class="empty-symbol">⌘</span>
                <h3>好的提示词，从看清细节开始</h3>
                <p>
                  先分析原文与参考图，再生成完整专业报告。<br />包含中英提示词、图间映射、固定要素、结构、负向约束与参数建议。
                </p>
              </div>
              <template v-else
                ><div class="result-toolbar">
                  <div class="tabs" role="tablist" aria-label="结果格式">
                    <button
                      v-for="tab in ['report', 'zh', 'en', 'json'] as const"
                      :key="tab"
                      role="tab"
                      :aria-selected="outputTab === tab"
                      :class="{ active: outputTab === tab }"
                      @click="outputTab = tab"
                    >
                      {{
                        {
                          report: "专业报告",
                          zh: "中文",
                          en: "English",
                          json: "JSON",
                        }[tab]
                      }}
                    </button>
                  </div>
                  <button :disabled="busy" @click="copy">复制</button>
                </div>
                <div v-if="outputTab === 'report'" class="report-view">
                  <ProfessionalReportView
                    v-if="selected.bundle.report"
                    :report="selected.bundle.report"
                    :zh="draftZh"
                    :en="draftEn"
                  />
                  <div class="legacy-report" v-else>
                    <StudioIcon name="chart" />
                    <h3>这份成果还没有专业报告</h3>
                    <p>
                      中英提示词、JSON
                      和历史分析仍可查看。重新提炼会生成包含要素对照、专业结构、负向提示词和参数建议的完整新报告。
                    </p>
                    <button
                      :disabled="busy"
                      @click="
                        run(
                          mode === 'reference'
                            ? 'reference.rewrite'
                            : 'text.optimize',
                        )
                      "
                    >
                      生成专业报告新版本
                    </button>
                  </div>
                </div>
                <textarea
                  v-show="outputTab === 'zh'"
                  v-model="draftZh"
                  aria-label="中文提示词"
                  class="prompt-editor"
                  :disabled="busy"
                ></textarea
                ><textarea
                  v-show="outputTab === 'en'"
                  v-model="draftEn"
                  aria-label="英文提示词"
                  class="prompt-editor"
                  :disabled="busy"
                ></textarea
                ><textarea
                  v-show="outputTab === 'json'"
                  v-model="draftJson"
                  aria-label="结构化提示词"
                  class="prompt-editor mono"
                  :disabled="busy"
                ></textarea>
                <details
                  v-if="
                    selected.bundle.observations.length ||
                    selected.bundle.uncertainties.length
                  "
                  class="evidence"
                >
                  <summary>画面事实与不确定项</summary>
                  <h4>观察到的事实</h4>
                  <ul>
                    <li
                      v-for="fact in selected.bundle.observations"
                      :key="fact"
                    >
                      {{ fact }}
                    </li>
                  </ul>
                  <h4>仍需确认</h4>
                  <ul>
                    <li
                      v-for="fact in selected.bundle.uncertainties"
                      :key="fact"
                    >
                      {{ fact }}
                    </li>
                  </ul>
                </details>
                <p v-if="dirty" class="hint">
                  有未保存编辑。请同步检查三种格式；保存或分析时将建立新版本。
                </p>
                <div class="actions">
                  <button
                    :disabled="busy || !dirty"
                    @click="attempt(saveDraft)"
                  >
                    保存编辑</button
                  ><button
                    class="primary"
                    :disabled="busy || !configured"
                    @click="run('prompt.evaluate')"
                  >
                    分析与修改建议</button
                  ><button :disabled="busy" @click="favorite(workspace!)">
                    {{ workspace?.favorite ? "已收藏" : "收藏作品" }}</button
                  ><button
                    :disabled="busy"
                    @click="
                      shareImage = false;
                      publishOpen = true;
                    "
                  >
                    发布到团队库</button
                  ><button :disabled="busy" @click="memoryOpen = true">记录创作经验</button
                  ><button
                    :disabled="busy"
                    @click="
                      attempt(async () => {
                        download(
                          'prompt-bundle.json',
                          JSON.stringify(bundleFromEditor(), null, 2),
                        );
                        notice = '已导出当前结果。';
                      })
                    "
                  >
                    导出
                  </button>
                </div>
                <div class="version-bar">
                  <label
                    >查看版本<select
                      :value="selected.id"
                      :disabled="busy"
                      @change="chooseVersion"
                    >
                      <option v-for="v in versions" :key="v.id" :value="v.id">
                        V{{ v.sequence }} ·
                        {{
                          v.kind === "manual"
                            ? "手动编辑"
                            : v.kind === "restore"
                              ? "恢复版本"
                              : "模型提炼"
                        }}{{
                          workspace?.current_version_id === v.id
                            ? " · 当前"
                            : ""
                        }}
                      </option>
                    </select></label
                  ><button
                    v-if="selected.id !== workspace?.current_version_id"
                    :disabled="busy || dirty"
                    @click="restore"
                  >
                    恢复为新版本</button
                  ><label
                    >对比<select v-model="compareId">
                      <option value="">选择历史版本</option>
                      <option
                        v-for="v in versions.filter(
                          (v) => v.id !== selected!.id,
                        )"
                        :key="v.id"
                        :value="v.id"
                      >
                        V{{ v.sequence }}
                      </option>
                    </select></label
                  >
                </div>
                <div v-if="previous" class="comparison">
                  <div>
                    <h4>V{{ previous.sequence }}</h4>
                    <pre>{{ previous.bundle.zh }}</pre>
                  </div>
                  <div>
                    <h4>V{{ selected.sequence }}</h4>
                    <pre>{{ draftZh }}</pre>
                  </div>
                </div>
              </template>
            </section>
          </div>
          <AnalysisPanel
            v-if="inspection"
            :result="inspection.result"
            title="原文与参考图结构分析"
            :stale="inspectionStale"
            :busy="busy"
            input
            @apply="
              (id) =>
                run(
                  mode === 'text'
                    ? 'text.optimize'
                    : selected
                      ? 'reference.rewrite'
                      : 'reference.extract',
                  id,
                  true,
                )
            "
          />
          <AnalysisPanel
            v-if="analysis"
            :result="analysis.result"
            title="质量分析与修改建议"
            :stale="analysisStale"
            :busy="busy"
            @apply="
              (id) =>
                run(
                  mode === 'reference' ? 'reference.rewrite' : 'text.optimize',
                  id,
                )
            "
          />
        </template>
        <template
          v-else-if="
            page === 'history' || page === 'favorites' || page === 'library'
          "
          ><div class="page-title">
            <div>
              <span class="eyebrow">YOUR CREATIVE ASSETS</span>
              <h1>
                {{
                  page === "history"
                    ? "历史与版本"
                    : page === "favorites"
                      ? "我的收藏"
                      : "团队精品库"
                }}
              </h1>
              <p>
                {{
                  page === "library"
                    ? "经过打磨的提示词，由团队主动分享。复制到私人空间后可继续编辑。"
                    : "每次优化都留下记录，让好结果可以继续生长。"
                }}
              </p>
            </div>
            <button :disabled="busy" @click="attempt(exportPrivateData)">
              导出我的文字数据
            </button>
          </div>
          <input
            v-model="search"
            class="search"
            placeholder="搜索作品名称"
            aria-label="搜索作品"
          />
          <template v-if="page !== 'library'"
            ><h2>我的作品</h2>
            <div class="asset-grid">
              <article
                v-for="w in filteredHistory"
                :key="w.id"
                class="panel asset"
              >
                <span class="tag">{{
                  w.mode === "reference" ? "参考图" : "文字"
                }}</span>
                <h3>{{ w.title }}</h3>
                <p>{{ w.source_text || "参考图提示词提炼" }}</p>
                <div class="actions">
                  <button class="primary" :disabled="busy" @click="openWork(w)">
                    打开作品</button
                  ><button :disabled="busy" @click="favorite(w)">
                    {{ w.favorite ? "取消收藏" : "收藏" }}
                  </button>
                </div>
              </article>
            </div>
            <p v-if="!filteredHistory.length" class="muted">
              这里还没有作品，先提炼一张参考图吧。
            </p></template
          >
          <template v-if="page !== 'history'"
            ><h2>
              {{ page === "favorites" ? "收藏的团队作品" : "已分享的作品" }}
            </h2>
            <div class="asset-grid">
              <article
                v-for="item in filteredLibrary"
                :key="item.id"
                class="panel asset"
              >
                <span class="tag">{{
                  item.reference_path ? "含共享参考图" : "仅分享提示词"
                }}</span>
                <h3>{{ item.title }}</h3>
                <p>{{ item.bundle.zh }}</p>
                <div class="actions">
                  <button
                    class="primary"
                    :disabled="busy"
                    @click="importLibrary(item)"
                  >
                    复制到私人空间</button
                  ><button :disabled="busy" @click="favoriteLibrary(item)">
                    {{
                      favoriteIds.includes(item.id) ? "取消收藏" : "收藏"
                    }}</button
                  ><button
                    v-if="item.owner_id === user.id"
                    :disabled="busy"
                    @click="unpublish(item)"
                  >
                    撤回分享
                  </button>
                </div>
              </article>
            </div>
            <p v-if="!filteredLibrary.length" class="muted">
              暂时没有分享的作品。
            </p></template
          >
        </template>
        <template v-else-if="page === 'admin'"
          ><div class="page-title">
            <div>
              <span class="eyebrow">TEAM SETTINGS</span>
              <h1>团队管理</h1>
              <p>添加成员、设置登录密码，查看本站请求与任务设置。</p>
            </div>
          </div>
          <div class="admin-grid">
            <section class="panel">
              <h2>添加成员</h2>
              <form @submit.prevent="createMember">
                <label
                  >成员邮箱<input
                    v-model="newMemberEmail"
                    type="email"
                    autocomplete="off"
                    required
                /></label>
                <label
                  >初始密码<input
                    v-model="newMemberPassword"
                    type="password"
                    autocomplete="new-password"
                    minlength="12"
                    maxlength="128"
                    required
                /></label>
                <p class="hint">
                  至少 12
                  位。创建后，成员可以直接使用邮箱和密码登录，并自行修改密码。
                </p>
                <button class="primary" :disabled="busy">创建成员</button>
              </form>
              <details>
                <summary>已有账号？使用邀请链接加入</summary>
                <form @submit.prevent="invite">
                  <label
                    >成员邮箱<input
                      v-model="inviteEmail"
                      type="email"
                      required /></label
                  ><button class="primary" :disabled="busy">
                    生成邀请链接
                  </button>
                </form>
                <div v-if="inviteUrl" class="invite">
                  <p>请私下交给对应成员，链接持有人可进入该账号。</p>
                  <textarea
                    readonly
                    :value="inviteUrl"
                    aria-label="邀请链接"
                  ></textarea
                  ><button @click="copyInvite">复制邀请链接</button>
                </div>
              </details>
            </section>
            <form
              class="panel"
              @submit.prevent="
                attempt(async () => {
                  await call('settings.update', { settings });
                  notice = '使用设置已保存。';
                  await refreshUsage();
                })
              "
            >
              <h2>请求统计与可选上限</h2>
              <label
                >每人每天（0 为不限）<input
                  v-model.number="settings.member_daily"
                  type="number"
                  min="0"
                  max="10000"
                  required /></label
              ><label
                >团队每天（0 为不限）<input
                  v-model.number="settings.team_daily"
                  type="number"
                  min="0"
                  max="100000"
                  required /></label
              ><label
                >每人同时处理<input
                  v-model.number="settings.user_concurrent"
                  type="number"
                  min="1"
                  max="3"
                  required /></label
              ><label
                >团队同时处理<input
                  v-model.number="settings.team_concurrent"
                  type="number"
                  min="1"
                  max="10"
                  required /></label
              ><button class="primary" :disabled="busy">保存使用设置</button>
              <p class="hint">
                默认不设每日次数上限。这里统计本站接收的模型请求（含失败），不查询供应商余额或算力；兼容回退不重复计次。并发设置只防止瞬间拥堵。
              </p>
            </form>
          </div>
          <section class="panel">
            <h2>团队成员</h2>
            <div v-for="m in members" :key="m.user_id" class="member-row">
              <span
                >{{ m.email }}
                <small>{{
                  m.role === "admin" ? "管理员" : m.active ? "使用中" : "已停用"
                }}</small></span
              ><button
                v-if="m.role === 'member'"
                :disabled="busy"
                @click="updateMember(m)"
              >
                {{ m.active ? "停用" : "启用" }}
              </button>
              <button
                v-if="m.role === 'member'"
                :disabled="busy"
                @click="
                  passwordMember = m;
                  resetMemberPassword = '';
                "
              >
                重设密码
              </button>
            </div>
          </section></template
        >
      </div>
      <footer>
        @DONGWU 创作工作室 · 团队提示词资产 ·
        <a :href="SOURCE_URL" target="_blank" rel="noopener">查看源码</a>
      </footer>
    </main>
    <div
      v-if="inspirationOpen"
      class="modal-backdrop"
      @click.self="inspirationOpen = false"
    >
      <section
        class="modal inspiration-modal"
        role="dialog"
        aria-modal="true"
        aria-label="找点灵感"
      >
        <div class="panel-head">
          <div>
            <span class="eyebrow">A LITTLE INSPIRATION</span>
            <h2>从一个好想法开始</h2>
          </div>
          <button @click="inspirationOpen = false" aria-label="关闭灵感">
            ×
          </button>
        </div>
        <p>
          选择一个方向补充到现有提示词，再结合参考图调整。也可以直接使用当前提示词探索灵感；不会自动调用模型。
        </p>
        <button class="primary" @click="inspirationOpen = false">
          使用当前提示词探索灵感
        </button>
        <div class="inspiration-grid">
          <article
            v-for="(item, index) in STUDIO_INSPIRATIONS"
            :key="item.title"
          >
            <span class="tag">{{ item.category }}</span>
            <h3>{{ item.title }}</h3>
            <p>{{ item.prompt }}</p>
            <button @click="useInspiration(index)">
              带入提示词 <StudioIcon name="arrow" />
            </button>
          </article>
        </div>
      </section>
    </div>
    <div v-if="memoryOpen" class="modal-backdrop">
      <MemoryPanel :value="memoryState" :busy="busy" @save="saveMemory" @close="memoryOpen = false" />
    </div>
    <div v-if="publishOpen" class="modal-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-title"
        class="modal"
      >
        <h2 id="publish-title">发布到团队精品库</h2>
        <p>
          团队成员将能查看并复制当前提示词。私人历史和分析记录不会一起分享。
        </p>
        <label v-if="imagePath && !images.some(image => image.temporary)" class="checkbox"
          ><input
            v-model="shareImage"
            type="checkbox"
          />同时分享原始参考图</label
        >
        <p class="hint">默认仅分享提示词。之后可以撤回分享。</p>
        <p v-if="images.some(image => image.temporary)" class="hint">本次参考图不存入云端，团队库只分享文字成果。</p>
        <div class="actions">
          <button :disabled="busy" @click="publishOpen = false">取消</button
          ><button class="primary" :disabled="busy" @click="publish">
            确认发布
          </button>
        </div>
      </section>
    </div>
    <div v-if="setPassword" class="modal-backdrop">
      <form class="modal" @submit.prevent="savePassword">
        <h2>设置你的登录密码</h2>
        <p>之后可直接使用邮箱和密码登录。</p>
        <label
          >新密码<input
            v-model="password"
            type="password"
            autocomplete="new-password"
            minlength="12"
            maxlength="128"
            required
        /></label>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button class="primary" :disabled="busy">保存密码</button>
        <button
          type="button"
          :disabled="busy"
          @click="
            setPassword = false;
            password = '';
          "
        >
          取消
        </button>
      </form>
    </div>
    <div v-if="passwordMember" class="modal-backdrop">
      <form
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label="重设成员密码"
        @submit.prevent="changeMemberPassword"
      >
        <h2>重设成员密码</h2>
        <p>{{ passwordMember.email }}</p>
        <label
          >新密码<input
            v-model="resetMemberPassword"
            type="password"
            autocomplete="new-password"
            minlength="12"
            maxlength="128"
            required
        /></label>
        <p class="hint">
          仅支持在本工作室创建的账号。共享其他应用的账号请由成员自行修改，避免影响其他应用。
        </p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button
          type="button"
          :disabled="busy"
          @click="
            passwordMember = null;
            resetMemberPassword = '';
          "
        >
          取消
        </button>
        <button class="primary" :disabled="busy">确认重设</button>
      </form>
    </div>
  </div>
</template>
