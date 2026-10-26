// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const storage = vi.hoisted(()=>({upload:vi.fn()}));
vi.mock("@supabase/supabase-js",()=>({createClient:()=>({storage:{from:()=>storage}})}));
beforeEach(()=>{
  vi.resetModules();storage.upload.mockReset();
  vi.stubEnv("VITE_TEAM_SUPABASE_URL","https://example.supabase.co");
  vi.stubEnv("VITE_TEAM_SUPABASE_ANON_KEY","sb_publishable_synthetic_test_value");
  vi.stubGlobal("location",{hash:""});
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe("temporary browser references",()=>{
  it("resizes and prepares inline data without writing an image to cloud storage",async()=>{
    const bytes = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
    const drawImage = vi.fn(),close=vi.fn();
    const canvas = {width:0,height:0,getContext:()=>({drawImage}),toBlob:(callback:any)=>callback(new Blob([bytes],{type:"image/png"}))};
    vi.stubGlobal("createImageBitmap",vi.fn().mockResolvedValue({width:4096,height:2048,close}));
    vi.stubGlobal("document",{createElement:()=>canvas});
    vi.spyOn(URL,"createObjectURL").mockReturnValue("blob:temporary");
    const {uploadImage}=await import("../../team/api");
    const prepared=await uploadImage(new File([bytes],"product.png",{type:"image/png"}),"user");
    expect(canvas).toMatchObject({width:2048,height:1024});
    expect(close).toHaveBeenCalledOnce();
    expect(prepared).toMatchObject({temporary:true,mimeType:"image/png",preview:"blob:temporary"});
    expect(prepared.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(atob(prepared.data).length).toBe(bytes.length);
    expect(storage.upload).not.toHaveBeenCalled();
  });
});

