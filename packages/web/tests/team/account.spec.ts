// @vitest-environment node
import {describe,it,expect} from "vitest";
import {accountLoginEmail,accountLabel,normalizeUsername,usernameEmail,USERNAME_PATTERN} from "../../../../supabase/functions/_shared/studio-account";
describe("account identifiers without changing existing Auth identities",()=>{
  it.each(["Design01","123456","design_01","design-01"])("uses exactly the same identity for creation and login of %s",value=>{
    expect(accountLoginEmail(value)).toBe(usernameEmail(value));
    expect(accountLabel(usernameEmail(value))).toBe(normalizeUsername(value));
    expect(new RegExp(`^(?:${USERNAME_PATTERN})$`,"v").test(value)).toBe(true);
  });
  it("keeps existing real-email logins and labels compatible",()=>{
    expect(accountLoginEmail(" Owner@Example.com ")).toBe("owner@example.com");
    expect(accountLabel("owner@example.com")).toBe("owner@example.com");
    expect(accountLabel("user@accounts.dongwu.invalid.evil.example")).toBe("user@accounts.dongwu.invalid.evil.example");
  });
  it.each(["ab","a".repeat(33),"_leading","not allowed","name\nother","张三001"])("rejects invalid username %s rather than trying a different identity",value=>{
    expect(()=>accountLoginEmail(value)).toThrow("INVALID_USERNAME");
  });
});
