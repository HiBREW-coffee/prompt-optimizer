<script setup lang="ts">
import { ref, watch } from "vue";
import type { StudioMemory } from "../../../supabase/functions/_shared/studio-memory";
import { STUDIO_TEMPLATES } from "../../../supabase/functions/_shared/studio-catalog";
const props = defineProps<{ value: StudioMemory; busy: boolean }>();
const emit = defineEmits<{ save: [memory: StudioMemory]; close: [] }>();
const draft = ref<StudioMemory>({ enabled: false, rules: [] });
watch(() => props.value, value => { draft.value = JSON.parse(JSON.stringify(value)); }, { immediate: true, deep: true });
function add() {
  if (draft.value.rules.length >= 12) return;
  draft.value.rules.push({ id: crypto.randomUUID(), title: "", rule: "", scope: "reference", template: "" });
}
const examples = [
  { title: "产品外观锁定", rule: "补充场景时保持产品的几何、结构、按钮、标识和颜色，不擅自改造或美化产品。" },
  { title: "场景自然融合", rule: "产品进入场景时匹配透视、尺度、支撑面、接触阴影和环境反射；人物和道具不要遮挡关键结构。" },
  { title: "完整中英输出", rule: "关键视觉细节应同时进入完整中英文正文，区分可见事实与不确定项，提供具体的负向约束和核验点。" },
];
function useExample(index: number) {
  if (draft.value.rules.length >= 12 || draft.value.rules.some(item => item.rule === examples[index].rule)) return;
  draft.value.rules.push({ id: crypto.randomUUID(), ...examples[index], scope: "reference", template: "" });
}
</script>
<template>
  <section class="modal memory-modal" role="dialog" aria-modal="true" aria-labelledby="memory-title">
    <div class="panel-head"><div><span class="eyebrow">LESS, BUT BETTER</span><h2 id="memory-title">我的创作经验</h2></div>
      <button :disabled="busy" aria-label="关闭创作经验" @click="emit('close')">×</button>
    </div>
    <p>只记录你确认有效的可复用规则。不收集图片、整段对话或失败结果，也不会训练模型或额外调用模型。</p>
    <form @submit.prevent="emit('save', draft)">
      <label class="checkbox"><input v-model="draft.enabled" type="checkbox" :disabled="busy" />将这些经验用于后续创作</label>
      <div class="actions"><button v-for="(example,index) in examples" :key="example.title" type="button" :disabled="busy || draft.rules.length >= 12" @click="useExample(index)">参考写法：{{ example.title }}</button></div>
      <div class="memory-rules">
        <article v-for="(item,index) in draft.rules" :key="item.id" class="memory-rule">
          <label>经验标题<input v-model="item.title" :aria-label="`经验${index+1}标题`" maxlength="60" required :disabled="busy" placeholder="例如：产品外观保持不变" /></label>
          <label>可复用规则<textarea v-model="item.rule" :aria-label="`经验${index+1}规则`" maxlength="280" required :disabled="busy" rows="3" placeholder="只写对以后也适用的约束，避免记录本次图号、品牌、人物或场景。" /></label>
          <div class="memory-scope">
            <label>适用任务<select v-model="item.scope" :disabled="busy"><option value="reference">参考图创作</option><option value="text">文字创作</option><option value="all">全部创作</option></select></label>
            <label>适用模板<select v-model="item.template" :disabled="busy"><option value="">所有模板</option><option v-for="template in STUDIO_TEMPLATES" :key="template.id" :value="template.id">{{ template.name }}</option></select></label>
            <button type="button" :disabled="busy" @click="draft.rules.splice(index,1)">移除此条</button>
          </div>
        </article>
      </div>
      <p v-if="!draft.rules.length" class="hint">先完成一次创作，再把真正有效的做法提炼成一句经验。不会自动把作品加入记忆。</p>
      <div class="actions">
        <button type="button" :disabled="busy || draft.rules.length >= 12" @click="add">添加经验</button>
        <button class="primary" :disabled="busy">保存创作经验</button>
      </div>
      <p class="hint">私人文字经验总量不超过16KB；每次最多带入4条适用规则。本次要求优先，可随时关闭或修改；保存不调用模型。</p>
    </form>
  </section>
</template>

