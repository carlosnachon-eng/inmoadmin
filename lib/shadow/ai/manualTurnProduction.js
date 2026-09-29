import { MANUAL_PROD_MODE, MANUAL_PROD_PROMPT, assertManualProductionReadEnvironment, manualProductionRuntime } from "./manualTurnProductionPolicy.js";
import { assertManualTurnProduction, manualProductionGates, withManualProductionContext } from "./manualTurnContext.js";
import { loadManualTurn, manualMessageRef, readManualTurnRun } from "./manualTurn.js";
import { executeShadowAiStateStep } from "./stateMachine.js";
import { REAL_SHADOW_AI_SYSTEM_PROMPT } from "./realPrompt.js";
import { DEFAULT_SHADOW_AI_MODEL } from "./anthropic.js";

const ref=id=>String(id).replaceAll("-","");
const internal=ref=>{if(!/^[a-f0-9]{32}$/.test(ref||""))throw new Error("manual_reference_invalid");return ref.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,"$1-$2-$3-$4-$5");};
const fail = new Set(["admin_required","manual_prod_closed","manual_prod_expired","manual_prod_not_renewable","manual_prod_runtime_mismatch","manual_prod_reservation_reused","manual_prod_transmission_limit","manual_input_changed","manual_prod_pilot_exists"]);
const data=r=>{if(r.error)throw new Error(fail.has(r.error.message)?r.error.message:"manual_persistence_uncertain");return r.data;};
const runtimeParams=env=>{const r=manualProductionRuntime(env);return {p_runtime_sha:r.sha,p_deployment_id:r.deployment};};
const loadInput=(db,messageRef,env)=>loadManualTurn(db,messageRef,env,"shadow_manual_prod_turn_message_refs");

async function loadControl(db,authorizationRef,actor) {
  if(actor?.active!==true||actor.role_id!=="admin")throw new Error("admin_required");
  const id=internal(authorizationRef);
  const control=data(await db.from("shadow_manual_prod_turn_control").select("*").eq("authorization_id",id).single());
  const auth=data(await db.from("shadow_ai_manual_authorizations").select("*").eq("authorization_id",id).single());
  if(!control||!auth||auth.prompt_version!==MANUAL_PROD_PROMPT
    ||control.run_id!==auth.ai_run_id)throw new Error("manual_authorization_invalid");
  return {control,auth:{...auth,manual_turn_key:control.turn_key,manual_source_fingerprint:control.source_fingerprint}};
}
export async function authorizeManualProductionTurn(db,messageRef,actor,env) {
  assertManualTurnProduction(env);
  const input=await loadInput(db,messageRef,env);
  const r=data(await db.rpc("authorize_manual_shadow_prod_turn",{p_message_id:input.message.id,p_actor_id:actor.id,
    p_turn_key:input.turn.turnKey,p_fingerprint:input.fingerprint,p_snapshot:input.snapshot,
    p_model:env.SHADOW_AI_MODEL||DEFAULT_SHADOW_AI_MODEL,...runtimeParams(env),p_gates:manualProductionGates(env)}));
  return {...await readManualProductionTurn(db,ref(r.authorization_id),actor,env),created:r.created===true};
}
export async function readManualProductionTurn(db,authorizationRef,actor,env) {
  assertManualProductionReadEnvironment(env);
  const {control,auth}=await loadControl(db,authorizationRef,actor);
  const result=await readManualTurnRun(db,auth,authorizationRef,MANUAL_PROD_MODE);
  const safeRuntime={sha:/^[a-f0-9]{40}$/.test(control.runtime_sha||"")?control.runtime_sha:null,
    deployment:/^dpl_[A-Za-z0-9]{10,80}$/.test(control.deployment_id||"")?control.deployment_id:null};
  const safeDate=value=>typeof value==="string" && Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
  const gates=manualProductionGates(Object.fromEntries(Object.entries(control.gates_at_authorization||{}).map(([k,v])=>[k,v===true?"true":v===false?"false":"unknown"])));
  let window=false;try{const runtime=assertManualTurnProduction(env);window=!control.closed_at&&Date.parse(auth.expires_at)>Date.now()
    && runtime.sha===control.runtime_sha&&runtime.deployment===control.deployment_id;}catch{/* read/close survive OFF or runtime change */}
  const rounds=result.telemetry?.rounds||[];
  const transportVerified=rounds.length>=1 && rounds.length<=2 && rounds.length===control.reserved_transmissions
    && rounds.every((r,i)=>r.round===i+1 && r.receipt?.final_payload_verified===true
      && r.receipt?.serialized_body_verified===true && r.receipt?.provider_invoked===true
      && r.receipt?.output_mode==="anthropic_json_schema");
  return {...result, mode:MANUAL_PROD_MODE, runtime:safeRuntime, gates_at_authorization:gates, gates_effective:manualProductionGates(env),
    closed_at:safeDate(control.closed_at),reserved_transmissions:[0,1,2].includes(control.reserved_transmissions)?control.reserved_transmissions:null,
    ...(control.closed_at && !auth.ai_run_id?{status:"closed"}:{}),
    capabilities:{authorize:false,execute:window&&!auth.consumed_at&&auth.authorized_by===actor.id,close:!control.closed_at},
    certified:result.certified===true&&Boolean(control.closed_at)&&transportVerified
      &&result.telemetry?.message_safety?.provenance==="semantic_conversation_guard_v1"};
}
export async function readManualProductionForMessage(db,messageRef,actor,env) {
  assertManualProductionReadEnvironment(env);
  if(!/^[a-f0-9]{32}$/.test(messageRef||""))throw new Error("manual_reference_invalid");
  const control=data(await db.from("shadow_manual_prod_turn_control").select("authorization_id").eq("pilot_key","manual-prod-1of1-v1").maybeSingle());
  if(control){const result=await readManualProductionTurn(db,ref(control.authorization_id),actor,env);
    if(result.messageRef!==messageRef) return {messageRef,status:"pilot_unavailable",certified:false,capabilities:{authorize:false,execute:false,close:false}};
    return result;
  }
  let enabled=false;try{assertManualTurnProduction(env);enabled=true;}catch{/* fail closed, allow read */}
  return {messageRef,mode:MANUAL_PROD_MODE,status:"not_authorized",certified:false,human_review_required:true,outbound_authorized:false,
    gates_effective:manualProductionGates(env),capabilities:{authorize:enabled,execute:false,close:false}};
}
export async function closeManualProductionTurn(db,authorizationRef,actor,env) {
  assertManualProductionReadEnvironment(env);
  await loadControl(db,authorizationRef,actor);
  data(await db.rpc("close_manual_shadow_prod_turn",{p_authorization_id:internal(authorizationRef),p_actor_id:actor.id}));
  return readManualProductionTurn(db,authorizationRef,actor,env);
}
export async function executeManualProductionTurn(db,authorizationRef,actor,options={}) {
  const env=options.env||process.env;assertManualTurnProduction(env);
  const {control,auth}=await loadControl(db,authorizationRef,actor);
  if(auth.authorized_by!==actor.id)throw new Error("admin_required");
  if(auth.consumed_at) return {...await readManualProductionTurn(db,authorizationRef,actor,env),duplicate:true};
  const input=await loadInput(db,manualMessageRef(auth.message_id),env);
  const claim=data(await db.rpc("claim_manual_shadow_prod_turn",{p_authorization_id:auth.authorization_id,p_actor_id:actor.id,p_fingerprint:input.fingerprint,...runtimeParams(env)}));
  if(!claim.claimed)return {...await readManualProductionTurn(db,authorizationRef,actor,env),duplicate:true};
  try {
    await withManualProductionContext(env,async round=>{
      // Re-read the captured turn; never substitute a fresh snapshot for the authorized one.
      const fresh=await loadInput(db,manualMessageRef(auth.message_id),env);
      if(fresh.fingerprint!==control.source_fingerprint)throw new Error("manual_input_changed");
      data(await db.rpc("reserve_manual_shadow_prod_round",{p_authorization_id:auth.authorization_id,p_actor_id:actor.id,
        p_run_id:claim.run_id,p_round:round,p_fingerprint:fresh.fingerprint,...runtimeParams(env)}));
    },async manualTurnContext=>{
      const opts={...options,env,manualTurnContext,systemPrompt:REAL_SHADOW_AI_SYSTEM_PROMPT,promptVersion:MANUAL_PROD_PROMPT,
        validateManualProduction:async()=>{
          assertManualTurnProduction(env);
          const current=await loadControl(db,authorizationRef,actor);
          if(current.control.closed_at)throw new Error("manual_prod_closed");
          if(Date.parse(current.auth.expires_at)<=Date.now())throw new Error("manual_prod_expired");
          const fresh=await loadInput(db,manualMessageRef(auth.message_id),env);
          if(fresh.fingerprint!==control.source_fingerprint)throw new Error("manual_input_changed");
        }};
      let state=await executeShadowAiStateStep(db,claim.run_id,"created",opts);
      if(state.status==="awaiting_model_round")state=await executeShadowAiStateStep(db,claim.run_id,"awaiting_model_round",opts);
      if(state.status==="awaiting_model_round")throw new Error("manual_prod_transmission_limit");
    });
  } catch {
    const saved=await db.from("shadow_ai_runs").update({status:"error",execution_state:"error",completed_at:new Date().toISOString(),error_sanitized:"manual_result_persistence_failed"})
      .eq("id",claim.run_id).eq("status","running");
    data(saved);
  } finally {
    // Consumption is never undone. Closing is an independent, monotonic operation.
    data(await db.rpc("close_manual_shadow_prod_turn",{p_authorization_id:auth.authorization_id,p_actor_id:actor.id}));
  }
  return readManualProductionTurn(db,authorizationRef,actor,env);
}
