import { manualMemory,manualEnv } from './manualTurnFixture.mjs';
import { MANUAL_PROD_MODE,MANUAL_PROD_PROMPT,MANUAL_PROD_GATE } from '../../lib/shadow/ai/manualTurnProductionPolicy.js';
export const productionEnv={...manualEnv,VERCEL_ENV:'production',SUPABASE_ENVIRONMENT:'production',
  NEXT_PUBLIC_SUPABASE_URL:'https://bnzrnizrmonjxlktbhlp.supabase.co',SHADOW_MANUAL_TURN_DEV_ENABLED:'false',
  [MANUAL_PROD_GATE]:'true',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),VERCEL_DEPLOYMENT_ID:'dpl_SyntheticSandboxOnly'};

// Memory adapter for unit faults only. Native SQL/concurrency is certified by
// scripts/test-manual-shadow-production-postgres.mjs, not inferred here.
export function productionMemory(options) {
  const f=manualMemory(options),{db}=f,baseRpc=db.rpc.bind(db);
  db.tables.shadow_manual_prod_turn_message_refs=db.tables.shadow_manual_turn_message_refs;
  db.tables.shadow_manual_prod_turn_control=[];
  db.calls=[];
  db.rpc=async(name,p)=>{
    db.calls.push({name,round:p.p_round});
    const failure=message=>({error:{message}}),t=db.tables;
    if(!t.profiles.some(a=>a.id===p.p_actor_id&&a.active&&a.role_id==='admin'))return failure('admin_required');
    const c=t.shadow_manual_prod_turn_control[0];
    if(name==='authorize_manual_shadow_prod_turn'){
      if(c)return c.closed_at||t.shadow_ai_manual_authorizations[0].consumed_at?failure('manual_prod_not_renewable'):
        c.source_fingerprint!==p.p_fingerprint?failure('manual_prod_pilot_exists'):{data:{authorization_id:c.authorization_id,created:false}};
      const r=await baseRpc('authorize_manual_shadow_turn',p),a=t.shadow_ai_manual_authorizations[0];
      a.prompt_version=MANUAL_PROD_PROMPT;a.ai_run_id=null;a.revoked_at=null;
      t.shadow_manual_prod_turn_control.push({pilot_key:'manual-prod-1of1-v1',authorization_id:a.authorization_id,run_id:null,turn_key:p.p_turn_key,
        source_fingerprint:p.p_fingerprint,input_snapshot:p.p_snapshot,runtime_sha:p.p_runtime_sha,deployment_id:p.p_deployment_id,gates_at_authorization:p.p_gates,reserved_transmissions:0,closed_at:null});
      return r;
    }
    if(!c)return failure('manual_authorization_invalid');
    const a=t.shadow_ai_manual_authorizations[0];
    if(name==='close_manual_shadow_prod_turn'){c.closed_at||=new Date().toISOString();return {data:{closed:true,closed_at:c.closed_at}};}
    if(p.p_runtime_sha!==c.runtime_sha||p.p_deployment_id!==c.deployment_id)return failure('manual_prod_runtime_mismatch');
    if(name==='claim_manual_shadow_prod_turn'&&a.consumed_at)return {data:{claimed:false,run_id:a.ai_run_id}};
    if(c.closed_at)return failure('manual_prod_closed');
    if(p.p_fingerprint!==c.source_fingerprint)return failure('manual_input_changed');
    if(name==='claim_manual_shadow_prod_turn'){
      const r=await baseRpc('claim_manual_shadow_turn',p);c.run_id=r.data.run_id;
      t.shadow_ai_runs[0].telemetry_json.input_mode=MANUAL_PROD_MODE;
      return r;
    }
    if(name==='reserve_manual_shadow_prod_round'){
      if(![1,2].includes(p.p_round))return failure('manual_prod_transmission_limit');
      if(c.reserved_transmissions+1!==p.p_round)return failure('manual_prod_reservation_reused');
      c.reserved_transmissions=p.p_round;return {data:{reserved:true,round:p.p_round}};
    }
    throw Error('unexpected_fixture_rpc');
  };
  return f;
}
