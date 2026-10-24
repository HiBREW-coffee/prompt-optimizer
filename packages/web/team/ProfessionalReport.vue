<script setup lang="ts">
import type { ProfessionalReport } from "../../../supabase/functions/_shared/studio-contract";
defineProps<{ report: ProfessionalReport; zh?: string; en?: string }>();
</script>
<template>
  <div class="professional-report">
    <section class="report-intent">
      <span class="section-label">创作意图 / CREATIVE DIRECTION</span>
      <p>{{ report.intent }}</p>
    </section>
    <section class="report-block" v-if="report.imageRoles.length">
      <h3><span>01</span>图片职责与使用边界</h3>
      <article
        v-for="image in report.imageRoles"
        :key="image.index"
        class="image-role"
      >
        <span>图{{ image.index }}</span>
        <div>
          <h4>{{ image.role }}</h4>
          <p>{{ image.evidence }}</p>
          <p class="muted">{{ image.use }}</p>
        </div>
      </article>
    </section>
    <section class="report-block">
      <h3><span>02</span>要素对照清单 <small>Anchors & Variants</small></h3>
      <div class="anchor-grid">
        <article>
          <h4>固定要素 <span>保持一致</span></h4>
          <dl>
            <template v-for="item in report.anchors" :key="item.title"
              ><dt>{{ item.title }}</dt>
              <dd>{{ item.content }}</dd></template
            >
          </dl>
          <p v-if="!report.anchors.length" class="hint">用户未指定固定要素。</p>
        </article>
        <article>
          <h4>重构要素 <span>受控调整</span></h4>
          <dl>
            <template v-for="item in report.changes" :key="item.title"
              ><dt>{{ item.title }}</dt>
              <dd>{{ item.content }}</dd></template
            >
          </dl>
          <p v-if="!report.changes.length" class="hint">
            本次按原始参考忠实提炼。
          </p>
        </article>
      </div>
    </section>
    <section class="report-block">
      <h3><span>03</span>专业结构拆解</h3>
      <div class="structure-grid">
        <article v-for="item in report.sections" :key="item.title">
          <h4>{{ item.title }}</h4>
          <p>{{ item.content }}</p>
        </article>
      </div>
    </section>
    <section class="report-block" v-if="zh || en">
      <h3><span>04</span>完整生成提示词 <small>Ready to use</small></h3>
      <h4>中文提示词</h4>
      <p class="report-prompt">{{ zh }}</p>
      <h4>English prompt</h4>
      <p class="report-prompt" lang="en">{{ en }}</p>
    </section>
    <section
      class="report-block"
      v-if="report.negative.zh || report.negative.en"
    >
      <h3><span>05</span>负向提示词 <small>Negative Prompt</small></h3>
      <blockquote>{{ report.negative.zh }}</blockquote>
      <blockquote lang="en">{{ report.negative.en }}</blockquote>
    </section>
    <section class="report-block" v-if="report.parameters.length">
      <h3><span>06</span>推荐参数与使用条件</h3>
      <div class="parameter-list">
        <article v-for="item in report.parameters" :key="item.name">
          <strong>{{ item.name }}</strong
          ><b>{{ item.value }}</b>
          <p>{{ item.reason }}</p>
        </article>
      </div>
    </section>
    <section class="report-block" v-if="report.checks.length">
      <h3><span>07</span>成果验收清单</h3>
      <ul class="check-list">
        <li v-for="item in report.checks" :key="item">
          <span>✓</span>{{ item }}
        </li>
      </ul>
    </section>
  </div>
</template>
