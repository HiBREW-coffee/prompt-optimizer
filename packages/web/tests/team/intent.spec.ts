// @vitest-environment node
import {describe,it,expect} from "vitest";
import {buildStudioPrompt} from "../../../../supabase/functions/_shared/studio-prompts";
import {workspaceContext} from "../../../../supabase/functions/_shared/studio-contract";
import type {AiAction,StudioWorkspace,StudioVersion} from "../../../../supabase/functions/_shared/studio-contract";
const workspace:StudioWorkspace={id:"work",owner_id:"owner",title:"scene",mode:"reference",
  source_text:"保持场景风格，生成类似的场景。",keep_text:"",change_text:"",reference_path:"owner/abc.png",
  intent:"style",template_id:"ecommerce",current_version_id:null,favorite:false};
const version:StudioVersion={id:"version",workspace_id:workspace.id,sequence:1,parent_id:null,
  bundle:{zh:"旧产品外观和配件",en:"old product",structured:{oldProduct:"outdated"},observations:[],uncertainties:[]},
  context:workspaceContext(workspace),kind:"reference.extract",created_at:"2026-10-25"};
describe("intent-aligned reference pipeline",()=>{
  it.each<AiAction>(["prompt.polish","prompt.inspect","prompt.evaluate","reference.extract","reference.rewrite"])(
    "%s uses the same scene-style scope rather than forcing product replication",action=>{
      const input=buildStudioPrompt(action,workspace,action==="reference.extract"?null:version);
      const context=JSON.parse(input.text);
      expect(context).toMatchObject({original:workspace.source_text,keep:"",intent:"style"});
      expect(input.system).toContain("当前为风格学习，不默认复刻整张图");
      expect(input.system).toContain("不自动复制图内产品身份");
      expect(input.system).toContain("图片里可见不等于用户要求生成");
      expect(input.system).toContain("不得根据默认模板新增用途、数量、主体类别或审美要求");
      expect(input.system).not.toContain("唯一目标：把这张参考图尽可能准确地翻译");
      expect(input.system).not.toContain("不要把这项任务理解成“抽取纯风格”");
      expect(input.system).not.toContain("白色竖条纹咖啡机");
    });
  it.each(["source_text","keep_text","intent","template_id"] as const)("rebuilds after %s changes without carrying old product assertions",field=>{
    const values={source_text:"仅提取背景和柔光，不复刻产品",keep_text:"只保留暖灰色调",intent:"inspiration",template_id:"lighting"};
    const changed={...workspace,[field]:values[field]} as StudioWorkspace;
    const input=buildStudioPrompt("reference.rewrite",changed,version);
    expect(JSON.parse(input.text).current).toBeNull();
    expect(input.text).not.toContain("旧产品外观");
  });
  it("rebuilds when a reference role changes even if the image bytes are the same",()=>{
    const changed={...workspace,reference_images:[{path:workspace.reference_path!,role:"scene" as const,note:"仅背景风格"}]};
    expect(JSON.parse(buildStudioPrompt("reference.rewrite",changed,version).text).current).toBeNull();
  });
  it("retains a same-input baseline for a targeted suggestion, while evaluating an old version against a new goal",()=>{
    expect(JSON.parse(buildStudioPrompt("reference.rewrite",workspace,version,"调整光线").text).current).toEqual(version.bundle);
    const changed={...workspace,source_text:"只要场景风格，不保留产品"};
    const input=buildStudioPrompt("prompt.evaluate",changed,version);
    expect(JSON.parse(input.text).current).toEqual(version.bundle);
    expect(input.system).toContain("风格任务不能因未复刻主体结构或未指定镜头参数而扣分");
  });
  it("keeps explicit product locks visible as data and requires conflict diagnosis instead of silently discarding them",()=>{
    const changed={...workspace,keep_text:"保持图1产品的外观、标牌和配件布局"};
    for(const action of ["prompt.polish","prompt.inspect","reference.extract"] as const){
      const input=buildStudioPrompt(action,changed,null);
      expect(JSON.parse(input.text).keep).toBe(changed.keep_text);
      expect(input.system).toContain("不能静默丢弃");
      expect(input.system).toContain("明确指出冲突来源");
    }
  });
  it("keeps replication and inspiration distinct and does not turn a text style task into a photo task",()=>{
    expect(buildStudioPrompt("reference.extract",{...workspace,intent:"replicate"},null).system).toContain("当前为复刻与受控重构");
    expect(buildStudioPrompt("reference.extract",{...workspace,intent:"inspiration"},null).system).toContain("当前为灵感拓展");
    const text=buildStudioPrompt("text.optimize",{...workspace,mode:"text",reference_path:null,template_id:"general"},null);
    expect(text.system).toContain("当前为文字风格学习");
    expect(text.system).not.toContain("当前为风格学习，不默认复刻整张图");
  });
});
