import { assessEchoSubjects } from './echoSubject.js';

// Fixed service-role RPCs; never expose the private schema through REST.
export function createShadowOnceSupabaseStore(client) {
  const rpc = async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw Error('shadow_journal_unavailable');
    return data;
  };
  return {
    async snapshot(inputId) {
      const s = await rpc('meta_admin_shadow_snapshot_v1', { p_input_id:inputId });
      if (!s) return null;
      const paused=await rpc('meta_admin_manual_attention_v1',{p_input_id:inputId});
      if(typeof paused!=='boolean')throw Error('manual_attention_unknown');
      s.manual_attention=paused;
      s.echo_assessments = Array.isArray(s.subject_nodes) && s.subject_nodes.length <= 1000
        ? assessEchoSubjects(s.input, s.echo_roots, s.subject_nodes) : null;
      delete s.echo_roots; delete s.subject_nodes;
      s.transport_health = { status:'unknown', reason:'diagnostic_not_requested' };
      return s;
    },
    async claim(a) {
      return await rpc('meta_admin_shadow_claim_v1', {p_input_id:a.inputId,p_token:a.token,
        p_fingerprint:a.fingerprint,p_identity:a.identityState,p_provider:a.provider,p_model:a.model}) === true;
    },
    async start(a) {
      return await rpc('meta_admin_shadow_start_v1', {p_input_id:a.inputId,p_token:a.token}) === true;
    },
    async startAdminModel(a) {
      return await rpc('meta_admin_shadow_admin_model_start_v1', {p_input_id:a.inputId,p_token:a.token}) === true;
    },
    async finish(a) {
      if (await rpc('meta_admin_shadow_finish_v1', {p_input_id:a.inputId,p_token:a.token,p_status:a.status,
        p_reason:a.reason,p_run_id:a.run_id ?? null,p_proposal:a.proposed_response ?? null}) !== true)
        throw Error('shadow_finalize_cas_failed');
    },
  };
}
