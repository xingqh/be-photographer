import { z } from 'zod';
export const findingSchema = z.object({ value: z.string(), confidence: z.enum(['high','medium','low']), evidence: z.string() });
export const analysisSchema = z.object({
  title: z.string(), summary: z.string(),
  scene: findingSchema, location: findingSchema, light: findingSchema, position: findingSchema,
  focalLength: findingSchema, aperture: findingSchema, shutter: findingSchema, iso: findingSchema,
  composition: z.object({ name: z.string(), summary: z.string(), elements: z.array(z.object({ title: z.string(), description: z.string() })) }),
  grading: z.object({ style: z.string(), summary: z.string(), steps: z.array(z.object({ parameter: z.string(), direction: z.string(), amount: z.string(), strength: z.number().min(-1).max(1), reason: z.string() })) }),
  tips: z.array(z.string()), limitations: z.array(z.string())
});
export type Analysis = z.infer<typeof analysisSchema>;
export type Finding = z.infer<typeof findingSchema>;
export const sample: Analysis = {
  title: '山湖之间，宁静的层次', summary: '开阔的山地湖泊、平静的倒影与通透的蓝绿色，构成这张照片的秩序。画面的关键在于保留空间层次，而非一味增加饱和度。',
  scene: { value: '山地湖泊 · 森林', confidence: 'high', evidence: '远处岩壁与山脉环抱湖面，岸边有连续森林，近处可见水下卵石。' },
  location: { value: '温带山地湖区', confidence: 'medium', evidence: '植被与地形符合温带山地湖区特征；欧洲阿尔卑斯及其他山地也可能出现，不能仅凭画面确定国家。' },
  light: { value: '晴天 · 侧向自然光', confidence: 'medium', evidence: '右侧山体存在明暗分区，天空清晰、倒影稳定。仅凭成片无法确认时刻。' },
  position: { value: '湖岸低机位 · 平视略俯', confidence: 'medium', evidence: '近处水下卵石占据前景，视线沿湖面延伸至远山；可能在岸边以站姿或略降低机位拍摄。' },
  focalLength: { value: '约 20–35 mm', confidence: 'low', evidence: '以全画幅等效估计：视野开阔，前景与远山同时入画。裁切、传感器尺寸和全景拼接均会影响判断。' },
  aperture: { value: '可能 f/8–f/11', confidence: 'low', evidence: '前景和远景都有可辨细节，小光圈是可尝试的复现方案；并非原始光圈的确认。' },
  shutter: { value: '无法可靠反推', confidence: 'low', evidence: '静止湖面的细微波纹不足以推断快门速度，也无法排除后期处理。' },
  iso: { value: '可能采用低 ISO', confidence: 'low', evidence: '晴天静态风光可优先尝试 ISO 100–200，但缩图与降噪使原始 ISO 无法确认。' },
  composition: { name: '倒影呼应 · 三层景深', summary: '湖岸线接近画面中部，山体与倒影形成呼应。近处卵石与木桩提供尺度，远处山谷将视线带入画面。', elements: [
    { title: '前景：水下卵石与木桩', description: '前景纹理建立空间深度，右侧木桩打破倒影的完全对称，让画面更自然。' },
    { title: '中景：湖面与森林', description: '平静湖面承担倒影，岸边森林形成横向边界，连接左右山体。' },
    { title: '远景：山谷与天空', description: '两侧山势收拢至远处谷口，引导视线进入纵深。天空留白让山体不显压迫。' }
  ] },
  grading: { style: '清透冷调 · 克制的蓝绿色', summary: '从白平衡和明暗层次入手，让水与天空偏冷、植被保持自然。以下是复现类似观感的建议，不代表作者使用过这些参数。', steps: [
    { parameter: '白平衡', direction: '略偏冷', amount: '轻微；观察岩石是否仍自然', strength: -0.25, reason: '让水面与天空统一冷调，避免将白色岩壁调成明显蓝色。' },
    { parameter: '高光', direction: '降低', amount: '中等；可从 -20～-40 试起', strength: -0.45, reason: '保留天空和远山亮部细节，避免亮部抢走注意力。' },
    { parameter: '阴影', direction: '提升', amount: '轻到中等；约 +10～+30', strength: 0.3, reason: '适度展开森林和水下石头的细节，保留暗部层次。' },
    { parameter: '自然饱和度', direction: '轻微提升', amount: '轻微；约 +5～+15', strength: 0.2, reason: '优先提升自然饱和度，避免全局饱和度让蓝绿失真。' },
    { parameter: 'HSL · 绿色', direction: '降低饱和度', amount: '轻微；约 -5～-15', strength: -0.2, reason: '压住过艳的植被，让山体、湖水与森林更协调。' },
    { parameter: '局部蒙版', direction: '前景提亮', amount: '轻微；柔和过渡', strength: 0.25, reason: '用渐变或画笔轻提卵石细节，避免把湖面倒影一起提灰。' }
  ] },
  tips: ['沿湖岸寻找平静水面，让倒影成为构图的一部分。', '保留近处纹理作为前景，拍摄时注意画面边缘的杂物。', '先建立明暗关系，再微调蓝绿；不要同时大幅增加清晰度与去朦胧。'],
  limitations: ['这是人工整理的示例解读，未调用视觉模型，也不代表摄影师的实际拍摄设置。', '焦段采用全画幅等效范围；无 EXIF 时，光圈、快门和 ISO 无法得到准确值。', '没有原始 RAW 和前后对照，无法还原真实后期步骤。']
};
export function reportMarkdown(a: Analysis, filename: string, demo: boolean) {
  const level = { high: '较高', medium: '中等', low: '较低' };
  const fields: [string, Finding][] = [['场景',a.scene],['地点类型',a.location],['光线',a.light],['机位',a.position],['焦段',a.focalLength],['光圈',a.aperture],['快门',a.shutter],['ISO',a.iso]];
  return `# ${a.title}\n\n照片：${filename}\n来源：${demo ? '人工示例解读' : '视觉模型分析'}\n\n${a.summary}\n\n## 场景与拍摄\n\n${fields.map(([k,v])=>`### ${k}\n${v.value}（可信程度：${level[v.confidence]}）\n\n依据：${v.evidence}`).join('\n\n')}\n\n## 构图：${a.composition.name}\n\n${a.composition.summary}\n\n${a.composition.elements.map(e=>`- **${e.title}**：${e.description}`).join('\n')}\n\n## Lightroom 调色建议\n\n${a.grading.summary}\n\n${a.grading.steps.map((s,i)=>`${i+1}. **${s.parameter}**：${s.direction}，${s.amount}。${s.reason}`).join('\n')}\n\n## 拍摄练习\n\n${a.tips.map(s=>`- ${s}`).join('\n')}\n\n## 判断边界\n\n${a.limitations.map(s=>`- ${s}`).join('\n')}\n`;
}
