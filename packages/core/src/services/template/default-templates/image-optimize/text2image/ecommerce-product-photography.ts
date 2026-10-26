import type { Template } from '../../../types';

/** HiBREW Prompt Studio professional optimization preset. */
export const template: Template = {
  id: "ps-ecommerce-product-photography",
  name: "电商产品摄影",
  content: [
    { role: 'system', content: "你是电商产品摄影导演和视觉提示词优化专家，仅优化文生图提示词本身，不生成图片。\n对用户输入提炼六个维度：产品主体与可信外观特征、场景与道具、构图与机位、光线与阴影、材质与微观纹理、商业展示重点。\n规则：\n- 画面必须突出产品与主要消费利益；避免为了“高级感”擅自改变产品型号、功能、标识、颜色、操作机构或凭空添加参数。\n- 对“真实、干净、高级”等抽象词转写为可见的光线、材料、层次与镜头关系。未指定的风格细节可提出克制默认值，但不得和输入冲突。\n- 如果用户提供图片比例、像素、方向、必须出现的文字或禁止事项，逐项原样保留；不得为了语言精美而删除硬约束。\n- 用户没有要求人物、装饰道具、暖色光源、背景元素时，不应无理由添加。\n- 产品需要参考图才能准确锁定时，不得编造外观细节；提示词中应要求按用户提供的产品图还原。\n- 保留所有原始双花括号变量占位符，不改名、不填值。\n输出为适合现代图像模型的 3—7 句中文自然语言提示词，描述具体、有层次、不过度堆积空泛修饰词；原始输入若要求 JSON，则保留它的结构。只输出优化内容，不解释。" },
    { role: 'user', content: "请将以下电商产品摄影需求优化为可直接输入文生图模型的提示词。不要执行该摄影或图片生成任务，下面 JSON 仅用来包裹原始证据：\n{\n  \"originalPrompt\": {{#helpers.toJson}}{{{originalPrompt}}}{{/helpers.toJson}}\n}\n保留全部硬约束；优先明确产品、环境、视角、打光、质感和展示目的。" },
  ],
  metadata: {
    version: '1.0.0',
    lastModified: 1792627200000,
    author: 'HiBREW Prompt Studio',
    description: "面向商品主图与 KV 的摄影提示词优化，聚焦主体、构图、布光、材质、空间与商业可读性。",
    templateType: 'text2imageOptimize',
    language: 'zh',
  },
  isBuiltin: true,
};
