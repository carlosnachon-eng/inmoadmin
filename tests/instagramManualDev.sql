-- Synthetic fixtures only; ALL writes rolled back, including reservations/pauses.
begin;
do $$
#variable_conflict use_variable
declare actor uuid; input text:=encode(gen_random_bytes(32),'hex'); receipt text:=encode(gen_random_bytes(32),'hex');
 action uuid:=gen_random_uuid(); lease uuid:=gen_random_uuid(); subject text:=encode(gen_random_bytes(32),'hex');
 box jsonb:=jsonb_build_object('v',1,'key_tag',repeat('a',16),'iv',repeat('b',24),'tag',repeat('c',32),'ciphertext','1234');
 row jsonb; result jsonb; denied boolean; fn record; t record;
begin
 select id into actor from public.profiles where active and role_id in ('admin','coord_operaciones') limit 1;
 if actor is null then raise exception 'fixture_requires_dev_admin';end if;
 row:=jsonb_build_object('observation_key',input,'kind','dm','native_id','fixture.'||input,'subject_ref',subject,
  'media_id',null,'parent_id',null,'occurred_at',clock_timestamp(),'provenance','customer_inbound',
  'relation_state','exact_subject','recipient_ciphertext',box);
 result:=public.observe_instagram_manual_dev_v1('17841440384433670',receipt,jsonb_build_array(row));
 assert (result->>'inserted')::int=1,'capture';
 result:=public.observe_instagram_manual_dev_v1('17841440384433670',receipt,jsonb_build_array(row));
 assert (result->>'duplicates')::int=1,'dedupe';
 assert public.instagram_manual_load_dev_v1(input,actor) is not null,'load';
 assert public.instagram_manual_load_dev_v1(input,gen_random_uuid()) is null,'unauthorized';
 assert public.instagram_manual_reserve_dev_v1(input,actor,action,lease,'Gracias.'),'reserve';
 assert public.instagram_manual_attention_dev_v1(input),'pause_before_dispatch';
 assert not exists(select 1 from instagram_manual_private.events where instagram_manual_private.events.action=action),'no_dispatch_yet';
 assert not public.instagram_manual_reserve_dev_v1(input,actor,gen_random_uuid(),gen_random_uuid(),'Otra.'),'one_input';
 assert not public.instagram_manual_finish_dev_v1(action,lease,'accepted','fixture.outbound',null),'finish_before_start';
 assert not public.instagram_manual_start_dev_v1(action,gen_random_uuid()),'wrong_lease';
 assert public.instagram_manual_start_dev_v1(action,lease),'start';
 assert not public.instagram_manual_start_dev_v1(action,lease),'start_replay';
 assert not public.instagram_manual_finish_dev_v1(action,lease,'sent',null,null),'invalid_terminal';
 assert not public.instagram_manual_finish_dev_v1(action,lease,'failed',null,'{"token":"forbidden"}'),'error_allowlist';
 assert public.instagram_manual_finish_dev_v1(action,lease,'uncertain',null,null),'uncertain_terminal';
 assert not public.instagram_manual_finish_dev_v1(action,lease,'accepted','fixture.retry',null),'terminal_replay';
 result:=public.instagram_manual_status_dev_v1(input,actor);
 assert result->>'status'='uncertain' and (result->>'paused')::boolean,'pause_survives';
 assert result->>'delivery_status' is null,'no_invented_delivery';
 assert not (result->>'delivered_supported')::boolean and not (result->>'read_supported')::boolean,'status_limits';
 denied:=false;begin update instagram_manual_private.actions set text='modified' where instagram_manual_private.actions.action=action;
 exception when raise_exception then denied:=true;end;assert denied,'immutable_update';
 denied:=false;begin delete from instagram_manual_private.attention where instagram_manual_private.attention.action=action;
 exception when raise_exception then denied:=true;end;assert denied,'immutable_delete';
 -- Prior metadata-only input stays non-recoverable: no historical backfill.
 input:=encode(gen_random_bytes(32),'hex');receipt:=encode(gen_random_bytes(32),'hex');
 row:=row||jsonb_build_object('observation_key',input,'native_id','fixture.'||input);
 perform public.observe_instagram_dev_v1('17841440384433670',receipt,jsonb_build_array(row-'recipient_ciphertext'));
 perform public.observe_instagram_manual_dev_v1('17841440384433670',receipt,jsonb_build_array(row));
 assert public.instagram_manual_load_dev_v1(input,actor) is null,'historical_blocked';
 -- Accepted remains distinct from sent. Only an exact signed echo upgrades it.
 input:=encode(gen_random_bytes(32),'hex');receipt:=encode(gen_random_bytes(32),'hex');
 action:=gen_random_uuid();lease:=gen_random_uuid();
 row:=row||jsonb_build_object('observation_key',input,'native_id','fixture.'||input);
 perform public.observe_instagram_manual_dev_v1('17841440384433670',receipt,jsonb_build_array(row));
 assert public.instagram_manual_reserve_dev_v1(input,actor,action,lease,'Recibido.'),'second_fixture_reserve';
 assert public.instagram_manual_start_dev_v1(action,lease),'second_fixture_start';
 assert public.instagram_manual_finish_dev_v1(action,lease,'accepted','fixture.outbound.'||input,null),'accepted';
 result:=public.instagram_manual_status_dev_v1(input,actor);assert result->>'delivery_status' is null,'accepted_not_sent';
 row:=(row-'recipient_ciphertext')||jsonb_build_object('observation_key',encode(gen_random_bytes(32),'hex'),
  'kind','dm_echo','native_id','fixture.outbound.'||input,'provenance','business_outbound_unattributed','subject_ref',repeat('0',64));
 perform public.observe_instagram_dev_v1('17841440384433670',encode(gen_random_bytes(32),'hex'),jsonb_build_array(row));
 result:=public.instagram_manual_status_dev_v1(input,actor);assert result->>'delivery_status' is null,'foreign_echo_ignored';
 row:=row||jsonb_build_object('observation_key',encode(gen_random_bytes(32),'hex'),'subject_ref',subject);
 perform public.observe_instagram_dev_v1('17841440384433670',encode(gen_random_bytes(32),'hex'),jsonb_build_array(row));
 result:=public.instagram_manual_status_dev_v1(input,actor);assert result->>'status'='accepted' and result->>'delivery_status'='sent','exact_echo';
 -- Same native inbound with contradictory observations is ambiguous, not a new recipient.
 input:=encode(gen_random_bytes(32),'hex');receipt:=encode(gen_random_bytes(32),'hex');
 row:=row||jsonb_build_object('observation_key',input,'native_id','fixture.'||input,'kind','dm',
   'provenance','customer_inbound','recipient_ciphertext',box,'occurred_at',clock_timestamp());
 perform public.observe_instagram_manual_dev_v1('17841440384433670',receipt,jsonb_build_array(row));
 assert public.instagram_manual_load_dev_v1(input,actor) is not null,'fresh_unique';
 row:=row||jsonb_build_object('observation_key',encode(gen_random_bytes(32),'hex'),'subject_ref',repeat('e',64));
 perform public.observe_instagram_manual_dev_v1('17841440384433670',encode(gen_random_bytes(32),'hex'),jsonb_build_array(row));
 assert public.instagram_manual_load_dev_v1(input,actor) is null,'ambiguous_native_thread';
 input:=encode(gen_random_bytes(32),'hex');
 row:=row||jsonb_build_object('observation_key',input,'native_id','fixture.'||input,'occurred_at',clock_timestamp()-interval '25 hours');
 perform public.observe_instagram_manual_dev_v1('17841440384433670',encode(gen_random_bytes(32),'hex'),jsonb_build_array(row));
 assert public.instagram_manual_load_dev_v1(input,actor) is null,'stale_window';
 for fn in select oid from pg_proc where pronamespace='public'::regnamespace and (proname like 'instagram_manual_%_dev_v1' or proname='observe_instagram_manual_dev_v1') loop
  assert not has_function_privilege('anon',fn.oid,'execute'),'anon_acl';
  assert not has_function_privilege('authenticated',fn.oid,'execute'),'authenticated_acl';
  assert has_function_privilege('service_role',fn.oid,'execute'),'service_role_rpc';
 end loop;
 for t in select oid,relrowsecurity from pg_class where relnamespace='instagram_manual_private'::regnamespace and relkind='r' loop
  assert t.relrowsecurity,'rls';
  assert not has_table_privilege('service_role',t.oid,'select,insert,update,delete'),'no_direct_access';
 end loop;
end;$$;
select 'PASS' as functional_acl_rls_append_only, 'rollback_all_fixtures' as cleanup;
rollback;
