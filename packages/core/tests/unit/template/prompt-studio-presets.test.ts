import { describe, expect, it } from 'vitest';
import { ALL_TEMPLATES } from '../../../src/services/template/default-templates';
import { TemplateProcessor } from '../../../src/services/template/processor';

const PRESETS = [
  ['ps_product_identity_lock', 'image2imageOptimize'],
  ['ps_reference_lighting_transfer', 'multiimageOptimize'],
  ['ps_ecommerce_product_photography', 'text2imageOptimize'],
  ['ps_ecommerce_copy_plain_language', 'userOptimize'],
] as const;

describe('HiBREW Prompt Studio templates', () => {
  it.each(PRESETS)('registers %s in %s mode', (key, mode) => {
    const template = ALL_TEMPLATES[key];
    expect(template.id).toMatch(/^ps-[a-z0-9-]+$/);
    expect(template.isBuiltin).toBe(true);
    expect(template.metadata.language).toBe('zh');
    expect(template.metadata.templateType).toBe(mode);
    expect(Array.isArray(template.content)).toBe(true);
  });

  it.each(PRESETS)('renders original prompt literally for %s', (key) => {
    const originalPrompt = '保持图1不变，输出 3:4，保留 {{subject}} 和引号 "原文"';
    const messages = TemplateProcessor.processTemplate(ALL_TEMPLATES[key], {
      originalPrompt,
      inputImageCount: 2,
    });
    const user = messages.find(message => message.role === 'user')?.content ?? '';
    expect(user).toContain(JSON.stringify(originalPrompt));
    expect(user).toContain('{{subject}}');
    expect(user).not.toContain('{{{originalPrompt}}}');
  });

  it('describes the numbered image relationship for lighting transfer', () => {
    const messages = TemplateProcessor.processTemplate(
      ALL_TEMPLATES.ps_reference_lighting_transfer,
      { originalPrompt: '图1主体使用图2的光影', inputImageCount: 2 },
    );
    const text = messages.map(message => message.content).join('\n');
    expect(text).toContain('图1');
    expect(text).toContain('图2');
    expect(text).toContain('2');
  });
});
