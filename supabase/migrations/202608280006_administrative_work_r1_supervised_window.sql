begin;

revoke all on function public.execute_administrative_work_r1(text,jsonb,text,text,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.execute_administrative_work_r1_supervised(
  p_action text,
  p_input jsonb,
  p_idempotency_key text,
  p_actor_type text,
  p_actor_profile_id uuid,
  p_source_occurred_at timestamptz,
  p_not_before timestamptz,
  p_hard_cap integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_existing public.administrative_work_history;
  v_count integer;
  v_result jsonb;
begin
  if p_not_before is null then
    raise exception 'r1_not_before_required' using errcode='42501';
  end if;
  if p_source_occurred_at is null or p_source_occurred_at < p_not_before then
    raise exception 'r1_source_before_cutoff' using errcode='42501';
  end if;
  if p_source_occurred_at > now() + interval '5 minutes' then
    raise exception 'r1_source_time_invalid' using errcode='22023';
  end if;
  if p_hard_cap is null or p_hard_cap < 1 or p_hard_cap > 20 then
    raise exception 'r1_hard_cap_invalid' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('administrative-work-r1:' || p_not_before::text,0));

  select * into v_existing
  from public.administrative_work_history
  where idempotency_key=btrim(p_idempotency_key);
  if found then
    return jsonb_build_object(
      'idempotent',true,
      'workItemId',v_existing.work_item_id,
      'historyId',v_existing.id,
      'windowActionCount',(
        select count(*) from public.administrative_work_history
        where actor_type='ai' and created_at>=p_not_before
      )
    );
  end if;

  if p_actor_type='ai' then
    select count(*) into v_count
    from public.administrative_work_history
    where actor_type='ai' and created_at>=p_not_before;
    if v_count >= p_hard_cap then
      raise exception 'r1_hard_cap_reached' using errcode='42501';
    end if;
  end if;

  v_result := public.execute_administrative_work_r1(
    p_action,p_input,p_idempotency_key,p_actor_type,p_actor_profile_id
  );

  if p_actor_type='ai' then
    select count(*) into v_count
    from public.administrative_work_history
    where actor_type='ai' and created_at>=p_not_before;
  else
    v_count := 0;
  end if;
  return v_result || jsonb_build_object('windowActionCount',v_count,'hardCap',p_hard_cap);
end;
$$;

revoke all on function public.execute_administrative_work_r1_supervised(text,jsonb,text,text,uuid,timestamptz,timestamptz,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.execute_administrative_work_r1_supervised(text,jsonb,text,text,uuid,timestamptz,timestamptz,integer)
  to service_role;

comment on function public.execute_administrative_work_r1_supervised(text,jsonb,text,text,uuid,timestamptz,timestamptz,integer)
  is 'Frontera R1 supervisada: cutoff obligatorio, cap acumulado 20, idempotencia y cero backlog';

commit;
