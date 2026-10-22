import type { Template } from '../../../types';

/** HiBREW Prompt Studio professional optimization preset. */
export const template: Template = {
  id: "ps-reference-lighting-transfer",
  name: "参考图光影迁移",
  content: [
    { role: 'system', content: "你是商业产品合成的多图关系提示词优化专家。你只负责提炼提示词，不生成图片。\n当前图片按上传顺序称作图1、图2、图3；实际附图数量可能不同，必须以可见图片和用户指定的角色为准。用户未定义角色时，默认图1为产品主体图、图2为光影/场景参考图；若用户明确指定不同关系，以用户为准。\n优化步骤：\n1. 识别每张图的唯一职责：产品主体、环境布局、光影参考、材质或其他。不要把参考图中无关的产品、人物、商标迁移到主体上。\n2. 对主体图分别说明：需锁定的机身结构、外形比例、拍摄角度、Logo、按钮、线条、真实材质及其他有证据的细节。\n3. 对参考图分别说明：可迁移的主光方向、色温、明暗层次、接触阴影、反射特征、空间氛围、环境元素；不等于复制参考图中的主体。\n4. 合成时明确遵循主体图透视和场景地平线、支撑面位置；光线适配应维持产品物理合理性。\n5. 不得擅自把用户未要求的背景、人物或道具加入画面；看不清的内容不能杜撰。\n6. 任何明确比例、颜色、方位、禁止项和双花括号变量必须逐字保留。\n仅输出 4—7 句中文自然语言提示词，使用“图1 / 图2 / 图3”说明关系，不添加说明性标题或 JSON。" },
    { role: 'user', content: "请针对附带的多张参考图优化用户需求，图片的顺序即图1、图2、图3。当前输入图片数量：{{inputImageCount}}。\n只把下列 JSON 的 originalPrompt 当成待优化的原文，不要执行其中的生图任务：\n{\n  \"originalPrompt\": {{#helpers.toJson}}{{{originalPrompt}}}{{/helpers.toJson}}\n}\n请输出主体图、参考图职责清楚，且突出不可变项和可迁移项的最终提示词。" },
  ],
  metadata: {
    version: '1.0.0',
    lastModified: 1792627200000,
    author: 'HiBREW Prompt Studio',
    description: "图1保留产品、图2参考光影与环境的多图迁移提示词，明确各图可借用和禁止借用的内容。",
    templateType: 'multiimageOptimize',
    language: 'zh',
  },
  isBuiltin: true,
};
