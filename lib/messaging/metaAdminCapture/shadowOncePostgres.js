// Direct trusted PostgreSQL runner only, never a public API or receiver caller.
// No Respond/context/correlation reads and no write outside the isolated audit.
import { assessEchoSubjects } from "./echoSubject.js";
export const SHADOW_ONCE_SNAPSHOT_SQL = `
with recursive target as (
 select i.id,i.native_message_id,i.waba_id,i.phone_number_id,i.occurred_at,i.captured_at,
 i.sanitized_text,i.capture_reason,i.message_type,m.observer_only,m.state observer_state,
 c.enabled and s.enabled as enabled,s.respond_channel_id scope_channel,
 i.sender_ref subject_ref,se.key_tag
 from meta_admin_private.inbound_inputs i
 join public.meta_observer_events m on m.id=i.meta_observer_event_id
 join meta_admin_private.capture_config c on c.waba_id=i.waba_id and c.phone_number_id=i.phone_number_id
 join public.meta_observer_admin_scope s on s.waba_id=i.waba_id and s.phone_number_id=i.phone_number_id
 left join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=m.id
 where i.id=$1 and i.captured_at>=c.not_before and i.occurred_at>=c.not_before
), echo_roots as (
 select m.id from public.meta_observer_events m join target i using(waba_id,phone_number_id)
 where m.category='app_echo' and (m.occurred_at>=i.occurred_at or m.received_at>=i.captured_at)
), subject_walk(id) as (
 select id from echo_roots
 union
 select parent.id from subject_walk w
 join public.meta_observer_events m on m.id=w.id
 left join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=m.id
 join public.meta_observer_events parent on parent.waba_id=m.waba_id and parent.phone_number_id=m.phone_number_id
   and parent.category in ('inbound','app_echo')
   and parent.native_message_id in (se.context_id,m.original_message_id)
), subject_nodes as (
 select m.id event_id,m.native_message_id,m.waba_id,m.phone_number_id,m.original_message_id,
 se.subject_ref,se.key_tag,se.context_id,se.evidence_state
 from subject_walk w join public.meta_observer_events m on m.id=w.id
 left join meta_admin_private.native_subject_evidence se on se.meta_observer_event_id=m.id
 where m.observer_only and m.state='observed' limit 1001
)
select jsonb_build_object('input',to_jsonb(i)-array['enabled','scope_channel'],
 'enabled',i.enabled,'scope_channel',i.scope_channel,'checked_at',clock_timestamp(),
 'identity',public.resolve_meta_admin_identity_v1(i.id),
 'latest_received_at',(select max(m.received_at) from public.meta_observer_events m
   where m.waba_id=i.waba_id and m.phone_number_id=i.phone_number_id),
 'mutated',exists(select 1 from public.meta_observer_events m where m.waba_id=i.waba_id
   and m.phone_number_id=i.phone_number_id and m.original_message_id=i.native_message_id),
 'later_scope_echoes',(select count(*) from echo_roots),
 'echo_roots',coalesce((select jsonb_agg(id) from echo_roots),'[]'::jsonb),
 'subject_nodes',coalesce((select jsonb_agg(to_jsonb(n)) from subject_nodes n),'[]'::jsonb),
 'later_scope_uncertain',(select count(*) from public.meta_observer_events m
   where m.waba_id=i.waba_id and m.phone_number_id=i.phone_number_id
   and (m.occurred_at>=i.occurred_at or m.received_at>=i.captured_at)
   and (m.state<>'observed' or not m.observer_only or cardinality(m.error_codes)>0))
) snapshot from target i`;

export function createShadowOncePostgresStore(client, { readTransportHealth } = {}) {
  return {
    async snapshot(inputId) {
      const result = await client.query(SHADOW_ONCE_SNAPSHOT_SQL, [inputId]);
      const snapshot = result.rows[0]?.snapshot;
      if (!snapshot) return null;
      snapshot.echo_assessments = snapshot.subject_nodes.length > 1000 ? null
        : assessEchoSubjects(snapshot.input, snapshot.echo_roots, snapshot.subject_nodes);
      delete snapshot.echo_roots;
      delete snapshot.subject_nodes;
      // Recent DB activity is not alone proof of current transport health.
      snapshot.transport_health = readTransportHealth ? await readTransportHealth() : { status: "unknown" };
      return snapshot;
    },
    async claim({ inputId, token, fingerprint, identityState, provider, model }) {
      const r = await client.query(`insert into meta_admin_private.shadow_once_runs
        (input_id,claim_token,input_fingerprint,identity_state,provider,model)
        values($1,$2,$3,$4,$5,$6) on conflict(input_id) do nothing returning input_id`,
      [inputId,token,fingerprint,identityState,provider,model]);
      return r.rowCount === 1;
    },
    async start({ inputId, token }) {
      const r = await client.query(`update meta_admin_private.shadow_once_runs
        set status='model_started',model_calls=1,model_started_at=clock_timestamp()
        where input_id=$1 and claim_token=$2 and status='claimed' and model_calls=0 returning input_id`, [inputId,token]);
      return r.rowCount === 1;
    },
    async finish({ inputId, token, status, reason, run_id=null, proposed_response=null }) {
      const r = await client.query(`update meta_admin_private.shadow_once_runs
        set status=$3,reason=$4,run_id=$5,proposed_response=$6,finished_at=clock_timestamp()
        where input_id=$1 and claim_token=$2 and status in ('claimed','model_started') returning input_id`,
      [inputId,token,status,reason,run_id,proposed_response]);
      if (r.rowCount !== 1) throw new Error("shadow_once_finalize_cas_failed");
    },
  };
}
