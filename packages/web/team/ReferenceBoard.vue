<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import type { ReferenceImage } from "../../../supabase/functions/_shared/studio-contract";
import { transferredFiles, carriesFiles } from "./reference-input";
import StudioIcon from "./StudioIcon.vue";
const props = defineProps<{
  images: Array<ReferenceImage & { preview: string; data?: string }>;
  busy: boolean;
}>();
const emit = defineEmits<{
  change: [event: Event];
  files: [files: File[]];
  paste: [];
  error: [code: string];
  remove: [index: number];
  move: [index: number, direction: number];
  update: [index: number, key: "role" | "note", value: string];
  restore: [index: number, event: Event];
}>();
const board = ref<HTMLElement | null>(null), picker = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
let dragDepth = 0;
function resetDrag() { dragDepth = 0; dragging.value = false; }
watch(() => props.busy, (busy) => { if (busy) resetDrag(); });
function dragEnter(event: DragEvent) {
  if (!carriesFiles(event.dataTransfer)) return;
  dragDepth++;
  dragging.value = !props.busy && props.images.length < 5;
}
function dragLeave() { if (--dragDepth <= 0) resetDrag(); }
function dragOver(event: DragEvent) {
  if (event.dataTransfer) event.dataTransfer.dropEffect = props.busy || props.images.length >= 5 ? "none" : "copy";
}
function drop(event: DragEvent) {
  resetDrag();
  if (props.busy) return;
  const files = transferredFiles(event.dataTransfer);
  if (files.length) emit("files", files);
  else emit("error", "DROP_IMAGE_FILES");
}
function paste(event: ClipboardEvent) {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('.modal-backdrop, [role="dialog"], [aria-modal="true"], input[type="password"]')) return;
  const files = transferredFiles(event.clipboardData);
  if (!files.length) return;
  const editable = target?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])');
  if (editable && Array.from(event.clipboardData?.types ?? []).some((type) => type === "text/plain" || type === "text/html")) return;
  event.preventDefault();
  if (!props.busy) emit("files", files);
}
function outsideDragOver(event: DragEvent) {
  if (!carriesFiles(event.dataTransfer) || board.value?.contains(event.target as Node)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
}
function outsideDrop(event: DragEvent) {
  resetDrag();
  if (!carriesFiles(event.dataTransfer) || event.defaultPrevented) return;
  event.preventDefault(); // A missed drop must not navigate away and destroy the draft.
  const target = event.target instanceof Element ? event.target : null;
  if (!props.busy && !target?.closest('.modal-backdrop, [role="dialog"], [aria-modal="true"]'))
    emit("error", "DROP_OUTSIDE_REFERENCE");
}
onMounted(() => {
  window.addEventListener("paste", paste);
  window.addEventListener("dragover", outsideDragOver);
  window.addEventListener("drop", outsideDrop);
  window.addEventListener("dragend", resetDrag);
});
onBeforeUnmount(() => {
  window.removeEventListener("paste", paste);
  window.removeEventListener("dragover", outsideDragOver);
  window.removeEventListener("drop", outsideDrop);
  window.removeEventListener("dragend", resetDrag);
});
</script>
<template>
  <div class="reference-board" ref="board" @dragenter.prevent="dragEnter"
    @dragleave.prevent="dragLeave" @dragover.prevent="dragOver" @drop.prevent.stop="drop">
    <div class="reference-heading">
      <span
        >参考图 <b>{{ images.length }}<small> / 5</small></b></span
      ><small>按顺序对应图1—图5</small>
    </div>
    <div class="reference-grid" v-if="images.length">
      <article
        class="reference-card"
        v-for="(image, index) in images"
        :key="image.path"
      >
        <div class="reference-photo">
          <img v-if="image.preview" :src="image.preview" :alt="`图${index + 1}参考图`" />
          <span v-else class="reference-missing">原图未长期保存</span><b
            >图{{ index + 1 }}</b
          >
        </div>
        <label v-if="image.temporary && !image.preview" class="restore-reference">
          重新选择图{{ index + 1 }}原文件
          <input type="file" accept="image/png,image/jpeg" :disabled="busy"
            :aria-label="`重新选择图${index+1}原文件`" @change="emit('restore',index,$event)" />
        </label>
        <label class="compact-label"
          >图{{ index + 1 }}用途<select
            :value="image.role"
            :disabled="busy"
            @change="
              emit(
                'update',
                index,
                'role',
                ($event.target as HTMLSelectElement).value,
              )
            "
          >
            <option value="auto">自动理解</option>
            <option value="product">产品主体</option>
            <option value="scene">场景 / 背景</option>
            <option value="person">人物 / 动作</option>
            <option value="style">风格 / 光影</option>
            <option value="detail">局部细节</option>
          </select></label
        >
        <input
          :aria-label="`图${index + 1}用途说明`"
          :value="image.note"
          :disabled="busy"
          maxlength="1000"
          placeholder="补充这张图的用途（可选）"
          @input="
            emit(
              'update',
              index,
              'note',
              ($event.target as HTMLInputElement).value,
            )
          "
        />
        <div class="reference-order">
          <button
            :disabled="busy || index === 0"
            :aria-label="`上移图${index + 1}`"
            @click="emit('move', index, -1)"
          >
            ← 前移</button
          ><button
            :disabled="busy || index === images.length - 1"
            :aria-label="`下移图${index + 1}`"
            @click="emit('move', index, 1)"
          >
            后移 →
          </button>
          <button class="reference-delete" :disabled="busy" :aria-label="`删除图${index+1}`" @click="emit('remove',index)">删除</button>
        </div>
      </article>
    </div>
    <div
      class="upload-control"
      :class="{ compact: images.length, 'upload-full': images.length >= 5, 'is-dragging': dragging }"
      role="group" aria-label="参考图上传区域" tabindex="0"
    >
      <StudioIcon :name="images.length ? 'plus' : 'image'" /><strong>{{
        dragging ? "松开即可添加图片" : images.length >= 5 ? "已添加 5 张参考图" : images.length ? "继续添加参考图" : "把参考图拖到这里"
      }}</strong
      ><small>支持 Ctrl + V 粘贴 · PNG / JPEG · 单张 ≤ 10MB</small>
      <div class="upload-actions">
        <button type="button" :disabled="busy || images.length >= 5" @click="picker?.click()"><StudioIcon name="plus" />选择图片</button>
        <button type="button" :disabled="busy || images.length >= 5" @click="emit('paste')"><StudioIcon name="copy" />粘贴图片</button>
      </div>
      <input
        ref="picker"
        type="file"
        multiple
        accept="image/png,image/jpeg"
        aria-label="选择参考图片"
        :disabled="busy || images.length >= 5"
        @change="emit('change', $event)"
      />
    </div>
    <p class="reference-help">
      复制图片后可直接粘贴，也可拖入一张或多张图片，自动追加，最多5张。图号变化后，请核对提示词；旧成果保留。
      新图仅供本次使用，刷新后可按图号补传原文件。
    </p>
  </div>
</template>
