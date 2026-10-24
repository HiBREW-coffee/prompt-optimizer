-- Additive upgrade. Existing workspaces, versions, Auth users and other applications are preserved.
begin;
create function public.ps_valid_references(p_images jsonb,p_owner uuid) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb; seen text[] := array[]::text[];
begin
 if jsonb_typeof(p_images) is distinct from 'array' then return false; end if;
 if jsonb_array_length(p_images)>5 then return false; end if;
 for item in select value from jsonb_array_elements(p_images) loop
  if jsonb_typeof(item) is distinct from 'object'
   or coalesce(item->>'path','') !~ ('^'||p_owner::text||'/[a-f0-9-]+\.(png|jpg|jpeg)$')
   or coalesce(item->>'role','') not in ('auto','product','scene','person','style','detail')
   or jsonb_typeof(item->'note') is distinct from 'string' or length(item->>'note')>1000
   or (item->>'path')=any(seen) then return false; end if;
  seen := array_append(seen,item->>'path');
 end loop;
 return true;
end; $$;
alter table public.ps_workspaces add column reference_images jsonb not null default '[]',
 add column intent text not null default 'replicate' check(intent in ('replicate','style','inspiration')),
 add column template_id text not null default 'ecommerce' check(template_id in ('ecommerce','photography','identity','multiimage','lighting','structured','general'));
alter table public.ps_library add column reference_images jsonb not null default '[]';
alter table public.ps_workspaces drop constraint ps_workspaces_source_text_check;
alter table public.ps_workspaces add constraint ps_workspaces_source_text_check check(length(source_text)<=32000);
update public.ps_workspaces set reference_images=jsonb_build_array(jsonb_build_object('path',reference_path,'role','auto','note','')) where reference_path is not null;
update public.ps_library set reference_images=jsonb_build_array(jsonb_build_object('path',reference_path,'role','auto','note','')) where reference_path is not null;
alter table public.ps_workspaces add constraint ps_workspace_references_valid check(public.ps_valid_references(reference_images,owner_id));
alter table public.ps_library add constraint ps_library_references_valid check(public.ps_valid_references(reference_images,owner_id));
create table public.ps_inspections (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.ps_members(user_id),
 workspace_id uuid not null references public.ps_workspaces(id), result jsonb not null, context jsonb not null,
 created_at timestamptz not null default now(), check(jsonb_typeof(result)='object' and octet_length(result::text)<=100000)
);
create index ps_inspection_workspace on public.ps_inspections(workspace_id,created_at desc);
alter table public.ps_inspections enable row level security;
create policy ps_inspections_read on public.ps_inspections for select to authenticated using(owner_id=auth.uid() and public.ps_is_member() and exists(select 1 from public.ps_workspaces w where w.id=workspace_id and w.owner_id=auth.uid()));
revoke all on public.ps_inspections from anon,authenticated;
grant select on public.ps_inspections to authenticated;
grant all on public.ps_inspections to service_role;
create function public.ps_complete_inspection(p_user uuid,p_workspace uuid,p_result jsonb,p_context jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.ps_inspections;
begin
 if not exists(select 1 from public.ps_workspaces where id=p_workspace and owner_id=p_user) then raise exception 'NOT_FOUND'; end if;
 perform 1 from public.ps_requests where id=p_request and owner_id=p_user and workspace_id=p_workspace and status='running' and expires_at>now() for update;
 if not found then raise exception 'REQUEST_INTERRUPTED'; end if;
 insert into public.ps_inspections(owner_id,workspace_id,result,context) values(p_user,p_workspace,p_result,p_context) returning * into a;
 update public.ps_requests set status='succeeded',finished_at=now(),result=jsonb_build_object('inspection',to_jsonb(a)) where id=p_request;
 return jsonb_build_object('inspection',to_jsonb(a));
end; $$;
revoke all on function public.ps_complete_inspection(uuid,uuid,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ps_complete_inspection(uuid,uuid,jsonb,jsonb,uuid) to service_role;
create or replace function public.ps_can_read_reference(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select public.ps_is_member() and (split_part(p_path,'/',1)=auth.uid()::text or exists(select 1 from public.ps_library l where l.reference_path=p_path or exists(select 1 from jsonb_array_elements(l.reference_images) i where i->>'path'=p_path)));
$$;
create or replace function public.ps_append_version(p_user uuid,p_workspace uuid,p_parent uuid,p_bundle jsonb,p_context jsonb,p_kind text,p_request uuid default null) returns jsonb
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
   change_text=case when p_kind='restore' then coalesce(p_context->>'change','') else change_text end,
   intent=case when p_kind='restore' then coalesce(p_context->>'intent',w.intent) else intent end,
   template_id=case when p_kind='restore' then coalesce(p_context->>'template_id',w.template_id) else template_id end,
   reference_images=case when p_kind='restore' and p_context ? 'reference_images' then p_context->'reference_images' else reference_images end where id=p_workspace;
 end if;
 if p_request is not null then update public.ps_requests set status='succeeded',finished_at=now(),result=jsonb_build_object('version',to_jsonb(v),'became_current',became_current) where id=p_request; end if;
 return jsonb_build_object('version',to_jsonb(v),'became_current',became_current);
end; $$;
commit;
