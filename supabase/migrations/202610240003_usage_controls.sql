-- Application request counts are independent of provider balances.
-- Zero disables daily caps. Keep concurrency, membership and idempotency checks.
begin;
alter table public.ps_settings drop constraint ps_settings_member_daily_check;
alter table public.ps_settings drop constraint ps_settings_team_daily_check;
alter table public.ps_members drop constraint ps_members_daily_limit_check;
alter table public.ps_settings add constraint ps_settings_member_daily_check check(member_daily between 0 and 10000);
alter table public.ps_settings add constraint ps_settings_team_daily_check check(team_daily between 0 and 100000);
alter table public.ps_members add constraint ps_members_daily_limit_check check(daily_limit between 0 and 10000);
alter table public.ps_settings alter column member_daily set default 0;
alter table public.ps_settings alter column team_daily set default 0;
update public.ps_settings set member_daily=0,team_daily=0;
update public.ps_members set daily_limit=null;

create or replace function public.ps_begin_request(p_id uuid,p_user uuid,p_workspace uuid,p_action text,p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.ps_members; s public.ps_settings; existing public.ps_requests; day_start timestamptz; member_cap integer;
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
 member_cap := coalesce(m.daily_limit,s.member_daily);
 if (member_cap>0 and (select count(*) from public.ps_requests where created_at>=day_start and owner_id=p_user)>=member_cap)
   or (s.team_daily>0 and (select count(*) from public.ps_requests where created_at>=day_start)>=s.team_daily) then raise exception 'DAILY_LIMIT'; end if;
 if (select count(*) from public.ps_requests where status='running' and owner_id=p_user)>=s.user_concurrent
   or (select count(*) from public.ps_requests where status='running')>=s.team_concurrent then raise exception 'BUSY'; end if;
 insert into public.ps_requests(id,owner_id,workspace_id,action,payload_hash) values(p_id,p_user,p_workspace,p_action,p_hash);
 return jsonb_build_object('accepted',true);
end; $$;
revoke all on function public.ps_begin_request(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.ps_begin_request(uuid,uuid,uuid,text,text) to service_role;
commit;

