<template>
  <NPopover
    v-if="review.literalChecks.length || review.manualClauses.length"
    trigger="click"
    placement="bottom-end"
    :width="420"
  >
    <template #trigger>
      <NButton
        size="small"
        :type="requiresReview ? 'warning' : 'default'"
        ghost
        data-testid="prompt-constraint-review-trigger"
        :aria-label="t('constraintReview.title')"
      >
        {{ t('constraintReview.title') }}
        <span v-if="requiresReview" class="ml-1">({{ reviewCount }})</span>
      </NButton>
    </template>
    <div class="constraint-review-panel" data-testid="prompt-constraint-review-panel">
      <NText strong>{{ t('constraintReview.title') }}</NText>
      <p class="constraint-review-explanation">{{ t('constraintReview.explanation') }}</p>

      <template v-if="review.literalChecks.length">
        <NText strong class="constraint-review-heading">{{ t('constraintReview.literalTitle') }}</NText>
        <div
          v-for="check in review.literalChecks"
          :key="`${check.kind}:${check.value}`"
          class="constraint-review-item"
        >
          <NTag :type="check.present ? 'success' : 'warning'" size="small" :bordered="false">
            {{ check.present ? t('constraintReview.found') : t('constraintReview.notFound') }}
          </NTag>
          <NText depth="3" class="constraint-review-kind">{{ t(`constraintReview.${check.kind}`) }}</NText>
          <NText class="constraint-review-value">{{ check.value }}</NText>
        </div>
      </template>

      <template v-if="review.manualClauses.length">
        <NText strong class="constraint-review-heading">{{ t('constraintReview.manualTitle') }}</NText>
        <p class="constraint-review-explanation">{{ t('constraintReview.manualHelp') }}</p>
        <div
          v-for="clause in review.manualClauses"
          :key="clause"
          class="constraint-review-item"
        >
          <NTag size="small" type="warning" :bordered="false">{{ t('constraintReview.manual') }}</NTag>
          <NText class="constraint-review-value">{{ clause }}</NText>
        </div>
      </template>
    </div>
  </NPopover>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NPopover, NTag, NText } from 'naive-ui'
import { reviewPromptConstraints } from '../utils/promptConstraintReview'

const props = defineProps<{
  originalPrompt: string
  optimizedPrompt: string
}>()

const { t } = useI18n()
const review = computed(() => reviewPromptConstraints(props.originalPrompt, props.optimizedPrompt))
const reviewCount = computed(() =>
  review.value.literalChecks.filter(check => !check.present).length + review.value.manualClauses.length,
)
const requiresReview = computed(() => reviewCount.value > 0)
</script>

<style scoped>
.constraint-review-panel {
  max-height: 340px;
  overflow-y: auto;
  overflow-wrap: anywhere;
}
.constraint-review-explanation {
  margin: 6px 0 12px;
  font-size: 12px;
  color: var(--n-text-color-3, #888);
}
.constraint-review-heading {
  display: block;
  margin: 12px 0 7px;
}
.constraint-review-item {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 6px 0;
  font-size: 12px;
}
.constraint-review-kind {
  min-width: 42px;
  flex-shrink: 0;
}
.constraint-review-value {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
}
</style>
