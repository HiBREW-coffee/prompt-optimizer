// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
let db: PGlite;
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222",
  outsider = "33333333-3333-4333-8333-333333333333";
const w = "44444444-4444-4444-8444-444444444444",
  wb = "55555555-5555-4555-8555-555555555555";
const r = "66666666-6666-4666-8666-666666666666";
const bundle = JSON.stringify({
  zh: "测试",
  en: "test",
  structured: { subject: "test" },
  observations: [],
  uncertainties: [],
});
async function asUser(user: string) {
  await db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${user}',false);`,
  );
}
async function begin(id = r, user = a, workspace = w, hash = "hash") {
  const data = await db.query<{ result: any }>(
    "select public.ps_begin_request($1,$2,$3,$4,$5) result",
    [id, user, workspace, "reference.extract", hash],
  );
  return data.rows[0].result;
}
async function append(
  parent: string | null = null,
  request: string | null = null,
) {
  const data = await db.query<{ result: any }>(
    "select public.ps_append_version($1,$2,$3,$4,$5,$6,$7) result",
    [
      a,
      w,
      parent,
      bundle,
      JSON.stringify({ source: "source", keep: "keep", change: "change" }),
      "reference.extract",
      request,
    ],
  );
  return data.rows[0].result;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema storage;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,storage to anon,authenticated,service_role;
 grant execute on function auth.uid() to anon,authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant all on storage.objects to anon,authenticated,service_role;
 create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
 -- Simulates an unsafe broad policy left by another application in the same project.
 create policy legacy_allow_all on storage.objects for all to anon,authenticated using(true) with check(true);
 `);
  const sql = await readFile(
    fileURLToPath(
      new URL(
        "../../../../supabase/migrations/202610230001_prompt_studio.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  await db.exec(sql);
}, 30_000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(`reset role;
 truncate public.ps_requests,public.ps_analyses,public.ps_library_favorites,public.ps_library,public.ps_workspaces,public.ps_versions,public.ps_members,auth.users,storage.objects cascade;
 insert into auth.users(id) values('${a}'),('${b}'),('${outsider}');
 insert into public.ps_members(user_id,email) values('${a}','a@example.com'),('${b}','b@example.com');
 insert into public.ps_workspaces(id,owner_id,title,mode,reference_path) values('${w}','${a}','A','reference','${a}/abc.png'),('${wb}','${b}','B','text',null);
 insert into storage.objects(bucket_id,name) values('prompt-studio-references','${a}/abc.png'),('prompt-studio-references','${b}/def.png'),('other-app','public.png');
 update public.ps_settings set member_daily=50,team_daily=200,user_concurrent=1,team_concurrent=2;
 `);
});
describe("real PostgreSQL migration and policies", () => {
  it("only allows owner workspace/history reads and refuses client writes", async () => {
    await append();
    await asUser(b);
    expect(
      (await db.query<{ id: string }>("select id from ps_workspaces")).rows.map(
        (x) => x.id,
      ),
    ).toEqual([wb]);
    expect((await db.query("select * from ps_versions")).rows).toHaveLength(0);
    await expect(
      db.exec(`update ps_members set role='admin' where user_id='${b}'`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.exec(
        `insert into ps_workspaces(owner_id,title,mode) values('${b}','x','text')`,
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("existing Supabase user without membership sees no app assets", async () => {
    await asUser(outsider);
    expect((await db.query("select * from ps_workspaces")).rows).toHaveLength(
      0,
    );
    expect((await db.query("select * from ps_library")).rows).toHaveLength(0);
    expect(
      (
        await db.query(
          "select * from storage.objects where bucket_id='prompt-studio-references'",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("restrictive storage guards defeat legacy broad grants while preserving other apps", async () => {
    await asUser(b);
    expect(
      (
        await db.query<{ name: string }>(
          "select name from storage.objects order by name",
        )
      ).rows.map((x) => x.name),
    ).toEqual([`${b}/def.png`, "public.png"]);
    await expect(
      db.exec(
        `insert into storage.objects(bucket_id,name) values('prompt-studio-references','${a}/hijack.png')`,
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.exec(
        `insert into storage.objects(bucket_id,name) values('prompt-studio-references','${b}/bad.svg')`,
      ),
    ).rejects.toThrow(/row-level security/);
    await db.exec(
      `insert into storage.objects(bucket_id,name) values('prompt-studio-references','${b}/abc.jpg')`,
    );
    expect(
      (
        await db.query(
          "delete from storage.objects where bucket_id='prompt-studio-references' returning id",
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          "update storage.objects set name='overwritten' where bucket_id='prompt-studio-references' returning id",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("sharing prompt only never grants image access; explicit image sharing can be withdrawn", async () => {
    await db.query(
      "insert into ps_library(owner_id,title,mode,bundle,context) values($1,$2,$3,$4,$5)",
      [a, "shared", "reference", bundle, "{}"],
    );
    await asUser(b);
    expect((await db.query("select * from ps_library")).rows).toHaveLength(1);
    expect(
      (
        await db.query("select * from storage.objects where name=$1", [
          `${a}/abc.png`,
        ])
      ).rows,
    ).toHaveLength(0);
    await db.exec("reset role");
    await db.query("update ps_library set reference_path=$1", [`${a}/abc.png`]);
    await asUser(b);
    expect(
      (
        await db.query("select * from storage.objects where name=$1", [
          `${a}/abc.png`,
        ])
      ).rows,
    ).toHaveLength(1);
    await db.exec("reset role;delete from ps_library");
    await asUser(b);
    expect(
      (
        await db.query("select * from storage.objects where name=$1", [
          `${a}/abc.png`,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  it("disabling membership also revokes personal and shared image reads", async () => {
    await db.query("update ps_members set active=false where user_id=$1", [a]);
    await asUser(a);
    expect((await db.query("select * from ps_workspaces")).rows).toHaveLength(
      0,
    );
    expect(
      (
        await db.query(
          "select * from storage.objects where bucket_id='prompt-studio-references'",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("anonymous broad storage policy cannot expose the new private bucket", async () => {
    await db.exec(
      "set role anon;select set_config('request.jwt.claim.sub','',false)",
    );
    expect(
      (
        await db.query(
          "select * from storage.objects where bucket_id='prompt-studio-references'",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("prevents browser callers from bypassing quota RPCs", async () => {
    await asUser(a);
    await expect(begin()).rejects.toThrow(/permission denied/);
    await expect(append()).rejects.toThrow(/permission denied/);
  });
  it("admission is idempotent and enforces request ownership/payload identity", async () => {
    expect(await begin()).toEqual({ accepted: true });
    expect((await begin()).accepted).toBe(false);
    await expect(begin(r, b, wb)).rejects.toThrow("REQUEST_CONFLICT");
    await expect(begin(r, a, w, "different")).rejects.toThrow(
      "REQUEST_CONFLICT",
    );
    expect((await db.query("select * from ps_requests")).rows).toHaveLength(1);
  });
  it("enforces per-user concurrency and releases after completion", async () => {
    await begin();
    await expect(begin(crypto.randomUUID())).rejects.toThrow("BUSY");
    const saved = await append(null, r);
    expect(saved.became_current).toBe(true);
    expect((await begin()).request.status).toBe("succeeded");
    expect(await begin(crypto.randomUUID())).toEqual({ accepted: true });
  });
  it("enforces global concurrency across members", async () => {
    await db.exec("update ps_settings set team_concurrent=1");
    await begin();
    await expect(begin(crypto.randomUUID(), b, wb)).rejects.toThrow("BUSY");
  });
  it.each(["member", "team"])(
    "enforces %s daily limit including failed requests",
    async (target) => {
      await db.exec(
        `update ps_settings set ${target === "member" ? "member_daily" : "team_daily"}=1`,
      );
      await begin();
      await db.exec("update ps_requests set status='failed'");
      await expect(
        begin(
          crypto.randomUUID(),
          target === "team" ? b : a,
          target === "team" ? wb : w,
        ),
      ).rejects.toThrow("DAILY_LIMIT");
    },
  );
  it("expires interrupted requests without automatically starting another paid operation", async () => {
    await begin();
    await db.exec(
      "update ps_requests set expires_at=now()-interval '1 second'",
    );
    const duplicate = await begin();
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.request.error_code).toBe("REQUEST_INTERRUPTED");
    expect((await db.query("select * from ps_requests")).rows).toHaveLength(1);
  });
  it("stale tabs append a branch without overwriting current content", async () => {
    const first = await append();
    const second = await append(first.version.id);
    const stale = await append(first.version.id);
    expect(stale.version.sequence).toBe(3);
    expect(stale.became_current).toBe(false);
    expect(
      (
        await db.query<{ current_version_id: string }>(
          "select current_version_id from ps_workspaces where id=$1",
          [w],
        )
      ).rows[0].current_version_id,
    ).toBe(second.version.id);
    expect((await db.query("select * from ps_versions")).rows).toHaveLength(3);
  });
  it("saves quality analysis and request completion atomically", async () => {
    const v = await append();
    await begin();
    const result = await db.query<{ result: any }>(
      "select ps_complete_analysis($1,$2,$3,$4,$5) result",
      [a, v.version.id, '{"score":83}', "{}", r],
    );
    expect(result.rows[0].result.analysis.result.score).toBe(83);
    expect((await begin()).request.result.analysis.version_id).toBe(
      v.version.id,
    );
  });
  it("restoring creates a new version and restores requirements", async () => {
    const first = await append();
    await db.query("update ps_workspaces set keep_text=$1 where id=$2", [
      "changed",
      w,
    ]);
    await db.query("select ps_append_version($1,$2,$3,$4,$5,$6)", [
      a,
      w,
      first.version.id,
      bundle,
      '{"source":"original","keep":"original keep","change":""}',
      "restore",
    ]);
    expect(
      (
        await db.query<{ keep_text: string }>(
          "select keep_text from ps_workspaces where id=$1",
          [w],
        )
      ).rows[0].keep_text,
    ).toBe("original keep");
    expect((await db.query("select * from ps_versions")).rows).toHaveLength(2);
  });
});
