// Disposable native-PG sandbox adapter; never a production/Supabase connector.
// Auth is synthetic, profile authority and persistence use PostgreSQL.
export const bootstrap = `
create table profiles(id uuid primary key,role_id text,active boolean);
create table shadow_conversations(id uuid primary key,provider text,channel text,respond_contact_id text);
create table shadow_messages(id uuid primary key,conversation_id uuid references shadow_conversations,provider text,direction text,occurred_at timestamptz,sanitized_text text,attachment_metadata jsonb,provider_metadata jsonb,external_message_id text);
create table shadow_ai_runs(id uuid primary key default gen_random_uuid(),message_id uuid references shadow_messages,status text,execution_state text,model text,prompt_version text,schema_version text,started_at timestamptz,deadline_at timestamptz,idempotency_key text unique,attempt_number int,current_round int,max_rounds int,round_state_json jsonb,telemetry_json jsonb,input_kind text default 'conversational_message',operational_event_id uuid,campaign_id uuid,state_updated_at timestamptz,completed_at timestamptz,error_sanitized text,input_tokens int,output_tokens int,estimated_cost_usd numeric,latency_ms int,evidence_ledger jsonb,tool_results_json jsonb,grounding_state_json jsonb,retry_of_run_id uuid);
create table shadow_ai_decisions(id uuid primary key default gen_random_uuid(),ai_run_id uuid unique references shadow_ai_runs,status text,intent text,urgency text,proposed_action text,proposed_response text,confidence numeric,requires_human boolean,escalation_reason text,decision_json jsonb,tool_summary jsonb);
create table shadow_conversation_actions(id uuid primary key default gen_random_uuid(),ai_run_id uuid references shadow_ai_runs,message_id uuid references shadow_messages,conversation_id uuid references shadow_conversations,turn_key text,status text,case_domain text,conversation_action text,question_type text,proposed_message text,evidence_refs jsonb,confidence numeric,requires_human boolean,auto_send_eligible boolean,interaction_direction text,operational_follow_up text,blocked_reason text,expires_at timestamptz,superseded_by_message_id uuid,superseded_at timestamptz);
create unique index shadow_conversation_actions_turn_uidx on shadow_conversation_actions(turn_key);
create table shadow_admin_outbound_messages(id uuid primary key default gen_random_uuid(),conversation_action_id uuid references shadow_conversation_actions);
create table respond_identity_links(id uuid primary key,respond_contact_id text,client_identity_id uuid,link_status text,link_source text,created_at timestamptz,confidence numeric,confirmed_at timestamptz);
create table respond_identity_audit(id uuid primary key default gen_random_uuid(),respond_contact_id text,event_type text,conflict_count int);
create function shadow_authorized_role() returns boolean language sql as 'select false';
grant usage on schema public to service_role,anon,authenticated;
grant all on all tables in schema public to service_role;
`;
const identifier=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw Error('sandbox_identifier');return '"'+s+'"';};
const normalize=x=>JSON.parse(JSON.stringify(x));
const wire=x=>x!==null&&typeof x==='object'?JSON.stringify(x):x;
export function nativeAdapter(client){
 const writes=[],calls=[],errors=[];
 return {writes,calls,errors,from(table){let op='select',cols='*',patch,filters=[],params=[],ordering=[],lim=null,one=false;
   const bind=v=>{params.push(wire(v));return '$'+params.length;};
   const q={select(v='*'){cols=v;return q;},eq(k,v){filters.push(identifier(k)+'='+bind(v));return q;},neq(k,v){filters.push(identifier(k)+'<>'+bind(v));return q;},is(k,v){if(v!==null)throw Error('sandbox_is');filters.push(identifier(k)+' is null');return q;},in(k,vs){filters.push(vs.length?identifier(k)+' in ('+vs.map(bind).join(',')+')':'false');return q;},order(k,o={}){ordering.push(identifier(k)+(o.ascending===false?' desc':' asc'));return q;},limit(n){lim=Number(n);return q;},single(){one=true;return q;},maybeSingle(){one=true;return q;},insert(v){op='insert';patch=v;return q;},update(v){op='update';patch=v;return q;},delete(){throw Error('sandbox_delete_forbidden');},upsert(){throw Error('sandbox_upsert_forbidden');},then(ok,bad){return (async()=>{try{
     const fields=cols==='*'?'*':cols.split(',').map(identifier).join(',');
     const where=filters.length?' where '+filters.join(' and '):'';
     let sql;
     if(op==='select')sql='select '+fields+' from '+identifier(table)+where+(ordering.length?' order by '+ordering.join(','):'')+(lim!==null?' limit '+lim:'');
     if(op==='insert'){const keys=Object.keys(patch);sql='insert into '+identifier(table)+'('+keys.map(identifier).join(',')+') values('+keys.map(k=>bind(patch[k])).join(',')+') returning '+fields;}
     if(op==='update')sql='update '+identifier(table)+' set '+Object.keys(patch).map(k=>identifier(k)+'='+bind(patch[k])).join(',')+where+' returning '+fields;
     if(op!=='select')writes.push({table,operation:op});
     const r=await client.query(sql,params);return {data:normalize(one?r.rows[0]||null:r.rows),error:null};
   }catch(e){errors.push({table,operation:op,code:e.code||null,category:String(e.message).split(':')[0]});return {data:null,error:{code:e.code,message:e.message}};}})().then(ok,bad);}};return q;},
 async rpc(name,p){calls.push(name);try {const args=Object.entries(p);const r=await client.query('select '+identifier(name)+'('+args.map(([k],i)=>identifier(k)+'=> $'+(i+1)).join(',')+') result',args.map(([,v])=>wire(v)));return {data:normalize(r.rows[0].result),error:null};}catch(e){errors.push({rpc:name,code:e.code,category:String(e.message).split(':')[0]});return {error:{code:e.code,message:e.message}};}}
 };
}
