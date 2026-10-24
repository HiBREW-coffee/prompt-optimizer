/** Public descriptions only. The actual original system templates remain server-side. */
export const STUDIO_TEMPLATES = [
  {
    id: "ecommerce",
    name: "电商产品摄影",
    description: "主体、场景、机位、光影与商业展示重点",
  },
  {
    id: "photography",
    name: "专业摄影",
    description: "景别、镜头关系、光线层次和材质表现",
  },
  {
    id: "identity",
    name: "产品外观锁定",
    description: "保持产品结构、标识、比例与操作机构",
  },
  {
    id: "multiimage",
    name: "多图场景融合",
    description: "明确每张图的职责、借用边界和空间关系",
  },
  {
    id: "lighting",
    name: "参考图光影迁移",
    description: "迁移环境光影，匹配接触阴影、透视与反射",
  },
  {
    id: "structured",
    name: "结构化提示词",
    description: "逐层拆分主体、构图、场景、光线与约束",
  },
  {
    id: "general",
    name: "通用文字优化",
    description: "目标、输入、执行步骤、约束和输出规范",
  },
] as const;
export const STUDIO_INSPIRATIONS = [
  {
    title: "白底产品进入真实场景",
    category: "多图融合",
    template: "multiimage",
    prompt:
      "以图1的白底产品为唯一产品主体，保持外形、结构、材质、颜色和标识不变。参考图2的桌面、背景与人物安排建立场景；根据图1产品的透视匹配桌面支撑面、尺度、景深、环境反射与接触阴影。人物可以与产品自然互动，不得遮挡产品关键部位。逐张说明借用内容与禁止迁移内容。",
  },
  {
    title: "给 KeyShot 白底渲染补场景",
    category: "产品摄影",
    template: "lighting",
    prompt:
      "图1是 KeyShot 产品白底渲染图，产品几何形状、细节、颜色、标识和相机视角保持不变。仅依据图2为产品添加适配的桌面与背景，匹配场景光源方向、亮暗过渡、反射、接触阴影和环境遮蔽。不要重绘或美化产品结构。",
  },
  {
    title: "复刻光线与构图",
    category: "参考复刻",
    template: "photography",
    prompt:
      "忠实拆解图1的构图、主体比例、前中后景、拍摄视角、主光方向、阴影形状与材质。给出固定要素和可替换要素，生成可独立使用的完整中英文提示词，不添加无依据的相机型号或品牌。",
  },
  {
    title: "产品与人物的自然互动",
    category: "生活方式",
    template: "ecommerce",
    prompt:
      "以图1为产品外观依据，以图2为场景、桌面和人物氛围参考。建立人物与产品之间可实现的动作和视线关系，明确前后位置、相对尺寸与接触点，保持产品可识别且关键操作区域无遮挡。",
  },
  {
    title: "只学习画面风格",
    category: "风格学习",
    template: "photography",
    prompt:
      "保留图1的主体与结构，从图2学习配色、材质处理、构图节奏和光影层次。不要把图2中的产品、Logo或人物默认替换进主体；只有我明确要求的内容才能迁移。",
  },
  {
    title: "专业提示词结构诊断",
    category: "文字优化",
    template: "general",
    prompt:
      "分析这段提示词的目标、输入、主体、约束、执行顺序和输出规范。指出歧义、遗漏及互相冲突的要求，给出有优先级的可执行修改建议，再输出保留原意的完整优化版本。",
  },
] as const;
