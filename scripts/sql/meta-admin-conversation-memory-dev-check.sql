-- DEV ONLY. Transaction rollback is fixture cleanup; never resets durable history.
begin;
set local role service_role;
do $$
declare e jsonb:=jsonb_build_object('id','episode_'||repeat('d',32),'subject','subject_'||repeat('d',64),
 'identityFingerprint',null,'scope','{}'::jsonb,'family','payments','topic','payments','version',1,
 'status','open','pending','verification','commitment','none','contradiction',false,'sourceRefs',jsonb_build_array('message_'||repeat('d',32)));
 r jsonb; denied boolean;
begin
 if jsonb_array_length(public.meta_admin_memory_read_v1(e->>'subject'))<>0 then raise exception 'fixture_collision'; end if;
 r:=public.meta_admin_memory_append_v1(e,0,'message_'||repeat('d',32));
 if r->>'status'<>'appended' then raise exception 'append_failed'; end if;
 r:=public.meta_admin_memory_append_v1(e,0,'message_'||repeat('d',32));
 if r->>'status'<>'duplicate' then raise exception 'idempotency_failed'; end if;
 if jsonb_array_length(public.meta_admin_memory_read_v1(e->>'subject'))<>1 then raise exception 'read_failed'; end if;
 denied:=false;begin
  perform public.meta_admin_memory_append_v1(e||'{"pending":"visit"}'::jsonb,0,'message_'||repeat('d',32));
 exception when others then if sqlerrm<>'memory_replay_conflict' then raise; end if;denied:=true;end;
 if not denied then raise exception 'conflict_not_blocked'; end if;
 denied:=false;begin
  perform public.meta_admin_memory_append_v1(e||jsonb_build_object('version',2,'sourceRefs',jsonb_build_array('message_'||repeat('d',32),'message_'||repeat('e',32))),0,'message_'||repeat('e',32));
 exception when others then if sqlerrm<>'memory_version_invalid' then raise; end if;denied:=true;end;
 if not denied then raise exception 'version_not_blocked'; end if;
 denied:=false;begin perform 1 from meta_admin_memory_private.episodes;
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'direct_access_allowed'; end if;
end $$;
reset role;
rollback;
select 'PASS' as rpc_dev_checks,
 (select count(*) from meta_admin_memory_private.episodes where subject='subject_'||repeat('d',64)) as fixture_residue,
 (select count(*) from meta_admin_memory_private.revisions where episode_id='episode_'||repeat('d',32)) as revision_residue;
