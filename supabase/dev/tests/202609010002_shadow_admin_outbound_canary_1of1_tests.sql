begin;

do $$
declare
  v_canary_id uuid;
  v_status text;
  v_outbound_before bigint;
begin
  select count(*) into v_outbound_before from public.shadow_admin_outbound_messages;
  select public.arm_shadow_admin_outbound_canary(now()) into v_canary_id;

  select status into v_status from public.shadow_admin_outbound_canaries where id=v_canary_id;
  if v_status <> 'open' then raise exception 'armed canary must be open'; end if;

  perform public.disable_shadow_admin_outbound_canary(v_canary_id,'preflight_abort');
  select status into v_status from public.shadow_admin_outbound_canaries where id=v_canary_id;
  if v_status <> 'disabled' then raise exception 'kill switch must close canary immediately'; end if;
  if (
    select count(*) from public.claim_shadow_admin_outbound_canary(
      'canary-disabled-worker',v_canary_id,(select not_before from public.shadow_admin_outbound_canaries where id=v_canary_id)
    )
  ) <> 0 then raise exception 'disabled canary must reject claims'; end if;

  if (select count(*) from public.shadow_admin_outbound_messages) <> v_outbound_before then
    raise exception 'arm/disable must not create outbound claims';
  end if;
end $$;

rollback;
