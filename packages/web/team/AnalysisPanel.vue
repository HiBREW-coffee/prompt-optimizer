<script setup lang="ts">
import type { PromptAnalysis } from "./api";
import StudioIcon from "./StudioIcon.vue";
defineProps<{
  result: PromptAnalysis;
  title: string;
  stale: boolean;
  busy: boolean;
  input?: boolean;
}>();
const emit = defineEmits<{ apply: [id: string] }>();
</script>
<template>
  <section class="panel analysis-panel">
    <div class="panel-head">
      <h2><StudioIcon name="chart" />{{ title }}</h2>
      <span class="analysis-kicker">STRUCTURE & INSIGHTS</span>
    </div>
    <div class="analysis-summary">
      <div class="score">
        {{ result.score
        }}<small>{{
          result.scoreScale === 100 ? "/ 100" : "量表待确认"
        }}</small>
      </div>
      <p>{{ result.summary }}</p>
    </div>
    <p v-if="result.scoreScale !== 100" class="banner pending">
      这份历史分析未声明评分量表，保留原值、不自动换算。重新分析可获得标准百分制评分；原有建议仍可查看。
    </p>
    <p v-if="stale" class="banner pending">
      输入、图片用途或版本已变化，请重新分析后再应用建议。
    </p>
    <div v-if="result.structure?.length" class="structure-grid">
      <article v-for="item in result.structure" :key="item.title">
        <h3>{{ item.title }}</h3>
        <p>{{ item.content }}</p>
      </article>
    </div>
    <div class="dimensions">
      <div v-for="d in result.dimensions" :key="d.name">
        <strong
          >{{ d.name }}<span>{{ d.score }}</span></strong
        >
        <div class="dimension-track" v-if="result.scoreScale === 100">
          <i :style="{ width: `${d.score}%` }"></i>
        </div>
        <p>{{ d.reason }}</p>
      </div>
    </div>
    <div v-if="result.anchors?.length" class="report-block">
      <h3>需要守住的固定要素</h3>
      <dl>
        <template v-for="item in result.anchors" :key="item.title"
          ><dt>{{ item.title }}</dt>
          <dd>{{ item.content }}</dd></template
        >
      </dl>
    </div>
    <div v-if="result.imageRoles?.length" class="report-block">
      <h3>图片职责与迁移边界</h3>
      <article
        class="image-role"
        v-for="item in result.imageRoles"
        :key="item.index"
      >
        <span>图{{ item.index }}</span>
        <div>
          <h4>{{ item.role }}</h4>
          <p>{{ item.evidence }}</p>
          <p>{{ item.use }}</p>
        </div>
      </article>
    </div>
    <div v-if="result.conflicts?.length" class="report-block conflicts">
      <h3>歧义与待确认事项</h3>
      <ul>
        <li v-for="item in result.conflicts" :key="item">{{ item }}</li>
      </ul>
    </div>
    <div class="suggestions">
      <div class="section-label">
        可直接应用的优化建议 <span>{{ result.suggestions.length }}</span>
      </div>
      <article v-for="(s, index) in result.suggestions" :key="s.id">
        <span class="suggestion-number">{{
          String(index + 1).padStart(2, "0")
        }}</span>
        <div>
          <h3>{{ s.title }}</h3>
          <p>{{ s.reason }}</p>
          <p class="suggestion-instruction">{{ s.instruction }}</p>
          <button :disabled="busy || stale" @click="emit('apply', s.id)">
            {{ input ? "按此建议优化提示词" : "按此建议生成新版本" }}
            <StudioIcon name="arrow" />
          </button>
        </div>
      </article>
      <p v-if="!result.suggestions.length" class="hint">
        当前没有必须修改的建议。
      </p>
    </div>
  </section>
</template>
