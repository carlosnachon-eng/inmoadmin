-- RUN ONLY AFTER explicit authorization and project identity verification.
-- Scoped to the NEW comment-review module, never operational DM/WhatsApp tables.
-- Non-destructive rollback: preserve events, approvals, attribution and ciphertext.
begin;
do $$
declare signature text; target regprocedure;
begin
 if to_regclass('commercial_comment_private.connections') is not null then
  execute 'update commercial_comment_private.connections set sender_enabled=false,active=false';
 end if;
 foreach signature in array array[
  'public.comment_action_v1(text,uuid,uuid,text,text,uuid,text)',
  'public.comment_review_v1(text,uuid,uuid,text,jsonb)',
  'public.comment_bridge_request_v1(uuid,uuid,uuid,bigint)',
  'public.comment_property_link_v1(text,uuid,uuid,text,jsonb)',
  'public.comment_observation_v1(text,uuid,uuid,text,jsonb)'
 ] loop
  target:=to_regprocedure(signature);
  if target is not null then
   execute format('revoke execute on function %s from public,anon,authenticated,service_role',target);
  end if;
 end loop;
end $$;
commit;
-- Restore the previous application deployment separately; retain all schemas/data.
-- Do not drop tables, roll back unrelated migrations, rotate keys or retry Meta.
