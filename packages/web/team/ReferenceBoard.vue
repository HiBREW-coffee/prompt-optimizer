<script setup lang="ts">
import type { ReferenceImage } from "../../../supabase/functions/_shared/studio-contract";
import StudioIcon from "./StudioIcon.vue";
defineProps<{
  images: Array<ReferenceImage & { preview: string; data?: string }>;
  busy: boolean;
}>();
const emit = defineEmits<{
  change: [event: Event];
  remove: [index: number];
  move: [index: number, direction: number];
  update: [index: number, key: "role" | "note", value: string];
  restore: [index: number, event: Event];
}>();
</script>
<template>
  <div class="reference-board">
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
    <label
      class="upload-control"
      :class="{ compact: images.length, 'upload-full': images.length >= 5 }"
    >
      <StudioIcon :name="images.length ? 'plus' : 'image'" /><strong>{{
        images.length ? "添加图片" : "上传参考图，让想法有据可循"
      }}</strong
      ><small>最多5张 · 单张 PNG / JPEG ≤ 10MB</small>
      <input
        type="file"
        multiple
        accept="image/png,image/jpeg"
        :disabled="busy || images.length >= 5"
        @change="emit('change', $event)"
      />
    </label>
    <p class="reference-help">
      可直接添加、删除或调整顺序，最多5张。图号变化后，请核对提示词；旧成果保留。
      新图仅供本次使用，刷新后可按图号补传原文件。
    </p>
  </div>
</template>
