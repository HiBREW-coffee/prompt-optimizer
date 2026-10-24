import {readFile,writeFile,mkdir,copyFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
const root=new URL("../",import.meta.url),source=new URL("extensions/dongwu-picwish/",root);
const out=new URL("supabase/.temp/dongwu-picwish/",root),downloads=new URL("packages/web/team/public/downloads/",root);
await mkdir(out,{recursive:true});await mkdir(downloads,{recursive:true});
const names=["manifest.json","background.js","background-core.js","dongwu.js","adapter.js","picwish.js","skin.css","README.md"];
const entries=[];
for(const name of names){const data=await readFile(new URL(name,source));await writeFile(new URL(name,out),data);entries.push([name,data]);}
const icon=await readFile(new URL("packages/web/team/public/dongwu-avatar.png",root));await writeFile(new URL("icon.png",out),icon);entries.push(["icon.png",icon]);
const license=await readFile(new URL("LICENSE",root));await writeFile(new URL("LICENSE",out),license);entries.push(["LICENSE",license]);
// Deterministic stored ZIP, no binary helpers or downloaded dependencies.
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc=bytes=>{let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
const chunks=[],central=[];let offset=0;
for(const [path,data]of entries){
  const name=Buffer.from(path),sum=crc(data),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);header.writeUInt32LE(sum,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
  chunks.push(header,name,data);
  const item=Buffer.alloc(46);item.writeUInt32LE(0x02014b50);item.writeUInt16LE(20,4);item.writeUInt16LE(20,6);item.writeUInt16LE(0x800,8);item.writeUInt16LE(33,14);item.writeUInt32LE(sum,16);item.writeUInt32LE(data.length,20);item.writeUInt32LE(data.length,24);item.writeUInt16LE(name.length,28);item.writeUInt32LE(offset,42);central.push(item,name);offset+=header.length+name.length+data.length;
}
const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
await writeFile(new URL("dongwu-picwish-0.1.0.zip",downloads),Buffer.concat([...chunks,directory,end]));
console.log("PicWish helper packaged: "+fileURLToPath(out));
