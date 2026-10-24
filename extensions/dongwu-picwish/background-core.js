export const APP_ORIGIN="https://hibrew-prompt-studio.pages.dev";
export const PICWISH_URL="https://picwish.cn/ai-design-create";
const idPattern=/^[a-f0-9-]{36}$/i;
export function appSender(sender) {
  try {const u=new URL(sender.url);return sender.frameId===0&&Number.isInteger(sender.tab?.id)&&u.origin===APP_ORIGIN&&u.pathname==="/";}catch{return false;}
}
export function imageManifest(body) {
  if(!body||!idPattern.test(body.transferId)||typeof body.prompt!=="string"||!body.prompt.trim()||body.prompt.length>60000||!Array.isArray(body.files)||body.files.length>5)throw new Error("传送资料无效。");
  for(const f of body.files)if(!f||typeof f.name!=="string"||f.name.length>240||!Number.isInteger(f.size)||f.size<1||f.size>10*1024*1024||!["image/png","image/jpeg"].includes(f.type)||!/^[a-f0-9]{64}$/.test(f.sha256))throw new Error("参考图格式或大小不符合要求。");
  return {transferId:body.transferId,prompt:body.prompt,files:body.files.map(f=>({name:f.name,size:f.size,type:f.type,sha256:f.sha256}))};
}
export function createController(api,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
  let active=null,opening=null;
  async function meta(){return (await api.storage.session.get("assistant")).assistant;}
  const isPicwish=url=>{try{const u=new URL(url);return u.origin==="https://picwish.cn"&&u.pathname==="/ai-design-create";}catch{return false;}};
  async function assistantSender(sender) {const m=await meta();return sender.frameId===0&&m?.tabId===sender.tab?.id&&m?.windowId===sender.tab?.windowId&&isPicwish(sender.url);}
  async function ensureWindow(senderTab) {
    if(opening)return opening;
    opening=(async()=>{
      const saved=await meta();
      if(saved)try{const tab=await api.tabs.get(saved.tabId);if(tab.windowId===saved.windowId&&(!tab.url||isPicwish(tab.url))){
        const win=await api.windows.get(saved.windowId);await api.windows.update(saved.windowId,{focused:true,...(win.state==="minimized"?{state:"normal"}: {})});return saved;
      }}catch{}
      const base=senderTab?await api.windows.get(senderTab.windowId):await api.windows.getLastFocused();
      const width=Math.min(760,Math.max(480,Math.round((base.width||1200)*.56)));
      const bounds={left:Math.max(0,(base.left||0)+(base.width||1200)-width),top:base.top||0,width,height:Math.max(540,base.height||800)};
      const win=await api.windows.create({url:PICWISH_URL,type:"popup",focused:true,...bounds});
      const tab=win.tabs?.[0];if(!win.id||!tab?.id)throw new Error("未能打开佐糖窗口。");
      const result={windowId:win.id,tabId:tab.id,bounds};await api.storage.session.set({assistant:result});return result;
    })();
    try{return await opening;}finally{opening=null;}
  }
  async function ready(tabId){
    for(let i=0;i<35;i++){try{const r=await api.tabs.sendMessage(tabId,{dw:"ping"});if(r?.ok)return;}catch{}await wait(400);}
    throw new Error("佐糖窗口尚未就绪，请先登录佐糖或恢复原站界面。");
  }
  async function handle(message,sender) {
    const {command,body={}}=message||{};
    if(command==="assistant.ready")return {ok:await assistantSender(sender)};
    if(command==="window.minimize"||command==="window.fullscreen"){
      if(!await assistantSender(sender))throw new Error("窗口未授权。");const m=await meta();
      if(command==="window.minimize")await api.windows.update(m.windowId,{state:"minimized"});
      else {const win=await api.windows.get(m.windowId);await api.windows.update(m.windowId,win.state==="fullscreen"?{state:"normal",...m.bounds}:{state:"fullscreen"});}
      return {ok:true};
    }
    if(!appSender(sender))throw new Error("只接受 DONGWU 工作室发起的操作。");
    if(command==="probe")return {ok:true,version:"0.1.0"};
    if(command==="open"){await ensureWindow(sender.tab);return {ok:true};}
    if(command==="prepare"){
      const safe=imageManifest(body);
      if(active&&Date.now()-active.time<180000)throw new Error("另一份资料正在传送，请稍后再试。");
      const reservation={id:safe.transferId,owner:sender.tab.id,time:Date.now(),tabId:null};active=reservation;
      try{const m=await ensureWindow(sender.tab);reservation.tabId=m.tabId;await ready(m.tabId);
        const result=await api.tabs.sendMessage(m.tabId,{dw:"prepare",body:safe});
        if(!result?.ok)throw new Error(result?.error||"佐糖没有接收本次资料。");return result;
      }catch(e){if(active===reservation)active=null;throw e;}
    }
    if(!["chunk","commit","cancel"].includes(command)||!active||active.owner!==sender.tab.id||active.id!==body.transferId||Date.now()-active.time>180000)throw new Error("传送已失效，请从 DONGWU 重新发送。");
    const transfer=active;transfer.time=Date.now();
    if(command==="chunk"&&(typeof body.data!=="string"||body.data.length>262144||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)||!Number.isInteger(body.offset)||!Number.isInteger(body.fileIndex)))throw new Error("图片分块数据无效。");
    try{return await api.tabs.sendMessage(transfer.tabId,{dw:command,body});}
    finally{if(command!=="chunk"&&active===transfer)active=null;}
  }
  return {handle,ensureWindow};
}
