-- Read-only aggregates for existing application administrators. No private content is returned.
begin;
create function public.ps_member_usage(p_admin uuid, p_period text default 'today')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  report_at timestamptz := statement_timestamp();
  day_start timestamptz;
  period_start timestamptz;
  member_counts jsonb;
begin
  if not exists(select 1 from public.ps_members where user_id=p_admin and active and role='admin') then
    raise exception 'FORBIDDEN';
  end if;
  if p_period is null or p_period not in ('today','7d','30d','all') then
    raise exception 'INVALID_REQUEST';
  end if;
  day_start := date_trunc('day',report_at at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai';
  period_start := case p_period when 'today' then day_start when '7d' then day_start - interval '6 days'
    when '30d' then day_start - interval '29 days' else null end;
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId',s.user_id,'requests',s.requests,'generations',s.generations,
    'generationSucceeded',s.generation_succeeded,'generationFailed',s.generation_failed,
    'generationRunning',s.generation_running,'polish',s.polish,'analysis',s.analysis,
    'lastRequestAt',s.last_request_at
  ) order by s.user_id),'[]'::jsonb) into member_counts
  from (
    select m.user_id,count(r.id) as requests,
      count(r.id) filter(where r.action in ('text.optimize','reference.extract','reference.rewrite')) as generations,
      count(r.id) filter(where r.action in ('text.optimize','reference.extract','reference.rewrite') and r.status='succeeded') as generation_succeeded,
      count(r.id) filter(where r.action in ('text.optimize','reference.extract','reference.rewrite') and
        (r.status='failed' or (r.status='running' and r.expires_at<=report_at))) as generation_failed,
      count(r.id) filter(where r.action in ('text.optimize','reference.extract','reference.rewrite') and
        r.status='running' and r.expires_at>report_at) as generation_running,
      count(r.id) filter(where r.action='prompt.polish') as polish,
      count(r.id) filter(where r.action in ('prompt.inspect','prompt.evaluate')) as analysis,
      max(r.created_at) as last_request_at
    from public.ps_members m left join public.ps_requests r on r.owner_id=m.user_id
      and r.action in ('text.optimize','reference.extract','reference.rewrite','prompt.polish','prompt.inspect','prompt.evaluate')
      and (period_start is null or r.created_at>=period_start) and r.created_at<=report_at
    group by m.user_id
  ) s;
  return jsonb_build_object('period',p_period,'from',period_start,'asOf',report_at,'timeZone','Asia/Shanghai','members',member_counts);
end; $$;
-- Browser roles cannot call this service RPC or pass a different administrator identity.
revoke all on function public.ps_member_usage(uuid,text) from public,anon,authenticated;
grant execute on function public.ps_member_usage(uuid,text) to service_role;
commit;
