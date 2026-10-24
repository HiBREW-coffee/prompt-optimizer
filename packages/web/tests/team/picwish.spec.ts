import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {resolve} from "node:path";
import {File as NodeFile} from "node:buffer";
import {webcrypto} from "node:crypto";
import {describe,it,expect,vi,afterEach} from "vitest";
import {mount,flushPromises} from "@vue/test-utils";
import {createController,APP_ORIGIN,PICWISH_URL} from "../../../../extensions/dongwu-picwish/background-core.js";
import {createPicwishClient,composePicwishPrompt,PICWISH_CHANNEL,PICWISH_CHUNK} from "../../team/picwish";
import PicwishLauncher from "../../team/PicwishLauncher.vue";
const extensionFile=(name:string)=>resolve(process.cwd(),"../../extensions/dongwu-picwish",name);
const source=readFileSync(extensionFile("adapter.js"),"utf8");
const transferId="11111111-1111-4111-8111-111111111111";
const owner={url:APP_ORIGIN+"/",frameId:0,tab:{id:1,windowId:7}};
const digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await webcrypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
async function picture(index:number){const bytes=new Uint8Array([137,80,78,71,13,10,26,10,index]);return {meta:{name:`图${index}.png`,type:"image/png",size:bytes.length,sha256:await digest(bytes)},data:btoa(String.fromCharCode(...bytes)),bytes};}
function background(){
  let stored:any={};
  const api={storage:{session:{get:vi.fn(async()=>stored),set:vi.fn(async(value:any)=>{stored={...stored,...value};})}},
    windows:{get:vi.fn(async()=>({id:7,left:10,top:20,width:1400,height:900,state:"normal"})),getLastFocused:vi.fn(async()=>({id:7,width:1400,height:900})),create:vi.fn(async(options:any)=>({id:8,tabs:[{id:9,windowId:8,url:options.url}]})),update:vi.fn(async()=>({}))},
    tabs:{get:vi.fn(async()=>({id:9,windowId:8,url:PICWISH_URL})),sendMessage:vi.fn(async()=>({ok:true}))}};
  return {api,controller:createController(api,async()=>{}),getStored:()=>stored};
}
function adapter(){
  document.body.innerHTML='<div id="ai-chat-content-container"><textarea></textarea><div id="reference-images"></div><button id="generate">生成</button></div>';
  class Transfer {files:File[]=[];items={add:(file:File)=>{this.files.push(file);}};}
  class Paste extends Event {clipboardData:any;constructor(type:string,options:any){super(type,options);this.clipboardData=options.clipboardData;}}
  const globals:any={};
  runInNewContext(source,{globalThis:globals,document,File:NodeFile,crypto:webcrypto,DataTransfer:Transfer,ClipboardEvent:Paste,HTMLTextAreaElement,Event,Uint8Array,atob,Date,setTimeout});
  const instance=globals.DongwuPicwishAdapter.create(document,{delay:async()=>{}});
  return {instance,editor:document.querySelector("textarea")!,generate:vi.fn(),onPaste(callback:(event:any)=>void){document.addEventListener("paste",callback,{once:true});}};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();document.body.innerHTML="";delete document.documentElement.dataset.dwCompact;});
describe("browser-only PicWish companion boundaries",()=>{
  it("accepts only the exact DONGWU top-level origin before opening a window",async()=>{
    const h=background();
    for(const bad of [{...owner,url:"https://evil.example/"},{...owner,frameId:1},{...owner,url:APP_ORIGIN+"/other"}])await expect(h.controller.handle({command:"open"},bad)).rejects.toThrow();
    expect(h.api.windows.create).not.toHaveBeenCalled();
    await h.controller.handle({command:"open"},owner);
    expect(h.api.windows.create).toHaveBeenCalledWith(expect.objectContaining({type:"popup",url:PICWISH_URL}));
  });
  it("reuses only its own window and stores window metadata without prompts or image data",async()=>{
    const h=background();await h.controller.handle({command:"open"},owner);await h.controller.handle({command:"open"},owner);
    expect(h.api.windows.create).toHaveBeenCalledTimes(1);
    expect(Object.keys(h.getStored().assistant).sort()).toEqual(["bounds","tabId","windowId"]);
    const p=await picture(1);await h.controller.handle({command:"prepare",body:{transferId,prompt:"私人需求",files:[p.meta]}},owner);
    expect(JSON.stringify(h.getStored())).not.toContain("私人需求");expect(JSON.stringify(h.getStored())).not.toContain(p.data);
    await expect(h.controller.handle({command:"chunk",body:{transferId,fileIndex:0,offset:0,data:p.data}},{...owner,tab:{id:2,windowId:7}})).rejects.toThrow();
  });
  it("rejects over-five and oversized files, and permits controls only from its own PicWish window",async()=>{
    const h=background(),p=await picture(1);
    await expect(h.controller.handle({command:"prepare",body:{transferId,prompt:"test",files:Array(6).fill(p.meta)}},owner)).rejects.toThrow();
    await expect(h.controller.handle({command:"prepare",body:{transferId,prompt:"test",files:[{...p.meta,size:10485761}]}},owner)).rejects.toThrow();
    await h.controller.handle({command:"open"},owner);
    await expect(h.controller.handle({command:"window.minimize"},owner)).rejects.toThrow();
    const assistant={url:PICWISH_URL,frameId:0,tab:{id:9,windowId:8}};
    await h.controller.handle({command:"window.minimize"},assistant);
    expect(h.api.windows.update).toHaveBeenCalledWith(8,{state:"minimized"});
    await h.controller.handle({command:"window.fullscreen"},assistant);
    expect(h.api.windows.update).toHaveBeenCalledWith(8,{state:"fullscreen"});
  });
  it("fills the brief only after all five original files arrive intact and in order, without generating",async()=>{
    const h=adapter(),images=await Promise.all([1,2,3,4,5].map(picture));const submitted=vi.fn();document.querySelector("#generate")!.addEventListener("click",submitted);
    let received:NodeFile[]=[];
    h.onPaste(event=>{received=event.clipboardData.files;for(const _file of received){const img=document.createElement("img");img.alt="图片";document.querySelector("#reference-images")!.append(img);}});
    h.instance.prepare({transferId,prompt:"图1产品借用图2场景，保留所有图号",files:images.map(p=>p.meta)});
    for(const [i,p]of images.entries())h.instance.chunk({transferId,fileIndex:i,offset:0,data:p.data});
    expect(await h.instance.commit({transferId})).toEqual({ok:true,count:5});
    expect(received.map(f=>f.name)).toEqual(images.map(p=>p.meta.name));
    for(const [i,file]of received.entries())expect(new Uint8Array(await file.arrayBuffer())).toEqual(images[i].bytes);
    expect(h.editor.value).toContain("图1产品借用图2场景");expect(submitted).not.toHaveBeenCalled();
  });
  it("does not overwrite an existing draft and rejects missing or corrupt file chunks",async()=>{
    const h=adapter(),p=await picture(1);h.editor.value="佐糖未发送草稿";
    expect(()=>h.instance.prepare({transferId,prompt:"new",files:[]})).toThrow("不会覆盖");expect(h.editor.value).toBe("佐糖未发送草稿");h.editor.value="";
    h.instance.prepare({transferId,prompt:"new",files:[p.meta]});
    await expect(h.instance.commit({transferId})).rejects.toThrow("未完整");expect(h.editor.value).toBe("");
    h.instance.prepare({transferId,prompt:"new",files:[p.meta]});
    expect(()=>h.instance.chunk({transferId,fileIndex:0,offset:1,data:p.data})).toThrow("顺序");
    h.instance.chunk({transferId,fileIndex:0,offset:0,data:btoa("wrongsize")});
    await expect(h.instance.commit({transferId})).rejects.toThrow("校验失败");expect(h.editor.value).toBe("");
  });
  it("reports unconfirmed image imports instead of silently sending only text",async()=>{
    const h=adapter(),p=await picture(1);
    h.instance.prepare({transferId,prompt:"must see image",files:[p.meta]});h.instance.chunk({transferId,fileIndex:0,offset:0,data:p.data});
    await expect(h.instance.commit({transferId})).rejects.toThrow("未能确认全部");expect(h.editor.value).toBe("");
  });
  it("preserves a user edit made while the original images are uploading",async()=>{
    const h=adapter(),p=await picture(1);
    h.onPaste(()=>{h.editor.value="用户刚写的新要求";const img=document.createElement("img");img.alt="图片";document.querySelector("#reference-images")!.append(img);});
    h.instance.prepare({transferId,prompt:"不要覆盖",files:[p.meta]});h.instance.chunk({transferId,fileIndex:0,offset:0,data:p.data});
    await expect(h.instance.commit({transferId})).rejects.toThrow("草稿已变化");expect(h.editor.value).toBe("用户刚写的新要求");
  });
  it("ignores spoofed page replies and sends large originals as bounded sequential chunks",async()=>{
    vi.stubGlobal("crypto",webcrypto);
    const client=createPicwishClient();let last:any;const calls:any[]=[];
    const posted=vi.spyOn(window,"postMessage").mockImplementation((m:any)=>{last=m;});
    let settled=false;const probe=client.request("probe",{},1000).then(r=>{settled=true;return r;});
    window.dispatchEvent(new MessageEvent("message",{source:window,origin:"https://evil.example",data:{...last,direction:"to-page",result:{ok:true}}}));
    window.dispatchEvent(new MessageEvent("message",{source:window,origin:location.origin,data:{...last,id:"wrong",direction:"to-page",result:{ok:true}}}));
    await Promise.resolve();expect(settled).toBe(false);
    window.dispatchEvent(new MessageEvent("message",{source:window,origin:location.origin,data:{...last,direction:"to-page",result:{ok:true}}}));await probe;
    posted.mockImplementation((m:any)=>{calls.push(m);window.dispatchEvent(new MessageEvent("message",{source:window,origin:location.origin,data:{...m,direction:"to-page",result:{ok:true,count:1}}}));});
    const bytes=Uint8Array.from({length:PICWISH_CHUNK+7},(_,i)=>i%255);
    await client.send("brief",[new NodeFile([bytes],"large.png",{type:"image/png"})] as unknown as File[]);
    const chunks=calls.filter(m=>m.command==="chunk");expect(chunks.map(m=>m.body.offset)).toEqual([0,PICWISH_CHUNK]);
    const reconstructed=chunks.map(m=>atob(m.body.data)).join("");expect(Uint8Array.from(reconstructed,c=>c.charCodeAt(0))).toEqual(bytes);client.destroy();
  });
  it("does not modify normal PicWish tabs and applies the compact shell only after window attestation",async()=>{
    const code=readFileSync(extensionFile("picwish.js"),"utf8");
    const execute=(authorized:boolean)=>runInNewContext(code,{document,window,location:{origin:"https://picwish.cn",pathname:"/ai-design-create"},MutationObserver,globalThis:{DongwuPicwishAdapter:{create:()=>({ready:()=>true,dispose:vi.fn()})}},chrome:{runtime:{id:"test-helper",onMessage:{addListener:vi.fn()},sendMessage:vi.fn().mockResolvedValue({ok:authorized})}},setTimeout:(fn:any)=>{fn();return 0;},Promise});
    execute(false);await flushPromises();expect(document.querySelector("#dongwu-picwish-toolbar")).toBeNull();
    document.body.innerHTML='<div class="fixed"><div id="root"><div id="provider-nav">联系我们 AI图片工具</div><div><aside>历史对话</aside><main><div class="chat-scroll"><div id="ai-chat-content"><div><div><div id="ai-chat-content-container"><textarea></textarea></div></div></div></div></div></main></div></div></div>';
    execute(true);await flushPromises();
    expect(document.querySelector("#dongwu-picwish-toolbar")?.textContent).toContain("佐糖创作");
    expect(document.querySelector("#provider-nav")?.hasAttribute("data-dw-hidden")).toBe(true);
    expect(document.querySelector("aside")?.hasAttribute("data-dw-hidden")).toBe(true);
    expect(document.documentElement.dataset.dwCompact).toBe("true");window.dispatchEvent(new Event("pagehide"));
  });
  it("preserves original bytes in client chunks and matches replies to their origin and request IDs",async()=>{
    vi.stubGlobal("crypto",webcrypto);
    const client=createPicwishClient(),calls:any[]=[];
    vi.spyOn(window,"postMessage").mockImplementation((message:any)=>{
      calls.push(message);
      window.dispatchEvent(new MessageEvent("message",{source:window,origin:location.origin,data:{...message,direction:"to-page",result:{ok:true,count:2}}}));
    });
    const originals=[new NodeFile([new Uint8Array([1,2,3,4])],"first.png",{type:"image/png"}),new NodeFile([new Uint8Array([8,7,6])],"second.png",{type:"image/png"})];
    expect(await client.send("brief",originals as unknown as File[])).toMatchObject({count:2});
    const chunks=calls.filter(m=>m.command==="chunk");expect(chunks.map(m=>m.body.fileIndex)).toEqual([0,1]);expect(chunks.map(m=>atob(m.body.data))).toEqual(["\x01\x02\x03\x04","\x08\x07\x06"]);
    client.destroy();
  });
  it("adds a floating launcher with installation help without changing the main workspace",async()=>{
    vi.useFakeTimers({toFake:["setTimeout","clearTimeout"]});
    const wrapper=mount(PicwishLauncher,{props:{busy:false,resultPrompt:"",sourcePrompt:"产品进入场景",keepText:"外观不变",images:[],resolveFiles:async()=>[]}});
    await wrapper.get(".picwish-fab").trigger("click");await vi.advanceTimersByTimeAsync(1201);await flushPromises();
    expect(wrapper.text()).toContain("每位成员在自己的 Edge / Chrome 安装一次");
    expect(wrapper.get("a[download]").attributes("href")).toBe("/downloads/dongwu-picwish-0.1.0.zip");
    expect(wrapper.find("iframe").exists()).toBe(false);wrapper.unmount();
  });
  it("keeps all explicit constraints and numbered image instructions in the outgoing brief",()=>{
    expect(composePicwishPrompt("图1产品放到图2场景","按键位置不变",5)).toContain("图1、图2、图3、图4、图5");
    expect(composePicwishPrompt("brief","keep",0)).toContain("需要保留：keep");expect(()=>composePicwishPrompt(" ","",0)).toThrow();
  });
  it("requests no cookies, debugger, broad host access, frame bypass or remote code",()=>{
    const manifest=JSON.parse(readFileSync(extensionFile("manifest.json"),"utf8"));
    expect(manifest.permissions).toEqual(["storage"]);expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.content_scripts.flatMap((x:any)=>x.matches)).toEqual([APP_ORIGIN+"/*",PICWISH_URL+"*"]);
    for(const file of ["background.js","background-core.js","adapter.js","picwish.js","dongwu.js"]){const text=readFileSync(extensionFile(file),"utf8");expect(text).not.toMatch(/chrome\.(cookies|debugger|declarativeNetRequest)|eval\(|new Function/);}
  });
});
