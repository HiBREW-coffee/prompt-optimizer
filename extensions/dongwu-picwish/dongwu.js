(() => {
  if(location.origin!=="https://hibrew-prompt-studio.pages.dev"||location.pathname!=="/")return;
  const channel="DONGWU_PICWISH_V1",commands=new Set(["probe","open","prepare","chunk","commit","cancel"]);
  let running=false;
  window.addEventListener("message",async event=>{
    const m=event.data;
    if(event.source!==window||event.origin!==location.origin||m?.channel!==channel||m.direction!=="to-extension"||typeof m.id!=="string"||m.id.length>60||!commands.has(m.command))return;
    const respond=result=>window.postMessage({channel,direction:"to-page",id:m.id,result},location.origin);
    if(running&&m.command!=="cancel"&&m.command!=="probe"){respond({ok:false,error:"助手正在接收上一项操作，请稍后再试。"});return;}
    running=true;
    try {respond(await chrome.runtime.sendMessage({command:m.command,body:m.body}));}
    catch {respond({ok:false,error:"助手连接已失效，请刷新 DONGWU 后重试。"});}
    finally{running=false;}
  });
})();
