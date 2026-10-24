// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { SupabaseStudioStore } from "../../../../supabase/functions/_shared/studio-store";
const user = "11111111-1111-4111-8111-111111111111";
const workspace = "22222222-2222-4222-8222-222222222222";
const request = "33333333-3333-4333-8333-333333333333";
function harness(data: unknown = {id: request}) {
  const query = {update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), gt: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({data, error:null})};
  const db = {from: vi.fn().mockReturnValue(query)};
  return {query, db, store: new SupabaseStudioStore(db as any, "https://studio.example", true)};
}
describe("recoverable polishing result", () => {
  it("completes only the owner's active unexpired request without storing a generated version", async () => {
    const h = harness();
    expect(await h.store.polish(user, workspace, request, "专业指令", "简单想法"))
      .toEqual({polishedPrompt:"专业指令", originalPrompt:"简单想法"});
    expect(h.db.from).toHaveBeenCalledExactlyOnceWith("ps_requests");
    expect(h.query.eq.mock.calls).toEqual([["id",request],["owner_id",user],["workspace_id",workspace],["status","running"]]);
    expect(h.query.gt).toHaveBeenCalledWith("expires_at", expect.any(String));
    expect(h.query.update).toHaveBeenCalledWith(expect.objectContaining({status:"succeeded",result:{polishedPrompt:"专业指令",originalPrompt:"简单想法"}}));
  });
  it("rejects an expired or already completed request instead of reporting unsaved success", async () => {
    const h = harness(null);
    await expect(h.store.polish(user,workspace,request,"新指令","原文")).rejects.toThrow("REQUEST_INTERRUPTED");
  });
});
