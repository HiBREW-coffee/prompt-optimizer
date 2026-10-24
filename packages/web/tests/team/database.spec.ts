// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
let db: PGlite;
let legacyUpgrade: { workspace: any; library: any };
let usageDefaults: any;
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
  await db.exec(`insert into auth.users(id) values('${a}');
    insert into public.ps_members(user_id,email) values('${a}','legacy@example.com');
    insert into public.ps_workspaces(id,owner_id,title,mode,source_text,reference_path) values('${w}','${a}','Legacy reference','reference','original brief','${a}/abc.png');
    insert into public.ps_library(owner_id,title,mode,bundle,context,reference_path) values('${a}','Legacy shared reference','reference','${bundle}','{}','${a}/abc.png');`);
  await db.exec(
    await readFile(
      fileURLToPath(
        new URL(
          "../../../../supabase/migrations/202610230002_dongwu_studio.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  );
  legacyUpgrade = {
    workspace: (await db.query("select * from ps_workspaces where id=$1", [w]))
      .rows[0],
    library: (await db.query("select * from ps_library")).rows[0],
  };
  await db.exec(await readFile(fileURLToPath(new URL(
    "../../../../supabase/migrations/202610240003_usage_controls.sql", import.meta.url,
  )), "utf8"));
  usageDefaults = (await db.query("select * from ps_settings")).rows[0];
  for (const file of ["202610240004_compact_memory.sql","202610240005_transient_references.sql"])
    await db.exec(await readFile(fileURLToPath(new URL("../../../../supabase/migrations/"+file, import.meta.url)), "utf8"));
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
  it("isolates compact text memory and prevents browser writes", async () => {
    await db.exec(`insert into ps_memory(owner_id,enabled,rules) values('${a}',true,'[{"rule":"private A"}]'),('${b}',true,'[{"rule":"private B"}]')`);
    await asUser(a);
    const result = await db.query("select owner_id,rules from ps_memory");
    expect(result.rows).toEqual([{ owner_id: a, rules: [{ rule: "private A" }] }]);
    await expect(db.exec("update ps_memory set enabled=false")).rejects.toThrow("permission denied");
    await asUser(outsider);
    expect((await db.query("select * from ps_memory")).rows).toEqual([]);
  });
  it("bounds stored memory and rejects binary data in reference metadata", async () => {
    await expect(db.query("insert into ps_memory(owner_id,rules) values($1,$2)", [a, JSON.stringify(Array(13).fill({rule:"x"}))])).rejects.toThrow();
    await expect(db.query("insert into ps_memory(owner_id,rules) values($1,$2)", [a, JSON.stringify([{rule:"x".repeat(17000)}])])).rejects.toThrow();
    const image = { path:a+"/abc.png",role:"product",note:"主体",temporary:true,digest:"a".repeat(64),sourceDigest:"b".repeat(64) };
    expect((await db.query<{valid:boolean}>("select ps_valid_references($1,$2) valid", [JSON.stringify([image]),a])).rows[0].valid).toBe(true);
    expect((await db.query<{valid:boolean}>("select ps_valid_references($1,$2) valid", [JSON.stringify([{...image,data:"base64-image"}]),a])).rows[0].valid).toBe(false);
  });
  it("disables application daily caps on upgrade without removing concurrency", () => {
    expect(usageDefaults).toMatchObject({
      member_daily: 0, team_daily: 0, user_concurrent: 1, team_concurrent: 2,
    });
  });
  it("accepts requests beyond former daily caps when both caps are zero", async () => {
    await db.exec("update ps_settings set member_daily=0,team_daily=0");
    await db.exec(`insert into ps_requests(id,owner_id,workspace_id,action,payload_hash,status)
      select gen_random_uuid(),'${a}','${w}','reference.extract','old','succeeded' from generate_series(1,201)`);
    expect(await begin()).toEqual({ accepted: true });
    await expect(begin(crypto.randomUUID())).rejects.toThrow("BUSY");
  });
  it("supports a zero personal override and still respects a positive team cap", async () => {
    await db.exec(`update ps_settings set member_daily=1,team_daily=2;update ps_members set daily_limit=0 where user_id='${a}'`);
    await begin();
    await db.exec("update ps_requests set status='failed'");
    expect(await begin(crypto.randomUUID())).toEqual({ accepted: true });
    await db.exec("update ps_requests set status='failed'");
    await expect(begin(crypto.randomUUID())).rejects.toThrow("DAILY_LIMIT");
  });
  it("upgrades existing single-image records without changing their original brief or path", () => {
    const expected = [{ path: `${a}/abc.png`, role: "auto", note: "" }];
    expect(legacyUpgrade.workspace.reference_images).toEqual(expected);
    expect(legacyUpgrade.workspace.source_text).toBe("original brief");
    expect(legacyUpgrade.workspace.reference_path).toBe(`${a}/abc.png`);
    expect(legacyUpgrade.workspace.intent).toBe("replicate");
    expect(legacyUpgrade.library.reference_images).toEqual(expected);
    expect(legacyUpgrade.library.bundle).toEqual(JSON.parse(bundle));
  });
  it("validates five owned references, rejecting duplicates, foreign paths and six images", async () => {
    const refs = Array.from({ length: 5 }, (_, i) => ({
      path: `${a}/${i + 1}.png`,
      role: "auto",
      note: "",
    }));
    await db.query("update ps_workspaces set reference_images=$1 where id=$2", [
      JSON.stringify(refs),
      w,
    ]);
    expect(
      (
        await db.query<{ reference_images: any[] }>(
          "select reference_images from ps_workspaces where id=$1",
          [w],
        )
      ).rows[0].reference_images,
    ).toHaveLength(5);
    for (const invalid of [
      [...refs, { path: `${a}/six.png`, role: "auto", note: "" }],
      [refs[0], refs[0]],
      [{ ...refs[0], path: `${b}/1.png` }],
      [{ ...refs[0], note: 1 }],
    ]) {
      await expect(
        db.query("update ps_workspaces set reference_images=$1 where id=$2", [
          JSON.stringify(invalid),
          w,
        ]),
      ).rejects.toThrow(/ps_workspace_references_valid/);
    }
  });
  it("stores input analysis transactionally and isolates it from other members and direct client writes", async () => {
    await begin();
    const result = await db.query<{ result: any }>(
      "select ps_complete_inspection($1,$2,$3,$4,$5) result",
      [
        a,
        w,
        JSON.stringify({
          score: 71,
          structure: [{ title: "主体", content: "产品" }],
          suggestions: [],
        }),
        JSON.stringify({
          source: "图1产品",
          reference_images: [
            { path: `${a}/abc.png`, role: "product", note: "" },
          ],
        }),
        r,
      ],
    );
    expect(result.rows[0].result.inspection.workspace_id).toBe(w);
    expect(
      (
        await db.query<{ status: string }>(
          "select status from ps_requests where id=$1",
          [r],
        )
      ).rows[0].status,
    ).toBe("succeeded");
    await asUser(b);
    expect((await db.query("select * from ps_inspections")).rows).toHaveLength(
      0,
    );
    await expect(db.exec("delete from ps_inspections")).rejects.toThrow(
      /permission denied/,
    );
    await asUser(a);
    expect((await db.query("select * from ps_inspections")).rows).toHaveLength(
      1,
    );
  });
  it("does not complete another workspace's input analysis with a valid but unrelated request", async () => {
    await begin();
    await expect(
      db.query("select ps_complete_inspection($1,$2,$3,$4,$5)", [
        b,
        wb,
        "{}",
        "{}",
        r,
      ]),
    ).rejects.toThrow(/REQUEST_INTERRUPTED/);
    expect((await db.query("select * from ps_inspections")).rows).toHaveLength(
      0,
    );
  });
  it("only explicitly shared references are visible, including later images in a five-image library item", async () => {
    const refs = [
      { path: `${a}/abc.png`, role: "product", note: "" },
      { path: `${a}/abc2.png`, role: "scene", note: "" },
    ];
    await db.exec(
      `insert into storage.objects(bucket_id,name) values('prompt-studio-references','${a}/abc2.png')`,
    );
    await db.query(
      "insert into ps_library(owner_id,title,mode,bundle,context,reference_images) values($1,'shared','reference',$2,'{}',$3)",
      [a, bundle, JSON.stringify(refs)],
    );
    await asUser(b);
    expect(
      (
        await db.query("select name from storage.objects where name=$1", [
          `${a}/abc2.png`,
        ])
      ).rows,
    ).toHaveLength(1);
    await db.exec("reset role;delete from ps_library;");
    await asUser(b);
    expect(
      (
        await db.query("select name from storage.objects where name=$1", [
          `${a}/abc2.png`,
        ])
      ).rows,
    ).toHaveLength(0);
  });
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

