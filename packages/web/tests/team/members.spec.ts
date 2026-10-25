// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { SupabaseStudioStore } from "../../../../supabase/functions/_shared/studio-store";
const owner = "11111111-1111-4111-8111-111111111111";
const target = "22222222-2222-4222-8222-222222222222";
const password = "Synthetic-member-password-123";
function harness() {
  const row = { role: "member" };
  const auth = {
    createUser: vi
      .fn()
      .mockResolvedValue({ data: { user: { id: target } }, error: null }),
    getUserById: vi
      .fn()
      .mockResolvedValue({
        data: { user: { app_metadata: { prompt_studio_managed: true } } },
        error: null,
      }),
    updateUserById: vi.fn().mockResolvedValue({ error: null }),
    generateLink: vi.fn(),
  };
  const query = {
    insert: vi.fn().mockResolvedValue({ error: null }),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  const db = { auth: { admin: auth }, from: vi.fn().mockReturnValue(query) };
  const store = new SupabaseStudioStore(
    db as any,
    "https://studio.example",
    true,
  );
  return {
    auth,
    query,
    db,
    row,
    command: (action: string, body: Record<string, unknown>, admin = true) =>
      store.command(owner, admin, action, body),
  };
}
describe("administrator-managed member passwords", () => {
  it("creates a normalized account with the same identity used for password login, without email delivery",async()=>{
    const h=harness();
    expect(await h.command("member.create",{username:" Design_01 ",password,role:"admin"})).toEqual({ok:true,username:"design_01"});
    expect(h.auth.createUser).toHaveBeenCalledWith({email:"design_01@accounts.dongwu.invalid",password,email_confirm:true,
      app_metadata:{prompt_studio_managed:true,prompt_studio_username:"design_01"}});
    expect(h.query.insert).toHaveBeenCalledWith({user_id:target,email:"design_01@accounts.dongwu.invalid",role:"member",active:true});
    expect(h.auth.generateLink).not.toHaveBeenCalled();
  });
  it.each(["ab","a".repeat(33),"name@example.com","-test","张三001","name space",null])("rejects invalid account %s before creating Auth identity",async(username)=>{
    const h=harness();await expect(h.command("member.create",{username,password})).rejects.toThrow("INVALID_USERNAME");
    expect(h.auth.createUser).not.toHaveBeenCalled();expect(h.query.insert).not.toHaveBeenCalled();
  });
  it("does not reuse, reset or invite an existing account when a username is taken",async()=>{
    const h=harness();h.auth.createUser.mockResolvedValue({data:{},error:{code:"email_exists",message:password}});
    await expect(h.command("member.create",{username:"design01",password})).rejects.toThrow(/^USERNAME_EXISTS$/);
    expect(h.query.insert).not.toHaveBeenCalled();expect(h.auth.updateUserById).not.toHaveBeenCalled();expect(h.auth.generateLink).not.toHaveBeenCalled();
  });
  it("rejects mixed identifiers and the reserved account namespace through legacy creation/invitation",async()=>{
    const h=harness();await expect(h.command("member.create",{username:"design01",email:"other@example.com",password})).rejects.toThrow("INVALID_REQUEST");
    for(const action of ["member.create","member.invite"])await expect(h.command(action,{email:"design01@accounts.dongwu.invalid",password})).rejects.toThrow("INVALID_EMAIL");
    expect(h.auth.createUser).not.toHaveBeenCalled();expect(h.auth.generateLink).not.toHaveBeenCalled();
  });
  it.each(["member.create", "member.password"])(
    "rejects non-admin %s before touching Auth",
    async (action) => {
      const h = harness();
      await expect(
        h.command(
          action,
          { email: "member@example.com", userId: target, password },
          false,
        ),
      ).rejects.toThrow("FORBIDDEN");
      expect(h.auth.createUser).not.toHaveBeenCalled();
      expect(h.auth.updateUserById).not.toHaveBeenCalled();
      expect(h.db.from).not.toHaveBeenCalled();
    },
  );
  it("creates a confirmed member with a private management marker and returns no credentials", async () => {
    const h = harness();
    expect(
      await h.command("member.create", {
        email: "Member@example.com",
        password,
        role: "admin",
      }),
    ).toEqual({ ok: true });
    expect(h.auth.createUser).toHaveBeenCalledWith({
      email: "member@example.com",
      password,
      email_confirm: true,
      app_metadata: { prompt_studio_managed: true },
    });
    expect(h.query.insert).toHaveBeenCalledWith({
      user_id: target,
      email: "member@example.com",
      role: "member",
      active: true,
    });
  });
  it("does not reset or enroll an existing shared Auth account", async () => {
    const h = harness();
    h.auth.createUser.mockResolvedValue({
      data: {},
      error: { code: "email_exists", message: password },
    });
    await expect(
      h.command("member.create", { email: "existing@example.com", password }),
    ).rejects.toThrow("MEMBER_EXISTS");
    expect(h.query.insert).not.toHaveBeenCalled();
    expect(h.auth.updateUserById).not.toHaveBeenCalled();
    expect(h.auth.generateLink).not.toHaveBeenCalled();
  });
  it.each(["short", "x".repeat(129), null])(
    "rejects invalid passwords without contacting Auth",
    async (value) => {
      const h = harness();
      await expect(
        h.command("member.create", {
          email: "member@example.com",
          password: value,
        }),
      ).rejects.toThrow("INVALID_PASSWORD");
      expect(h.auth.createUser).not.toHaveBeenCalled();
    },
  );
  it("only resets a member created by this studio", async () => {
    const h = harness();
    expect(
      await h.command("member.password", { userId: target, password }),
    ).toEqual({ ok: true });
    expect(h.auth.updateUserById).toHaveBeenCalledWith(target, { password });
    expect(h.query.eq).toHaveBeenCalledWith("user_id", target);
  });
  it("protects existing accounts used by another application", async () => {
    const h = harness();
    h.auth.getUserById.mockResolvedValue({
      data: { user: { app_metadata: {} } },
      error: null,
    });
    await expect(
      h.command("member.password", { userId: target, password }),
    ).rejects.toThrow("SHARED_ACCOUNT_PASSWORD");
    expect(h.auth.updateUserById).not.toHaveBeenCalled();
  });
  it("cannot reset another administrator, a nonmember or itself", async () => {
    for (const data of [{ role: "admin" }, null]) {
      const h = harness();
      h.query.maybeSingle.mockResolvedValue({ data, error: null });
      await expect(
        h.command("member.password", { userId: target, password }),
      ).rejects.toThrow("FORBIDDEN");
      expect(h.auth.getUserById).not.toHaveBeenCalled();
    }
    const h = harness();
    await expect(
      h.command("member.password", { userId: owner, password }),
    ).rejects.toThrow("CANNOT_EDIT_SELF");
    expect(h.db.from).not.toHaveBeenCalled();
  });
  it("sanitizes Auth failures rather than reflecting supplied passwords", async () => {
    const h = harness();
    h.auth.updateUserById.mockResolvedValue({ error: { message: password } });
    await expect(
      h.command("member.password", { userId: target, password }),
    ).rejects.toThrow(/^PASSWORD_UPDATE_FAILED$/);
  });
});
