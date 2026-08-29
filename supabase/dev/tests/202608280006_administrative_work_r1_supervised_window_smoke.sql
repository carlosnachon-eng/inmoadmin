begin;

do $$
declare
  v_cutoff timestamptz := clock_timestamp() - interval '1 minute';
  v_source timestamptz := clock_timestamp();
  v_result jsonb;
  v_work uuid;
  i integer;
  v_blocked boolean := false;
begin
  v_result := public.execute_administrative_work_r1_supervised(
    'create_administrative_pending',
    jsonb_build_object('domain','administrative_pending','workType','dev_r1_window','title','DEV R1 supervised fixture','dedupeKey','dev:r1:supervised:window','sourceType','internal_event','sourceId','dev:r1:supervised','nextStep','Revisar fixture DEV.'),
    'dev:r1:window:01','ai',null,v_source,v_cutoff,20
  );
  v_work := (v_result->>'workItemId')::uuid;
  for i in 2..20 loop
    perform public.execute_administrative_work_r1_supervised(
      'append_structured_internal_note',jsonb_build_object('workItemId',v_work,'note','Nota sintética DEV.'),
      'dev:r1:window:' || lpad(i::text,2,'0'),'ai',null,v_source,v_cutoff,20
    );
  end loop;
  begin
    perform public.execute_administrative_work_r1_supervised(
      'append_structured_internal_note',jsonb_build_object('workItemId',v_work,'note','No debe persistir.'),
      'dev:r1:window:21','ai',null,v_source,v_cutoff,20
    );
  exception when insufficient_privilege then
    v_blocked := sqlerrm='r1_hard_cap_reached';
  end;
  if not v_blocked then raise exception 'hard cap did not fail closed'; end if;
  begin
    perform public.execute_administrative_work_r1_supervised(
      'append_structured_internal_note',jsonb_build_object('workItemId',v_work,'note','Backlog no debe persistir.'),
      'dev:r1:window:backlog','ai',null,v_cutoff-interval '1 second',v_cutoff,20
    );
    raise exception 'backlog did not fail closed';
  exception when insufficient_privilege then
    if sqlerrm<>'r1_source_before_cutoff' then raise; end if;
  end;
  if (select count(*) from public.administrative_work_history where idempotency_key like 'dev:r1:window:%')<>20 then
    raise exception 'unexpected supervised action count';
  end if;
end $$;

rollback;
