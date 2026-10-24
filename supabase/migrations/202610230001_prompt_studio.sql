-- Isolated application objects: does not modify existing Auth settings or apps.
begin;
create table public.ps_members (
  user_id uuid primary key references auth.users(id), email text not null,
  role text not null default 'member' check (role in ('admin','member')),
  active boolean not null default true, daily_limit integer check (daily_limit between 1 and 10000),
  created_at timestamptz not null default now()
);
create table public.ps_settings (
  id boolean primary key default true check (id), member_daily integer not null default 50 check(member_daily between 1 and 10000),
  team_daily integer not null default 200 check(team_daily between 1 and 100000),
  user_concurrent integer not null default 1 check(user_concurrent between 1 and 3),
  team_concurrent integer not null default 2 check(team_concurrent between 1 and 10)
);
insert into public.ps_settings(id) values(true);
create function public.ps_is_member() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.ps_members where user_id = auth.uid() and active);
$$;
create function public.ps_is_admin() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.ps_members where user_id = auth.uid() and active and role = 'admin');
$$;
create table public.ps_workspaces (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.ps_members(user_id),
  title text not null check(length(title) between 1 and 120), mode text not null check(mode in ('text','reference')),
  source_text text not null default '' check(length(source_text)<=16000),
  keep_text text not null default '' check(length(keep_text)<=8000), change_text text not null default '' check(length(change_text)<=8000),
  reference_path text, current_version_id uuid, favorite boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(reference_path is null or reference_path ~ ('^' || owner_id::text || '/[a-f0-9-]+\.(png|jpg|jpeg)$'))
);
create table public.ps_versions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.ps_workspaces(id),
  sequence integer not null, parent_id uuid references public.ps_versions(id), bundle jsonb not null,
  context jsonb not null, kind text not null, created_at timestamptz not null default now(), unique(workspace_id,sequence),
  check(jsonb_typeof(bundle)='object' and octet_length(bundle::text)<=120000)
);
alter table public.ps_workspaces add constraint ps_current_version foreign key(current_version_id) references public.ps_versions(id);
create table public.ps_analyses (
  id uuid primary key default gen_random_uuid(), version_id uuid not null references public.ps_versions(id),
  context jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
create table public.ps_library (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.ps_members(user_id),
  title text not null check(length(title) between 1 and 120), mode text not null check(mode in ('text','reference')),
  bundle jsonb not null, context jsonb not null, reference_path text, created_at timestamptz not null default now()
);
create table public.ps_library_favorites (
  user_id uuid not null references public.ps_members(user_id), library_id uuid not null references public.ps_library(id) on delete cascade,
  primary key(user_id,library_id)
);
create table public.ps_requests (
  id uuid primary key, owner_id uuid not null references public.ps_members(user_id),
  workspace_id uuid not null references public.ps_workspaces(id), action text not null, payload_hash text not null,
  status text not null default 'running' check(status in ('running','succeeded','failed')),
  result jsonb, error_code text, created_at timestamptz not null default now(), finished_at timestamptz,
  expires_at timestamptz not null default now()+interval '130 seconds'
);
create index ps_workspace_owner on public.ps_workspaces(owner_id,updated_at desc);
create index ps_request_usage on public.ps_requests(created_at,owner_id,status);
create index ps_analysis_version on public.ps_analyses(version_id,created_at desc);

-- Every application table is read-only to browser clients except their own library favorites.
alter table public.ps_members enable row level security;
alter table public.ps_settings enable row level security;
alter table public.ps_workspaces enable row level security;
alter table public.ps_versions enable row level security;
alter table public.ps_analyses enable row level security;
alter table public.ps_library enable row level security;
alter table public.ps_library_favorites enable row level security;
alter table public.ps_requests enable row level security;
create policy ps_members_read on public.ps_members for select to authenticated using(user_id=auth.uid() or public.ps_is_admin());
create policy ps_settings_read on public.ps_settings for select to authenticated using(public.ps_is_member());
create policy ps_workspaces_read on public.ps_workspaces for select to authenticated using(owner_id=auth.uid() and public.ps_is_member());
create policy ps_versions_read on public.ps_versions for select to authenticated using(public.ps_is_member() and exists(select 1 from public.ps_workspaces w where w.id=workspace_id and w.owner_id=auth.uid()));
create policy ps_analyses_read on public.ps_analyses for select to authenticated using(public.ps_is_member() and exists(select 1 from public.ps_versions v join public.ps_workspaces w on w.id=v.workspace_id where v.id=version_id and w.owner_id=auth.uid()));
create policy ps_library_read on public.ps_library for select to authenticated using(public.ps_is_member());
create policy ps_favorites_read on public.ps_library_favorites for select to authenticated using(user_id=auth.uid() and public.ps_is_member());
create policy ps_favorites_insert on public.ps_library_favorites for insert to authenticated with check(user_id=auth.uid() and public.ps_is_member());
create policy ps_favorites_delete on public.ps_library_favorites for delete to authenticated using(user_id=auth.uid() and public.ps_is_member());
create policy ps_requests_read on public.ps_requests for select to authenticated using(owner_id=auth.uid() and public.ps_is_member());
revoke all on public.ps_members,public.ps_settings,public.ps_workspaces,public.ps_versions,public.ps_analyses,public.ps_library,public.ps_library_favorites,public.ps_requests from anon,authenticated;
grant select on public.ps_members,public.ps_settings,public.ps_workspaces,public.ps_versions,public.ps_analyses,public.ps_library,public.ps_library_favorites,public.ps_requests to authenticated;
grant insert,delete on public.ps_library_favorites to authenticated;
grant all on public.ps_members,public.ps_settings,public.ps_workspaces,public.ps_versions,public.ps_analyses,public.ps_library,public.ps_library_favorites,public.ps_requests to service_role;

-- Service-only admission transaction. One global lock prevents concurrent quota races.
create function public.ps_begin_request(p_id uuid,p_user uuid,p_workspace uuid,p_action text,p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.ps_members; s public.ps_settings; existing public.ps_requests; day_start timestamptz;
begin
 perform pg_advisory_xact_lock(7238188801);
 select * into m from public.ps_members where user_id=p_user and active;
 if not found then raise exception 'NOT_MEMBER'; end if;
 if not exists(select 1 from public.ps_workspaces where id=p_workspace and owner_id=p_user) then raise exception 'NOT_FOUND'; end if;
 select * into existing from public.ps_requests where id=p_id;
 if found then
   if existing.owner_id<>p_user or existing.payload_hash<>p_hash then raise exception 'REQUEST_CONFLICT'; end if;
   if existing.status='running' and existing.expires_at<now() then
     update public.ps_requests set status='failed',error_code='REQUEST_INTERRUPTED',finished_at=now() where id=p_id;
     select * into existing from public.ps_requests where id=p_id;
   end if;
   return jsonb_build_object('accepted',false,'request',to_jsonb(existing));
 end if;
 select * into s from public.ps_settings where id=true;
 update public.ps_requests set status='failed',error_code='REQUEST_INTERRUPTED',finished_at=now() where status='running' and expires_at<now();
 day_start := date_trunc('day',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai';
 if (select count(*) from public.ps_requests where created_at>=day_start and owner_id=p_user)>=coalesce(m.daily_limit,s.member_daily)
   or (select count(*) from public.ps_requests where created_at>=day_start)>=s.team_daily then raise exception 'DAILY_LIMIT'; end if;
 if (select count(*) from public.ps_requests where status='running' and owner_id=p_user)>=s.user_concurrent
   or (select count(*) from public.ps_requests where status='running')>=s.team_concurrent then raise exception 'BUSY'; end if;
 insert into public.ps_requests(id,owner_id,workspace_id,action,payload_hash) values(p_id,p_user,p_workspace,p_action,p_hash);
 return jsonb_build_object('accepted',true);
end; $$;

-- Appending never destroys an older version. A stale tab produces a branch without replacing the new current version.
create function public.ps_append_version(p_user uuid,p_workspace uuid,p_parent uuid,p_bundle jsonb,p_context jsonb,p_kind text,p_request uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w public.ps_workspaces; v public.ps_versions; became_current boolean;
begin
 select * into w from public.ps_workspaces where id=p_workspace and owner_id=p_user for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if p_parent is not null and not exists(select 1 from public.ps_versions where id=p_parent and workspace_id=p_workspace) then raise exception 'NOT_FOUND'; end if;
 if p_request is not null and not exists(select 1 from public.ps_requests where id=p_request and owner_id=p_user and status='running' and expires_at>now()) then raise exception 'REQUEST_INTERRUPTED'; end if;
 insert into public.ps_versions(workspace_id,sequence,parent_id,bundle,context,kind)
 values(p_workspace,coalesce((select max(sequence)+1 from public.ps_versions where workspace_id=p_workspace),1),p_parent,p_bundle,p_context,p_kind) returning * into v;
 became_current := w.current_version_id is not distinct from p_parent;
 if became_current then
   update public.ps_workspaces set current_version_id=v.id,updated_at=now(),
    source_text=case when p_kind='restore' then coalesce(p_context->>'source','') else source_text end,
    keep_text=case when p_kind='restore' then coalesce(p_context->>'keep','') else keep_text end,
    change_text=case when p_kind='restore' then coalesce(p_context->>'change','') else change_text end where id=p_workspace;
 end if;
 if p_request is not null then update public.ps_requests set status='succeeded',finished_at=now(),result=jsonb_build_object('version',to_jsonb(v),'became_current',became_current) where id=p_request; end if;
 return jsonb_build_object('version',to_jsonb(v),'became_current',became_current);
end; $$;
create function public.ps_complete_analysis(p_user uuid,p_version uuid,p_result jsonb,p_context jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.ps_analyses;
begin
 if not exists(select 1 from public.ps_versions v join public.ps_workspaces w on w.id=v.workspace_id where v.id=p_version and w.owner_id=p_user) then raise exception 'NOT_FOUND'; end if;
 perform 1 from public.ps_requests where id=p_request and owner_id=p_user and status='running' and expires_at>now() for update;
 if not found then raise exception 'REQUEST_INTERRUPTED'; end if;
 insert into public.ps_analyses(version_id,result,context) values(p_version,p_result,p_context) returning * into a;
 update public.ps_requests set status='succeeded',finished_at=now(),result=jsonb_build_object('analysis',to_jsonb(a)) where id=p_request;
 return jsonb_build_object('analysis',to_jsonb(a));
end; $$;
revoke all on function public.ps_begin_request(uuid,uuid,uuid,text,text),public.ps_append_version(uuid,uuid,uuid,jsonb,jsonb,text,uuid),public.ps_complete_analysis(uuid,uuid,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ps_begin_request(uuid,uuid,uuid,text,text),public.ps_append_version(uuid,uuid,uuid,jsonb,jsonb,text,uuid),public.ps_complete_analysis(uuid,uuid,jsonb,jsonb,uuid) to service_role;
revoke all on function public.ps_is_member(),public.ps_is_admin() from public;
grant execute on function public.ps_is_member(),public.ps_is_admin() to anon,authenticated,service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('prompt-studio-references','prompt-studio-references',false,10485760,array['image/png','image/jpeg']);
create function public.ps_can_read_reference(p_path text) returns boolean language sql stable security definer set search_path = '' as $$
 select public.ps_is_member() and (split_part(p_path,'/',1)=auth.uid()::text or exists(select 1 from public.ps_library where reference_path=p_path));
$$;
revoke all on function public.ps_can_read_reference(text) from public;
grant execute on function public.ps_can_read_reference(text) to anon,authenticated,service_role;
-- Restrictive policies protect this bucket even if an existing app has broad permissive policies.
create policy ps_storage_read_guard on storage.objects as restrictive for select to anon,authenticated
using(bucket_id<>'prompt-studio-references' or public.ps_can_read_reference(name));
create policy ps_storage_insert_guard on storage.objects as restrictive for insert to anon,authenticated
with check(bucket_id<>'prompt-studio-references' or (public.ps_is_member() and name ~ ('^'||auth.uid()::text||'/[a-f0-9-]+\.(png|jpg|jpeg)$')));
create policy ps_storage_update_guard on storage.objects as restrictive for update to anon,authenticated
using(bucket_id<>'prompt-studio-references') with check(bucket_id<>'prompt-studio-references');
create policy ps_storage_delete_guard on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'prompt-studio-references');
create policy ps_storage_read on storage.objects for select to authenticated using(bucket_id='prompt-studio-references' and public.ps_can_read_reference(name));
create policy ps_storage_insert on storage.objects for insert to authenticated with check(bucket_id='prompt-studio-references' and public.ps_is_member() and name ~ ('^'||auth.uid()::text||'/[a-f0-9-]+\.(png|jpg|jpeg)$'));
commit;
