-- Only explicit, bounded text rules. No images, request transcripts or model training.
begin;
create table public.ps_memory (
  owner_id uuid primary key references public.ps_members(user_id),
  enabled boolean not null default false,
  rules jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  check(jsonb_typeof(rules)='array' and jsonb_array_length(rules)<=12),
  check(octet_length(rules::text)<=16384)
);
alter table public.ps_memory enable row level security;
create policy ps_memory_read on public.ps_memory for select to authenticated
using(owner_id=auth.uid() and public.ps_is_member());
revoke all on public.ps_memory from public,anon,authenticated;
grant select on public.ps_memory to authenticated;
grant all on public.ps_memory to service_role;
commit;

