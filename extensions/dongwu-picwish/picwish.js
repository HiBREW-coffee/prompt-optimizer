(() => {
  if(location.origin!=="https://picwish.cn"||location.pathname!=="/ai-design-create")return;
  let enabled=false,compact=true,observer=null;
  const adapter=globalThis.DongwuPicwishAdapter.create(document);
  function skin(){
    if(!enabled)return;
    document.documentElement.dataset.dwCompact=String(compact);
    const editor=document.getElementById("ai-chat-content-container"),scroll=editor?.closest(".chat-scroll"),main=scroll?.parentElement,layout=main?.parentElement,root=layout?.parentElement;
    if(!editor||!scroll||!main||!layout||!root)return;
    main.setAttribute("data-dw-main","");scroll.setAttribute("data-dw-scroll","");root.setAttribute("data-dw-root","");
    if(root.parentElement?.classList.contains("fixed"))root.parentElement.setAttribute("data-dw-frame","");
    for(const sibling of layout.children)if(sibling!==main&&/历史对话/.test(sibling.textContent||""))sibling.setAttribute("data-dw-hidden","");
    for(const sibling of root.children)if(sibling!==layout&&/联系我们|AI图片工具/.test(sibling.textContent||""))sibling.setAttribute("data-dw-hidden","");
  }
  function toolbar(){
    const bar=document.createElement("div");bar.id="dongwu-picwish-toolbar";
    const brand=document.createElement("strong");brand.textContent="@DONGWU";
    const title=document.createElement("span");title.textContent="佐糖创作";
    const actions=document.createElement("div");
    const action=(text,handler)=>{const b=document.createElement("button");b.type="button";b.textContent=text;b.addEventListener("click",handler);actions.append(b);return b;};
    const mode=action("原站界面",()=>{compact=!compact;mode.textContent=compact?"原站界面":"精简界面";skin();});
    action("全屏 / 还原",()=>void chrome.runtime.sendMessage({command:"window.fullscreen"}));
    action("收起",()=>void chrome.runtime.sendMessage({command:"window.minimize"}));
    bar.append(brand,title,actions);document.body.append(bar);
    const note=document.createElement("div");note.id="dongwu-picwish-receipt";note.setAttribute("role","status");document.body.append(note);
    skin();let scheduled=false;
    observer=new MutationObserver(()=>{if(!scheduled){scheduled=true;setTimeout(()=>{scheduled=false;skin();},120);}});
    observer.observe(document.body,{childList:true,subtree:true});
  }
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(sender.id!==chrome.runtime.id||!enabled||!["ping","prepare","chunk","commit","cancel"].includes(message?.dw))return;
    const note=document.getElementById("dongwu-picwish-receipt");
    if(message.dw==="ping"){reply({ok:adapter.ready()});return;}
    Promise.resolve().then(()=>adapter[message.dw](message.body)).then(result=>{
      if(message.dw==="commit"&&note)note.textContent=result.count?`已导入提示词与 ${result.count} 张参考图，请核对后在佐糖点击生成。`:"提示词已填好，请确认模型和尺寸后生成。";
      reply(result);
    },error=>{const text=error?.message||"资料导入未完成，请核对佐糖编辑区。";if(note)note.textContent=text;reply({ok:false,error:text});});
    return true;
  });
  async function connect(){
    for(let i=0;i<10;i++){
      try{const result=await chrome.runtime.sendMessage({command:"assistant.ready"});if(result?.ok){enabled=true;toolbar();return;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,400));
    }
  }
  void connect();
  window.addEventListener("pagehide",()=>{enabled=false;observer?.disconnect();adapter.dispose();},{once:true});
})();
