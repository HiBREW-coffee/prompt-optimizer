export const PICWISH_CHANNEL = "DONGWU_PICWISH_V1";
export const PICWISH_URL = "https://picwish.cn/ai-design-create";
export const PICWISH_CHUNK = 192 * 1024;
export type PicwishCommand = "probe" | "open" | "prepare" | "chunk" | "commit" | "cancel";
export type PicwishReply = { ok: boolean; error?: string; version?: string; count?: number };
export type PicwishFile = { name: string; type: string; size: number; sha256: string };
export function composePicwishPrompt(prompt: string, keep: string, count: number) {
  const text = prompt.trim();
  if (!text) throw new Error("请先填写提示词或生成一份成果。");
  return [text, keep.trim() ? "需要保留：" + keep.trim() : "",
    count ? "参考图按附图顺序编号为" + Array.from({length:count},(_,i)=>"图"+(i+1)).join("、") + "，请保持图号与用途对应。" : ""].filter(Boolean).join("\n\n");
}
export function createPicwishClient(target: Window = window) {
  const pending = new Map<string, {resolve:(value:PicwishReply)=>void;timer:ReturnType<typeof setTimeout>}>();
  const listener = (event: MessageEvent) => {
    if (event.source !== target || event.origin !== target.location.origin || event.data?.channel !== PICWISH_CHANNEL || event.data?.direction !== "to-page") return;
    const item = pending.get(event.data.id);
    if (!item) return;
    clearTimeout(item.timer);pending.delete(event.data.id);
    const value = event.data.result;
    item.resolve(value && typeof value.ok === "boolean" ? value : {ok:false,error:"助手响应异常，请更新扩展。"});
  };
  target.addEventListener("message",listener);
  function request(command:PicwishCommand,body:Record<string,unknown>={},timeout=30000):Promise<PicwishReply> {
    const id=crypto.randomUUID();
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{pending.delete(id);resolve({ok:false,error:command==="probe"?"未连接浏览器助手":"助手没有及时确认。请先检查佐糖窗口，避免重复导入。"});},timeout);
      pending.set(id,{resolve,timer});
      target.postMessage({channel:PICWISH_CHANNEL,direction:"to-extension",id,command,body},target.location.origin);
    });
  }
  async function send(prompt:string, files:File[]) {
    if(!prompt.trim()||prompt.length>60000||files.length>5||files.some(f=>!f.size||f.size>10*1024*1024||!["image/png","image/jpeg"].includes(f.type))) throw new Error("提示词或参考图不符合传送要求。");
    const transferId=crypto.randomUUID(), metadata:PicwishFile[]=[];
    for(const f of files) metadata.push({name:f.name,type:f.type,size:f.size,sha256:Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await f.arrayBuffer())),b=>b.toString(16).padStart(2,"0")).join("")});
    const checked = async(command:PicwishCommand,body:Record<string,unknown>)=>{const result=await request(command,{transferId,...body},command==="commit"?90000:30000);if(!result.ok)throw new Error(result.error||"佐糖导入未完成。");return result;};
    try {
      await checked("prepare",{prompt,files:metadata});
      for(const [fileIndex,file] of files.entries()) {
        for(let offset=0;offset<file.size;offset+=PICWISH_CHUNK) {
          const bytes=new Uint8Array(await file.slice(offset,offset+PICWISH_CHUNK).arrayBuffer());let binary="";
          for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
          await checked("chunk",{fileIndex,offset,data:btoa(binary)});
        }
      }
      const result=await checked("commit",{});
      if(result.count!==files.length)throw new Error("助手未确认全部参考图数量，请核对佐糖窗口。");
      return result;
    } catch(error) { void request("cancel",{transferId},1000);throw error; }
  }
  return {request,send,destroy(){target.removeEventListener("message",listener);for(const p of pending.values()){clearTimeout(p.timer);p.resolve({ok:false,error:"页面已关闭。"});}pending.clear();}};
}
