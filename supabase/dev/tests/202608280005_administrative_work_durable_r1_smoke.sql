-- DEV hjfwjnejbcpmknvfpdcq only. Synthetic fixture; no PII.
do $$
declare
  v_actor uuid;
  v_work uuid;
  v_result jsonb;
begin
  select id into v_actor from public.profiles where active=true and role_id in ('admin','coord_operaciones') order by id limit 1;
  if v_actor is null then raise exception 'DEV admin fixture missing'; end if;

  v_result := public.execute_administrative_work_r1('create_administrative_pending', jsonb_build_object(
    'domain','maintenance','workType','synthetic_maintenance_followup','title','Fixture DEV · seguimiento de humedad',
    'priority','P2','primarySourceType','internal_event','sourceType','internal_event','sourceId','dev_fixture_work_r1',
    'dedupeKey','dev:admin-work-r1:maintenance:001','nextStep','Validar información recibida'
  ), 'dev:admin-work-r1:create:001', 'human', v_actor);
  v_work := (v_result->>'workItemId')::uuid;

  perform public.execute_administrative_work_r1('append_structured_internal_note',jsonb_build_object('workItemId',v_work,'reason','Nota sintética sin PII'),'dev:admin-work-r1:note:001','human',v_actor);
  perform public.execute_administrative_work_r1('link_received_evidence',jsonb_build_object('workItemId',v_work,'evidenceType','image','referenceType','operational_event','referenceId','dev_fixture_evidence','evidenceKey','dev:admin-work-r1:evidence:001','summarySafe','Imagen sintética recibida'),'dev:admin-work-r1:evidence-history:001','human',v_actor);
  perform public.execute_administrative_work_r1('mark_information_received',jsonb_build_object('workItemId',v_work),'dev:admin-work-r1:received:001','human',v_actor);
  perform public.execute_administrative_work_r1('set_nonfinancial_next_step',jsonb_build_object('workItemId',v_work,'nextStep','Revisión administrativa no financiera'),'dev:admin-work-r1:next:001','human',v_actor);
  perform public.execute_administrative_work_r1('schedule_nonfinancial_follow_up',jsonb_build_object('workItemId',v_work,'followUpAt',now()+interval '2 days'),'dev:admin-work-r1:followup:001','human',v_actor);
  perform public.execute_administrative_work_r1('assign_operational_responsible',jsonb_build_object('workItemId',v_work,'responsibleProfileId',v_actor),'dev:admin-work-r1:owner:001','human',v_actor);

  if (select count(*) from public.administrative_work_items where dedupe_key='dev:admin-work-r1:maintenance:001')<>1 then raise exception 'work idempotency failed'; end if;
  if (select count(*) from public.administrative_work_evidence where evidence_key='dev:admin-work-r1:evidence:001')<>1 then raise exception 'evidence idempotency failed'; end if;
  if (select count(*) from public.administrative_work_history where work_item_id=v_work)<>7 then raise exception 'history audit incomplete'; end if;
  begin
    perform public.execute_administrative_work_r1('set_nonfinancial_next_step',jsonb_build_object('workItemId',v_work,'nextStep','Pago confirmado'),'dev:admin-work-r1:blocked:001','human',v_actor);
    raise exception 'financial guard failed';
  exception when insufficient_privilege then null;
  end;
end $$;
