import {createController} from "./background-core.js";
const controller=createController(chrome);
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  controller.handle(message,sender).then(reply,error=>reply({ok:false,error:typeof error?.message==="string"&&/^[\u4e00-\u9fff]/.test(error.message)&&error.message.length<150?error.message:"助手操作未完成。请检查佐糖窗口、当前草稿和图片数量后重试。"}));
  return true;
});
chrome.action.onClicked.addListener(()=>{void controller.ensureWindow().catch(()=>{});});
