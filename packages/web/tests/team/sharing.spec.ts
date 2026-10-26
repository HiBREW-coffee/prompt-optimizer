// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { SupabaseStudioStore } from "../../../../supabase/functions/_shared/studio-store";

describe("five-reference sharing privacy", () => {
  it.each([false, true])(
    "shares only the opted-in assets (includeImage=%s)",
    async (includeImage) => {
      const owner = "11111111-1111-4111-8111-111111111111";
      const workspaceId = "22222222-2222-4222-8222-222222222222";
      const versionId = "33333333-3333-4333-8333-333333333333";
      const images = Array.from({ length: 5 }, (_, i) => ({
        path: `${owner}/abc${i}.png`,
        role: "product" as const,
        note: "private image instruction",
      }));
      const query = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValue({ data: { id: "shared" }, error: null }),
      };
      const store = new SupabaseStudioStore(
        { from: vi.fn().mockReturnValue(query) } as any,
        "https://studio.example",
        true,
      );
      vi.spyOn(store, "workspace").mockResolvedValue({
        id: workspaceId,
        owner_id: owner,
        title: "Public prompt",
        mode: "reference",
        source_text: "private client brief",
        keep_text: "private rule",
        change_text: "",
        reference_path: images[0].path,
        reference_images: images,
        current_version_id: versionId,
        favorite: false,
      });
      vi.spyOn(store, "version").mockResolvedValue({
        id: versionId,
        workspace_id: workspaceId,
        sequence: 1,
        parent_id: null,
        bundle: {
          zh: "公共中文提示词",
          en: "Public English prompt",
          structured: { subject: "product" },
          observations: ["private observation"],
          uncertainties: ["private concern"],
          report: {
            intent: "private client brief",
            imageRoles: [],
            anchors: [],
            changes: [],
            sections: [],
            negative: { zh: "", en: "" },
            parameters: [],
            checks: [],
          },
        },
        context: { confirmed_preferences: [{ rule: "private reusable preference" }] },
        kind: "reference.extract",
        created_at: "2026-10-23",
      });
      await store.command(owner, false, "library.publish", {
        workspaceId,
        versionId,
        includeImage,
      });
      const shared = query.insert.mock.calls[0][0];
      expect(shared.bundle).toEqual({
        zh: "公共中文提示词",
        en: "Public English prompt",
        structured: { subject: "product" },
        observations: [],
        uncertainties: [],
      });
      expect(JSON.stringify(shared)).not.toContain("private");
      expect(shared.reference_images).toHaveLength(includeImage ? 5 : 0);
      expect(shared.reference_path).toBe(includeImage ? images[0].path : null);
      if (includeImage)
        expect(shared.reference_images.map((image: any) => image.path)).toEqual(
          images.map((image) => image.path),
        );
      if (!includeImage) {
        const workspace = await store.workspace(owner,workspaceId);
        vi.mocked(store.workspace).mockResolvedValue({...workspace,reference_images:images.map(image=>({...image,temporary:true,digest:"a".repeat(64),sourceDigest:"b".repeat(64)}))});
        query.insert.mockClear();
        await expect(store.command(owner,false,"library.publish",{workspaceId,versionId,includeImage:true}))
          .rejects.toThrow("TEMPORARY_REFERENCE_NOT_SHAREABLE");
        expect(query.insert).not.toHaveBeenCalled();
      }
    },
  );
});

