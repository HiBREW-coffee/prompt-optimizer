// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { applicableMemory, normalizeMemory } from "../../../../supabase/functions/_shared/studio-memory";
import { SupabaseStudioStore } from "../../../../supabase/functions/_shared/studio-store";
import { buildStudioPrompt } from "../../../../supabase/functions/_shared/studio-prompts";
const user = "11111111-1111-4111-8111-111111111111";
const rule = (text="产品外观不变") => ({id:crypto.randomUUID(),title:"外观底线",rule:text,scope:"reference" as const,template:""});
describe("explicit compact memory", () => {
  it("keeps only explicit text fields and rejects duplicate or oversized rules", () => {
    const value = normalizeMemory({enabled:true,rules:[{...rule(),image:"discarded",transcript:"discarded"}]});
    expect(Object.keys(value.rules[0])).toEqual(["id","title","rule","scope","template"]);
    expect(JSON.stringify(value)).not.toContain("discarded");
    expect(()=>normalizeMemory({enabled:true,rules:[rule(),rule()]})).toThrow("DUPLICATE_MEMORY");
    expect(()=>normalizeMemory({enabled:true,rules:Array.from({length:13},(_,i)=>rule(String(i)))})).toThrow("INVALID_MEMORY");
    expect(()=>normalizeMemory({enabled:true,rules:[rule("x".repeat(281))]})).toThrow("INVALID_MEMORY");
  });
  it("selects at most four applicable rules and makes disabling reversible", () => {
    const rules = Array.from({length:7},(_,i)=>({...rule(String(i)),template:i===0?"identity":""}));
    const memory = {enabled:true,rules};
    expect(applicableMemory(memory,"reference","ecommerce").map(item=>item.rule)).toEqual(["1","2","3","4"]);
    expect(applicableMemory(memory,"text","general")).toEqual([]);
    expect(applicableMemory({...memory,enabled:false},"reference","ecommerce")).toEqual([]);
    expect(memory.rules).toHaveLength(7);
  });
  it("reads and saves only the authenticated owner's bounded memory without model use", async () => {
    const memory = {enabled:true,rules:[rule()]};
    const query = {select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),
      maybeSingle:vi.fn().mockResolvedValue({data:memory,error:null}),upsert:vi.fn().mockResolvedValue({error:null})};
    const db = {from:vi.fn().mockReturnValue(query)};
    const store = new SupabaseStudioStore(db as any,"https://studio.example",true);
    expect(await store.command(user,false,"memory.get",{})).toEqual(memory);
    expect(query.eq).toHaveBeenCalledWith("owner_id",user);
    expect(await store.command(user,false,"memory.save",{memory:{...memory,owner_id:"another"}})).toEqual(memory);
    expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({owner_id:user,...memory}),{onConflict:"owner_id"});
  });
  it("carries confirmed rules as auxiliary data alongside the current explicit brief", () => {
    const workspace = { id:user,owner_id:user,title:"test",mode:"reference" as const,source_text:"本次将外壳改成蓝色",
      keep_text:"机身几何不变",change_text:"",reference_path:null,favorite:false,current_version_id:null };
    const input = buildStudioPrompt("reference.extract",workspace,null,"",false,[rule()]);
    expect(JSON.parse(input.text)).toMatchObject({original:"本次将外壳改成蓝色",keep:"机身几何不变",confirmedPreferences:[{title:"外观底线",rule:"产品外观不变"}]});
  });
});

