// Reuses the existing DEV capture + Auth/Next/Playwright certification pattern.
// No secret files, SQL, migration, external provider or production access here.
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {manualMessageRef} from '../lib/shadow/ai/manualTurn.js';
const require=createRequire(import.meta.url),{createClient}=require('@supabase/supabase-js');
const repo=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,''),project='hjfwjnejbcpmknvfpdcq',url=`https://${project}.supabase.co`,origin='http://127.0.0.1:3194',route='/api/operaciones/shadow-ai-real-run?mode=manual_turn';
const config=JSON.parse(await readFile('/private/tmp/replay-attempts-dev.UrjcLM/public-config.json','utf8'));
if(config.project!==project||!config.publicKey.startsWith('sb_publishable_')||process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error('dev_configuration_invalid');
const dir=await mkdtemp('/private/tmp/manual-shadow-dev-'),tag='manual-dev-'+randomBytes(8).toString('hex');
const scenarios=[['tool','¿Me ayudan con el mantenimiento?'],['no_message','Gracias.'],['ask','Hay una fuga.'],['identity','¿Cuál es el estado del trámite?'],['invalid','Solicito información sobre mantenimiento.'],['privacy','Quiero conocer el avance de mantenimiento.'],['http','Necesito información sobre mantenimiento.'],['timeout','¿Hay novedades sobre mantenimiento?'],['3b_failure','Tengo una consulta de mantenimiento.'],['concurrency','Quisiera información sobre mantenimiento.']];
const targeted=process.env.MANUAL_CERT_FOCUS==='timeout';
if(process.env.MANUAL_CERT_FOCUS&&!targeted)throw Error('invalid_certification_focus');
const fixtures=(targeted?scenarios.filter(([s])=>s==='timeout'):scenarios).map(([scenario,text])=>({scenario,text,messageId:randomUUID(),conversationId:randomUUID()})),actors=[],reports=[],results={},serverEvents=[];
let adminKey='',admin,server,browser,page,stage='capture',createdFixtures=false,cleanup=false;
const emit=x=>process.stdout.write(JSON.stringify(x)+'\n');
const check=(name,ok,details={})=>{reports.push({name,result:ok?'PASS':'FAIL',...details});emit(reports.at(-1));if(!ok)throw Error(name);};
const need=async(p)=>{const r=await p;if(r.error)throw Object.assign(new Error('dev_operation_failed'),{safeCode:r.error.code||r.error.status||null});return r.data;};
const safeEnv={PATH:'/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin',HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NEXT_TELEMETRY_DISABLED:'1'};
const sdk=key=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(r,o={})=>{if(new URL(typeof r==='string'?r:r.url).origin!==url)throw Error('non_dev_destination');return fetch(r,{...o,signal:AbortSignal.timeout(20000)});}}});
const inventory=()=>({project,tag,actorIds:actors.map(a=>a.id),messageIds:fixtures.map(f=>f.messageId),conversationIds:fixtures.map(f=>f.conversationId)});
const save=()=>writeFile(dir+'/inventory.json',JSON.stringify(inventory(),null,2),{mode:0o600});
const waitCleanup=async()=>{
 const deadline=Date.now()+600000;
 while(Date.now()<deadline){
  const checks=await Promise.all([
   need(admin.from('shadow_messages').select('id').in('id',fixtures.map(f=>f.messageId))),
   need(admin.from('shadow_conversations').select('id').in('id',fixtures.map(f=>f.conversationId))),
   need(admin.from('shadow_ai_runs').select('id').in('message_id',fixtures.map(f=>f.messageId))),
   need(admin.from('shadow_ai_manual_authorizations').select('authorization_id').in('message_id',fixtures.map(f=>f.messageId))),
  ]);
  if(checks.every(rows=>rows.length===0))return;
  await new Promise(ok=>setTimeout(ok,3000));
 }
 throw Error('cleanup_confirmation_timeout');
};
async function request(action,body={},actor=actors[0],originHeader=origin){
 const response=await fetch(origin+route+(action==='read'?`&authorizationRef=${body.authorizationRef}`:''),{method:action==='read'?'GET':'POST',headers:{Authorization:`Bearer ${actor.token}`,Origin:originHeader,'Content-Type':'application/json'},...(action==='read'?{}:{body:JSON.stringify({mode:'manual_turn',action,...body})}),signal:AbortSignal.timeout(30000)});
 return {http:response.status,value:await response.json()};
}
try {
 emit({stage:'secure_capture',required:'DEV administrative API key only',outputDirectory:dir});
 const captured=await new Promise((ok,fail)=>{const p=spawn('/usr/bin/osascript',['-l','JavaScript',repo+'/scripts/capture-manual-shadow-dev.jxa'],{env:safeEnv,stdio:['ignore','pipe','pipe']});let out='';const t=setTimeout(()=>{p.kill('SIGTERM');fail(Error('capture_timeout'));},600000);p.stdout.on('data',v=>out+=v);p.stderr.resume();p.on('error',()=>{clearTimeout(t);fail(Error('capture_open_failed'));});p.on('close',()=>{clearTimeout(t);try{const c=JSON.parse(out);out='';ok(c);}catch{out='';fail(Error('capture_no_valid_response'));}});});
 if(captured.status!=='ok')throw Error('capture_cancelled');adminKey=captured.adminKey;captured.adminKey='';if(!/^sb_secret_[A-Za-z0-9_-]+$/.test(adminKey))throw Error('key_format_invalid');admin=sdk(adminKey);
 stage='fixtures';
 check('collision_check_messages',(await need(admin.from('shadow_messages').select('id').in('id',fixtures.map(f=>f.messageId)))).length===0);
 check('collision_check_conversations',(await need(admin.from('shadow_conversations').select('id').in('id',fixtures.map(f=>f.conversationId)))).length===0);
 for(const role of ['admin','asesor']){
  const email=`${tag}-${role}@example.invalid`,password=randomBytes(30).toString('base64url')+'aA1!';
  check(`collision_${role}`,(await need(admin.from('profiles').select('id').eq('email',email))).length===0);
  const created=await need(admin.auth.admin.createUser({email,password,email_confirm:true}));
  const a={id:created.user.id,email,password,role};actors.push(a);await save();
  await need(admin.from('profiles').update({role_id:role,active:true}).eq('id',a.id).select('id').single());
  a.client=sdk(config.publicKey);a.token=(await need(a.client.auth.signInWithPassword({email,password}))).session.access_token;
 }
 check('real_DEV_Auth',actors.every(a=>a.token));
 const occurred=new Date(Date.now()-600000).toISOString();
 createdFixtures=true;await save();
 await need(admin.from('shadow_conversations').insert(fixtures.map(f=>({id:f.conversationId,provider:'respond_admin',external_conversation_id:`${tag}-${f.scenario}`,contact_hash:createHash('sha256').update(tag+f.scenario).digest('hex'),channel:'544519',first_message_at:occurred,last_message_at:occurred,respond_contact_id:`${tag}-${f.scenario}`}))));
 await need(admin.from('shadow_messages').insert(fixtures.map(f=>({id:f.messageId,conversation_id:f.conversationId,provider:'respond_admin',external_message_id:`${tag}-${f.scenario}`,direction:'inbound',occurred_at:occurred,sanitized_text:f.text,content_hash:createHash('sha256').update(f.text+tag).digest('hex')}))));
 const originals=JSON.stringify(await need(admin.from('shadow_messages').select('*').in('id',fixtures.map(f=>f.messageId)).order('id')));
 stage='local_server';
 server=spawn(process.execPath,[repo+'/scripts/manual-shadow-dev-server.cjs'],{env:safeEnv,stdio:['pipe','pipe','pipe']});server.stderr.resume();
 const ready=new Promise((ok,fail)=>{let b='';const t=setTimeout(()=>fail(Error('local_server_timeout')),120000);server.stdout.on('data',c=>{b+=c;while(b.includes('\n')){const i=b.indexOf('\n'),line=b.slice(0,i);b=b.slice(i+1);try{const e=JSON.parse(line);serverEvents.push(e);emit(e);if(e.stage==='local_ready'){clearTimeout(t);ok();}if(e.stage==='local_start_failed'){clearTimeout(t);fail(Error('local_start_failed'));}}catch{}}});});
 server.stdin.end(JSON.stringify({project,repo,adminKey,publicKey:config.publicKey,fixtures,port:3194,routeOnly:targeted}));await ready;
 if(!targeted){stage='browser';
 const {chromium}=await import('/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-background-networking']});
 const context=await browser.newContext();await context.route('**/*',r=>{const u=new URL(r.request().url());
  const ownProfile=u.pathname==='/rest/v1/profiles'&&u.searchParams.get('id')===`eq.${actors[0].id}`;
  const authOrPermissions=u.pathname.startsWith('/auth/v1/')||u.pathname==='/rest/v1/permisos_modulo';
  return u.origin===origin||(u.origin===url&&(ownProfile||authOrPermissions))?r.continue():r.abort();});
 page=await context.newPage();page.setDefaultTimeout(30000);const uiErrors=[];page.on('pageerror',e=>uiErrors.push(e.name));
 await page.goto(origin,{waitUntil:'domcontentloaded',timeout:60000});await page.locator('input[type=email]').waitFor({state:'visible',timeout:60000});check('UI_login_renders',await page.locator('input[type=email]').count()===1);
 check('UI_no_error_overlay',await page.locator('[data-nextjs-dialog]').count()===0);
 await page.locator('input[type=email]').fill(actors[0].email);await page.locator('input[type=password]').fill(actors[0].password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.locator('input[type=password]').waitFor({state:'hidden',timeout:60000});
 await page.goto(origin+'/coordinador-ia-sombra',{waitUntil:'domcontentloaded',timeout:60000});
 const panel=page.getByRole('region',{name:'Manual Real Shadow DEV'});await panel.waitFor();
 const f=fixtures[0];await page.getByRole('button').filter({hasText:f.text}).click();
 let responsePromise=page.waitForResponse(r=>r.url().includes('/shadow-ai-real-run')&&r.request().method()==='POST');
 await panel.getByRole('button',{name:'Autorizar este turno una vez'}).click();let r=await responsePromise;const auth=await r.json();check('UI_authorize_201',r.status()===201&&auth.status==='authorized');
 responsePromise=page.waitForResponse(r=>r.url().includes('/shadow-ai-real-run')&&r.request().method()==='POST');await panel.getByRole('button',{name:'Ejecutar autorización única'}).click();r=await responsePromise;const done=await r.json();results.tool=done;
 check('UI_complete_3A_3B',r.status()===200&&done.certified===true);check('UI_two_rounds_real_readonly_tool',done.telemetry.rounds.length===2&&done.telemetry.tools.some(t=>t.name==='resolve_contact_identity'&&t.ok));
 await panel.getByText('Persistencia completa acreditada: sí',{exact:false}).waitFor();await panel.screenshot({path:dir+'/manual-turn-complete.png'});check('UI_no_runtime_exception',uiErrors.length===0);
 responsePromise=page.waitForResponse(r=>r.url().includes('/shadow-ai-real-run')&&r.request().method()==='GET');await panel.getByRole('button',{name:'Consultar estado read-only'}).click();r=await responsePromise;check('UI_GET_same_origin',r.status()===200&&(await r.json()).certified===true);
 check('GET_equivalent',(await request('read',{authorizationRef:auth.authorizationRef})).value.certified===true);
 stage='auth_rejections';check('non_admin_403',(await request('authorize',{messageRef:manualMessageRef(fixtures[1].messageId)},actors[1])).http===403);
 check('wrong_origin_403',(await request('authorize',{messageRef:manualMessageRef(fixtures[1].messageId)},actors[0],'http://invalid')).http===403);
 }
 stage='behavioral';
 for(const f of targeted?fixtures:fixtures.slice(1)){
  const a=await request('authorize',{messageRef:manualMessageRef(f.messageId)});check(`${f.scenario}_authorized`,a.http===201);
  const requests=f.scenario==='concurrency'?await Promise.all([request('execute',{authorizationRef:a.value.authorizationRef}),request('execute',{authorizationRef:a.value.authorizationRef})]):[await request('execute',{authorizationRef:a.value.authorizationRef})];
  const result=(await request('read',{authorizationRef:a.value.authorizationRef})).value;results[f.scenario]=result;
  if(['invalid','privacy','http','timeout','3b_failure'].includes(f.scenario))check(`${f.scenario}_fail_closed`,['error','timeout'].includes(result.status)&&result.certified===false);
  else check(`${f.scenario}_complete`,result.certified===true);
  if(f.scenario==='no_message')check('no_message',result.conversation_action.conversation_action==='no_message');
  if(f.scenario==='ask')check('ask_missing_information',result.conversation_action.conversation_action==='ask_missing_information');
  if(f.scenario==='3b_failure')check('3A_preserved_after_3B_failure',result.operational_resolution_persisted&&!result.conversation_action_persisted&&result.telemetry.failure.outputStage==='3B');
  if(f.scenario==='timeout')check('timeout_transport_receipt_retained',result.telemetry.rounds[0].receipt?.final_payload_verified===true&&result.telemetry.rounds[0].receipt?.serialized_body_verified===true&&result.telemetry.rounds[0].receipt?.provider_invoked===true&&result.telemetry.rounds[0].model===null&&result.telemetry.rounds[0].input_tokens===null);
  if(f.scenario==='concurrency'){check('concurrent_single_run',new Set(requests.map(r=>r.value.runRef)).size===1);check('concurrent_single_authorization',(await need(admin.from('shadow_ai_runs').select('id').eq('message_id',f.messageId))).length===1);}
  const before=JSON.stringify(result),again=await request('execute',{authorizationRef:a.value.authorizationRef});check(`${f.scenario}_no_unauthorized_retry`,again.value.duplicate===true&&JSON.stringify((await request('read',{authorizationRef:a.value.authorizationRef})).value)===before);
 }
 check('captured_messages_unchanged',originals===JSON.stringify(await need(admin.from('shadow_messages').select('*').in('id',fixtures.map(f=>f.messageId)).order('id'))));
 stage='complete';
}catch(e){reports.push({name:stage,result:'FAIL',code:e.safeCode||null,error:/^[a-zA-Z0-9_]+$/.test(e.message)?e.message:'certification_error'});emit(reports.at(-1));
 if(page&&!page.isClosed())emit({stage:'browser_failure_metadata',pathname:new URL(page.url()).pathname,emailInputs:await page.locator('input[type=email]').count(),passwordInputs:await page.locator('input[type=password]').count(),errorOverlay:await page.locator('[data-nextjs-dialog]').count()});
}
finally {
 await writeFile(dir+'/progress.json',JSON.stringify({project,reports,results,serverEvents,externalProviderCalls:0},null,2),{mode:0o600});
 await browser?.close().catch(()=>{});if(server){server.kill('SIGTERM');await new Promise(ok=>setTimeout(ok,1000));if(server.exitCode===null)server.kill('SIGKILL');}
 if(server){const stopped=serverEvents.find(e=>e.stage==='stopped');reports.push({name:'route_write_allowlist_observed',result:stopped&&stopped.blockedWrites===0&&stopped.writeOperations.every(w=>['authorize_manual_shadow_turn','claim_manual_shadow_turn','shadow_ai_decisions','shadow_conversation_actions','shadow_ai_runs'].includes(w.table))?'PASS':'FAIL'});}
 for(const a of actors)await a.client?.auth.signOut({scope:'global'}).catch(()=>{});
 if(createdFixtures){await save();emit({stage:'awaiting_exact_cleanup',inventory:dir+'/inventory.json'});
  try{await waitCleanup();cleanup=true;reports.push({name:'cleanup_data_inventory_zero',result:'PASS'});}catch{reports.push({name:'cleanup_data',result:'FAIL'});}
 }else cleanup=true;
 if(cleanup)for(const a of actors){try{await need(admin.auth.admin.deleteUser(a.id));check('auth_actor_removed',(await need(admin.from('profiles').select('id').eq('id',a.id))).length===0);}catch{cleanup=false;reports.push({name:'actor_cleanup',result:'FAIL'});}}
 adminKey='';for(const a of actors){a.token='';a.password='';a.email='';a.client=null;}admin=null;
 await writeFile(dir+'/result.json',JSON.stringify({project,reports,results,serverEvents,cleanup,externalProviderCalls:0},null,2),{mode:0o600});
 emit({stage:'finished',pass:reports.filter(r=>r.result==='PASS').length,fail:reports.filter(r=>r.result==='FAIL').length,cleanup,report:dir+'/result.json'});process.exitCode=reports.some(r=>r.result==='FAIL')||!cleanup?1:0;
}
