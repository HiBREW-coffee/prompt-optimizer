(() => {
  const fail=message=>{throw new Error(message);};
  const create=(doc,env={})=>{
    let transfer=null;
    const editor=()=>doc.querySelector('#ai-chat-content-container textarea');
    const pictures=()=>Array.from(doc.querySelectorAll('#ai-chat-content-container img[alt="图片"]'));
    const delay=env.delay||(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
    function prepare(body){
      if(transfer&&Date.now()-transfer.time<180000)fail("上一份资料尚未导入完成。");
      if(!editor())fail("请先登录佐糖，并切换到图片创作页面。");
      if(editor().value.trim()||pictures().length)fail("佐糖已有未发送的草稿。请先处理或清空它，助手不会覆盖。");
      if(typeof body.prompt!=="string"||!body.prompt.trim()||body.prompt.length>60000||!Array.isArray(body.files)||body.files.length>5)fail("资料无效。");
      for(const f of body.files)if(!Number.isInteger(f.size)||f.size<1||f.size>10485760||!["image/png","image/jpeg"].includes(f.type)||!/^[a-f0-9]{64}$/.test(f.sha256))fail("图片资料无效。");
      transfer={...body,time:Date.now(),chunks:body.files.map(()=>[]),received:body.files.map(()=>0)};return {ok:true};
    }
    function chunk(body){
      if(!transfer||body.transferId!==transfer.transferId||Date.now()-transfer.time>180000)fail("传送已过期。");
      const f=transfer.files[body.fileIndex];if(!f||body.offset!==transfer.received[body.fileIndex]||typeof body.data!=="string"||body.data.length>262144||body.data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.data))fail("图片分块顺序或内容无效。");
      const raw=atob(body.data),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(!bytes.length||transfer.received[body.fileIndex]+bytes.length>f.size)fail("图片大小不一致。");
      transfer.chunks[body.fileIndex].push(bytes);transfer.received[body.fileIndex]+=bytes.length;transfer.time=Date.now();return {ok:true};
    }
    async function commit(body){
      const t=transfer;if(!t||t.transferId!==body.transferId||Date.now()-t.time>180000)fail("传送已失效。");
      try {
        const el=editor();if(!el||el.value.trim()||pictures().length)fail("佐糖草稿已变化，未覆盖现有内容。");
        const files=[];
        for(const [i,f]of t.files.entries()){
          if(t.received[i]!==f.size)fail("图片未完整收到。");
          const file=new File(t.chunks[i],f.name,{type:f.type});
          const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer())),b=>b.toString(16).padStart(2,"0")).join("");
          if(hash!==f.sha256)fail("图片校验失败，未导入。");files.push(file);
        }
        if(files.length){
          const data=new DataTransfer();for(const file of files)data.items.add(file);
          el.focus();el.dispatchEvent(new ClipboardEvent("paste",{clipboardData:data,bubbles:true,cancelable:true}));
          let confirmed=false;
          for(let i=0;i<100;i++){
            await delay(500);if(t.cancelled)fail("传送已取消，请核对佐糖编辑区。");const loaded=pictures();
            if(loaded.length===files.length){
              if(loaded.some(img=>img.parentElement?.parentElement?.classList.contains("opacity-50")))fail("当前佐糖模型不接受全部参考图，请调整模型或图片数量。");
              confirmed=true;break;
            }
          }
          if(!confirmed)fail("未能确认全部参考图导入，请在佐糖核对图片；未自动点击生成。");
        }
        if(editor()!==el||!el.isConnected||el.value.trim())fail("佐糖草稿已变化，未覆盖现有内容。");
        const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set;
        if(!setter)fail("编辑器不兼容，请恢复原站界面。");setter.call(el,t.prompt);el.dispatchEvent(new Event("input",{bubbles:true}));
        return {ok:true,count:files.length};
      } finally {transfer=null;}
    }
    return {prepare,chunk,commit,cancel(body){if(transfer?.transferId===body.transferId){transfer.cancelled=true;transfer=null;}return {ok:true};},dispose(){if(transfer)transfer.cancelled=true;transfer=null;},ready:()=>Boolean(editor())};
  };
  globalThis.DongwuPicwishAdapter={create};
})();
