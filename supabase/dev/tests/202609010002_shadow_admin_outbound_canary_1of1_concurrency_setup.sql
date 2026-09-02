do $$
declare
  v_contact_id text := 'canary-dev-contact-'||replace(gen_random_uuid()::text,'-','');
  v_identity_id uuid := gen_random_uuid();
  v_profile_id uuid;
  v_canary_id uuid;
  v_conversation_id uuid := gen_random_uuid();
  v_message_id uuid := gen_random_uuid();
  v_run_id uuid := gen_random_uuid();
  v_cutoff timestamptz := clock_timestamp();
  v_suffix text := replace(gen_random_uuid()::text,'-','');
begin
  select id into v_profile_id from public.profiles where active=true order by created_at limit 1;
  if v_profile_id is null then raise exception 'dev_active_profile_fixture_missing'; end if;

  insert into public.client_identities(id,status) values(v_identity_id,'active');
  insert into public.respond_identity_links(
    respond_contact_id,client_identity_id,link_status,link_source,confidence,reason_code,
    confirmed_by,confirmed_at
  ) values(
    v_contact_id,v_identity_id,'confirmed','exact_phone_unique',0.990,'synthetic_canary_dev',
    v_profile_id,v_cutoff
  );

  select public.arm_shadow_admin_outbound_canary(v_cutoff) into v_canary_id;

  insert into public.shadow_conversations(
    id,provider,external_conversation_id,contact_hash,channel,respond_contact_id,
    first_message_at,last_message_at,administrative_likelihood,status
  ) values(
    v_conversation_id,'respond_admin','canary-dev-'||v_suffix,repeat('a',64),'544519',v_contact_id,
    v_cutoff + interval '10 milliseconds',v_cutoff + interval '10 milliseconds','high','active'
  );

  insert into public.shadow_messages(
    id,conversation_id,provider,external_message_id,direction,occurred_at,sanitized_text,
    content_hash,message_type,processing_state,intent,administrative_likelihood,requires_human
  ) values(
    v_message_id,v_conversation_id,'respond_admin','canary-dev-message-'||v_suffix,'inbound',
    v_cutoff + interval '10 milliseconds','Hola, les paso mi correo: [EMAIL]',
    repeat('b',64),'text','classified','no_determinado','high',false
  );

  insert into public.shadow_ai_runs(id,message_id,status)
  values(v_run_id,v_message_id,'not_executed');

  insert into public.shadow_conversation_actions(
    ai_run_id,message_id,conversation_id,turn_key,case_domain,conversation_action,question_type,
    status,proposed_message,evidence_refs,confidence,requires_human,auto_send_eligible,
    interaction_direction,expires_at,created_at,updated_at
  ) values(
    v_run_id,v_message_id,v_conversation_id,'canarydev'||v_suffix,'administrative_pending',
    'acknowledge_received_information','acknowledge_received_information','proposed',
    'Gracias, recibí la información que compartiste.','["synthetic:canary-dev"]'::jsonb,
    0.940,false,true,'inbound_customer_action',v_cutoff + interval '1 hour',
    v_cutoff + interval '10 milliseconds',v_cutoff + interval '10 milliseconds'
  );
end $$;

select id as canary_id,not_before,status,max_claims,claimed_count,allowed_action
from public.shadow_admin_outbound_canaries
where status='open'
order by created_at desc
limit 1;
