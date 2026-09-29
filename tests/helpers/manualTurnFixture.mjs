import { randomUUID } from "node:crypto";
import { MANUAL_TURN_OFF_GATES, MANUAL_TURN_PROMPT, MANUAL_TURN_MODE } from "../../lib/shadow/ai/manualTurnContext.js";
import { manualMessageRef } from "../../lib/shadow/ai/manualTurn.js";
export const manualEnv={...Object.fromEntries(MANUAL_TURN_OFF_GATES.map(k=>[k,"false"])),
  NEXT_PUBLIC_SUPABASE_URL:"https://hjfwjnejbcpmknvfpdcq.supabase.co",SHADOW_MANUAL_TURN_DEV_ENABLED:"true",
  SHADOW_CONVERSATION_ACTIONS_ENABLED:"true",SHADOW_AI_OUTPUT_MODE:"anthropic_json_schema",ANTHROPIC_API_KEY:"synthetic-only"};
export const manualDecision={intent:"mantenimiento",secondaryIntents:[],urgency:"normal",summary:"Consulta de mantenimiento",
  entitiesMentioned:[],resolvedEntities:[],entityResolutionStatus:"unresolved",informationNeeded:[],proposedToolCalls:[],
  contextAssessment:"Falta contexto verificable",proposedAction:"Pedir aclaración",factualClaims:[],
  conversationalResponseParts:{acknowledgement:"Entiendo.",verifiedFactReferences:[],clarificationQuestion:"¿Qué falla presenta?",escalationMessage:null},
  executionCommitment:"none",confidence:.8,requiresHuman:true,escalationReason:"Revisión necesaria",safetyFlags:[]};
export const syntheticResponse=(decision=manualDecision)=>({ok:true,json:async()=>({id:"synthetic-provider",model:"claude-haiku-4-5-20251001",usage:{input_tokens:31,output_tokens:7},content:[{type:"text",text:JSON.stringify(decision)}]})});

export function manualMemory({text="¿Me ayudan con el mantenimiento?"}={}) {
  const actor={id:randomUUID(),role_id:"admin",active:true},messageId=randomUUID(),conversationId=randomUUID();
  const tables={profiles:[actor],shadow_messages:[{id:messageId,conversation_id:conversationId,provider:"respond_admin",direction:"inbound",occurred_at:new Date(Date.now()-600000).toISOString(),sanitized_text:text,attachment_metadata:[],provider_metadata:{},external_message_id:"manual-turn-captured"}],
    shadow_conversations:[{id:conversationId,provider:"respond_admin",channel:"544519",respond_contact_id:"123456"}],
    shadow_manual_turn_message_refs:[{id:messageId,message_ref:manualMessageRef(messageId)}],
    shadow_ai_manual_authorizations:[],shadow_ai_runs:[],shadow_ai_decisions:[],shadow_conversation_actions:[]};
  const writes=[];let rpcCount=0;
  const db={tables,writes,failTable:null,from(table){let filters=[],one=false,limit=Infinity,operation="read",patch,cols="*";
    const q={select(c="*"){cols=c;return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},in(k,vs){filters.push(r=>vs.includes(r[k]));return q;},neq(k,v){filters.push(r=>r[k]!==v);return q;},is(k,v){filters.push(r=>r[k]===v);return q;},order(){return q;},limit(n){limit=n;return q;},single(){one=true;return q;},maybeSingle(){one=true;return q;},
      insert(v){operation="insert";patch=v;return q;},update(v){operation="update";patch=v;return q;},upsert(){throw new Error("forbidden");},delete(){throw new Error("forbidden");},then(ok,bad){
        if(db.failTable===table&&operation!=="read")return Promise.resolve({data:null,error:{code:"synthetic_storage_failure"}}).then(ok,bad);
        let rows=(tables[table]||[]).filter(r=>filters.every(f=>f(r))).slice(0,limit);
        if(operation==="insert"){const row={id:randomUUID(),...structuredClone(patch)};(tables[table]||=[]).push(row);rows=[row];writes.push({table,operation});}
        if(operation==="update"){rows.forEach(r=>Object.assign(r,structuredClone(patch)));writes.push({table,operation});}
        const result=structuredClone(rows).map(r=>cols==="*"?r:Object.fromEntries(cols.split(",").map(k=>[k,r[k]])));
        return Promise.resolve({data:one?result[0]||null:result,error:null}).then(ok,bad);
      }};return q;},
    async rpc(name,p){rpcCount++;if(!tables.profiles.some(x=>x.id===p.p_actor_id&&x.active&&x.role_id==="admin"))return {error:{code:"admin_required"}};
      if(name==="authorize_manual_shadow_turn"){
        const prior=tables.shadow_ai_manual_authorizations.find(a=>a.manual_turn_key===p.p_turn_key);
        if(prior)return prior.consumed_at?{error:{code:"not_renewable"}}:{data:{authorization_id:prior.authorization_id,created:false}};
        const a={authorization_id:randomUUID(),message_id:p.p_message_id,authorized_by:p.p_actor_id,manual_turn_key:p.p_turn_key,manual_source_fingerprint:p.p_fingerprint,manual_input_snapshot:p.p_snapshot,model:p.p_model,prompt_version:MANUAL_TURN_PROMPT,expires_at:new Date(Date.now()+600000).toISOString(),consumed_at:null};
        tables.shadow_ai_manual_authorizations.push(a);return {data:{authorization_id:a.authorization_id,created:true}};
      }
      if(name!=="claim_manual_shadow_turn")throw new Error("unexpected_rpc");
      const a=tables.shadow_ai_manual_authorizations.find(a=>a.authorization_id===p.p_authorization_id);
      if(a.consumed_at)return {data:{claimed:false,run_id:a.ai_run_id}};
      if(a.manual_source_fingerprint!==p.p_fingerprint)return {error:{code:"changed"}};
      const r={id:randomUUID(),message_id:a.message_id,status:"running",execution_state:"created",current_round:0,max_rounds:2,model:a.model,prompt_version:a.prompt_version,started_at:new Date().toISOString(),deadline_at:new Date(Date.now()+105000).toISOString(),round_state_json:{inputSnapshot:a.manual_input_snapshot,rounds:[]},telemetry_json:{input_mode:MANUAL_TURN_MODE,turn_key:a.manual_turn_key},tool_results_json:[]};
      tables.shadow_ai_runs.push(r);a.consumed_at=new Date().toISOString();a.ai_run_id=r.id;return {data:{claimed:true,run_id:r.id}};
    },get rpcCount(){return rpcCount;}};
  return {db,actor,messageRef:manualMessageRef(messageId),messageId};
}
