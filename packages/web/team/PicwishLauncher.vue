<script setup lang="ts">
import {ref,computed,onBeforeUnmount} from "vue";
import StudioIcon from "./StudioIcon.vue";
import {composePicwishPrompt,createPicwishClient,PICWISH_URL} from "./picwish";
import type {ReferenceImage} from "../../../supabase/functions/_shared/studio-contract";
const props=defineProps<{busy:boolean;resultPrompt:string;sourcePrompt:string;keepText:string;images:ReferenceImage[];resolveFiles:(images:ReferenceImage[])=>Promise<File[]>}>();
const client=createPicwishClient(),open=ref(false),connected=ref(false),working=ref(false),error=ref(""),receipt=ref(""),choice=ref("result");
let disposed=false;
const action=ref("");
const prompt=computed(()=>choice.value==="result"&&props.resultPrompt.trim()?props.resultPrompt:props.sourcePrompt);
async function check(){working.value=true;action.value="check";error.value="";try{connected.value=(await client.request("probe",{},1200)).ok;}finally{working.value=false;action.value="";}}
async function toggle(){open.value=!open.value;if(open.value){choice.value=props.resultPrompt.trim()?"result":"source";await check();}}
async function openWindow(){working.value=true;action.value="window";error.value="";try{const r=await client.request("open");if(!r.ok)throw new Error(r.error);}catch(e){error.value=e instanceof Error?e.message:"窗口未能打开。";}finally{working.value=false;action.value="";}}
async function send(){
  if(working.value||props.busy)return;
  working.value=true;action.value="send";error.value="";receipt.value="";
  try{
    const images=props.images.map(image=>({...image}));
    const text=composePicwishPrompt(prompt.value,props.keepText,images.length),files=await props.resolveFiles(images);
    if(disposed)return;
    const result=await client.send(text,files);
    receipt.value=`已填入提示词${result.count?"和 "+result.count+" 张参考图":""}，请到佐糖核对并点击生成。`;
  }catch(e){if(!disposed)error.value=e instanceof Error?e.message:"传送未完成，请检查佐糖窗口。";}
  finally{working.value=false;action.value="";}
}
onBeforeUnmount(()=>{disposed=true;client.destroy();});
</script>
<template>
  <aside class="picwish-launcher" aria-label="佐糖生图助手">
    <button class="picwish-fab" :class="{'run-pending':working&&action==='check'}" :aria-expanded="open" aria-controls="picwish-panel" :disabled="busy||working" @click="toggle"><StudioIcon name="spark"/><span>佐糖生图</span></button>
    <section v-if="open" id="picwish-panel" class="picwish-panel" role="dialog" aria-label="发送到佐糖">
      <div class="picwish-panel-head"><div><small>CREATIVE COMPANION</small><h2>在佐糖，继续创作</h2></div><button aria-label="关闭佐糖面板" :disabled="working" @click="open=false">×</button></div>
      <p class="picwish-connection" :class="{connected}"><i></i>{{connected?'浏览器助手已连接':'当前浏览器尚未连接助手'}}</p>
      <template v-if="connected">
        <label class="compact-label">发送哪份提示词<select v-model="choice" :disabled="working"><option v-if="resultPrompt.trim()" value="result">当前中文成果 / 编辑内容</option><option value="source">原始需求</option></select></label>
        <div class="picwish-prompt-preview">{{prompt.trim()||'先填写提示词，或生成一份满意的成果。'}}</div>
        <p class="picwish-file-count"><StudioIcon name="image"/>全部 {{images.length}} 张参考图 · 保持图号顺序</p>
        <p class="hint">本次上传使用原文件；历史参考图使用当时保存的版本。图片仅在本次传送中暂存。</p>
        <p v-if="error" class="picwish-error" role="alert">{{error}}</p><p v-if="receipt" class="picwish-receipt" role="status">{{receipt}}</p>
        <div class="picwish-actions"><button :class="{'run-pending':working&&action==='send'}" :disabled="working||busy||!prompt.trim()" class="primary" @click="send">发送到佐糖<StudioIcon name="arrow"/></button><button :class="{'run-pending':working&&action==='window'}" :disabled="working" @click="openWindow">打开 / 展开窗口</button></div>
        <small class="hint">助手只填入资料。模型、比例、分辨率和生成由你在佐糖确认；大图与下载留在佐糖。</small>
      </template>
      <template v-else>
        <p>每位成员在自己的 Edge / Chrome 安装一次，刷新网站后即可连接。</p>
        <a class="picwish-download" href="/downloads/dongwu-picwish-0.1.0.zip" download>下载浏览器助手 · 0.1.0 <StudioIcon name="arrow"/></a>
        <ol class="picwish-install"><li>解压到固定文件夹。</li><li>打开 <code>edge://extensions</code> 或 <code>chrome://extensions</code>，开启开发者模式。</li><li>选择“加载解压缩的扩展”，选中包含 manifest.json 的文件夹。</li><li>确认两个网站权限，刷新 DONGWU。</li></ol>
        <p class="hint">仅连接 DONGWU 与佐糖设计页，不读取密码或 API Key。内部试用版，升级时需替换文件并重新加载。</p>
        <div class="picwish-actions"><button :class="{'run-pending':working}" :disabled="working" @click="check">重新检查连接</button><a :href="PICWISH_URL" target="_blank" rel="noopener noreferrer">打开佐糖网页</a></div>
      </template>
    </section>
  </aside>
</template>
