<script setup lang="ts">
import type { ReferenceImage } from "../../../supabase/functions/_shared/studio-contract";
import StudioIcon from "./StudioIcon.vue";
defineProps<{
  images: Array<ReferenceImage & { preview: string; data?: string }>;
  busy: boolean;
  locked: boolean;
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
          ><button
            v-if="!locked"
            :disabled="busy"
            :aria-label="`移除图${index + 1}`"
            @click="emit('remove', index)"
          >
            ×
          </button>
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
        <div class="reference-order" v-if="!locked">
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
        </div>
      </article>
    </div>
    <label
      v-if="!locked && images.length < 5"
      class="upload-control"
      :class="{ compact: images.length }"
    >
      <StudioIcon :name="images.length ? 'plus' : 'image'" /><strong>{{
        images.length ? "添加参考图" : "上传参考图，让想法有据可循"
      }}</strong
      ><small>最多5张 · 单张 PNG / JPEG ≤ 10MB</small>
      <input
        type="file"
        multiple
        accept="image/png,image/jpeg"
        :disabled="busy"
        @change="emit('change', $event)"
      />
    </label>
    <p class="hint" v-if="locked">
      {{ images.some(image => image.temporary) ? '图号、用途和文字成果已保存；原图仅供本次使用，刷新后需重新选择原文件。' : '旧参考图仍随历史版本保存；添加或调整图片顺序请新建作品。用途说明仍可调整。' }}
    </p>
    <p class="reference-help" v-else>
      例如：图1提供产品，图2提供桌面与背景，图3提供人物。拖选或逐次添加后，请在提示词里说明怎样组合。
      新图仅供本次使用，不长期保存到工作室云端。
    </p>
  </div>
</template>

