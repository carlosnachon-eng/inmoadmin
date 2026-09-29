// Certification launcher child. Secrets arrive via stdin and remain in memory.
// Real Next UI + real route factory/Auth/DEV. Only model HTTP is synthetic.
const http=require('node:http'),{pathToFileURL}=require('node:url');
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);process.stdin.on('end',async()=>{
 let app,server;
 try {
  const cfg=JSON.parse(input);input='';if(cfg.project!=='hjfwjnejbcpmknvfpdcq'||!/^sb_secret_/.test(cfg.adminKey))throw Error('target_or_key_invalid');
  const root=pathToFileURL(cfg.repo+'/'),{manualEnv,manualDecision,syntheticResponse}=await import(new URL('tests/helpers/manualTurnFixture.mjs',root));
  for(const k of Object.keys(process.env))if(/SUPABASE|SHADOW|RESPOND|ANTHROPIC|VERCEL|NEXT_PUBLIC/.test(k))delete process.env[k];
  Object.assign(process.env,manualEnv,{NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_ANON_KEY:cfg.publicKey,SUPABASE_SERVICE_ROLE_KEY:cfg.adminKey});
  const url=manualEnv.NEXT_PUBLIC_SUPABASE_URL,originalFetch=globalThis.fetch,writes=[];let blockedWrites=0;
  globalThis.fetch=async(resource,opts={})=>{
   const u=new URL(typeof resource==='string'||resource instanceof URL?resource:resource.url),method=String(opts.method||resource.method||'GET').toUpperCase();
   if(u.origin!==url)throw Error('external_network_forbidden');
   if(!['GET','HEAD'].includes(method)){
    const allowed=method==='POST'&&['/rest/v1/rpc/authorize_manual_shadow_turn','/rest/v1/rpc/claim_manual_shadow_turn','/rest/v1/shadow_ai_decisions','/rest/v1/shadow_conversation_actions'].includes(u.pathname)
      ||method==='PATCH'&&u.pathname==='/rest/v1/shadow_ai_runs';
    if(!allowed){blockedWrites++;throw Error('unexpected_route_write');}
    writes.push({method,table:u.pathname.split('/').at(-1)});
   }
   return originalFetch(resource,{...opts,signal:opts.signal||AbortSignal.timeout(20000)});
  };
  const {createClient}=require('@supabase/supabase-js');
  const admin=createClient(url,cfg.adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {authorizeShadowAdministrator}=await import(new URL('lib/shadow/ai/apiAuth.js',root));
  const {createManualTurnHandler}=await import(new URL('lib/shadow/ai/manualTurnApi.js',root));
  const {manualMessageRef}=await import(new URL('lib/shadow/ai/manualTurn.js',root));
  const scenarioByText=new Map(cfg.fixtures.map(f=>[f.text,f.scenario])),providerCalls={};
  const fetchImpl=async(_url,init)=>{
   const body=JSON.parse(init.body),context=JSON.parse(body.messages[0].content),scenario=scenarioByText.get(context.message);
   if(!scenario||body.output_config.format.schema.properties.proposedToolCalls.items.properties.arguments.type!=='array')throw Error('synthetic_scope_invalid');
   // No body, alias, contact reference, credential or provider text is logged.
   providerCalls[scenario]=(providerCalls[scenario]||0)+1;
   const d=structuredClone(manualDecision);
   if(scenario==='http')return {ok:false,status:400,headers:{get:()=>null},json:async()=>({error:{type:'invalid_request_error',message:'Schema is too complex for compilation'}})};
   if(scenario==='timeout')return new Promise((_ok,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('synthetic_timeout')),{once:true}));
   if(scenario==='invalid')return syntheticResponse({});
   if(scenario==='privacy'){d.proposedToolCalls=[{tool:'resolve_contact_identity',arguments:[{key:'respondContactId',value:'123456'}],reason:'Consultar'}];return syntheticResponse(d);}
   if(scenario==='no_message'){d.intent='no_determinado';d.conversationalResponseParts={acknowledgement:'Gracias.',verifiedFactReferences:[],clarificationQuestion:null,escalationMessage:null};}
   if(scenario==='identity')d.intent='no_determinado';
   if(scenario==='tool'&&context.round===1)d.proposedToolCalls=[{tool:'resolve_contact_identity',arguments:[{key:'respondContactId',value:context.metadata.respondContactId}],reason:'Consultar identidad'}];
   if(scenario==='concurrency')await new Promise(ok=>setTimeout(ok,150));
   return syntheticResponse(d);
  };
  const executionOptions={fetchImpl,persistManualAction:async(db,args)=>{
   const input=args.run.round_state_json?.inputSnapshot?.sanitizedText;
   if(scenarioByText.get(input)==='3b_failure')throw Error('synthetic_3b_failure');
   return (await import(new URL('lib/shadow/ai/conversationAction.js',root))).persistConversationAction(db,args);
  }};
  const env={...process.env,SHADOW_AI_ANTHROPIC_ATTEMPT_TIMEOUT_MS:'1500'};
  const handler=createManualTurnHandler({authorize:authorizeShadowAdministrator,createAdmin:()=>admin,env,executionOptions});
  console.log=()=>{};console.warn=()=>{};console.error=()=>{};
  emit({stage:'route_factory_ready'});
  let handle=(_req,res)=>res.status(404).json({ok:false,error:'outside_certification_scope'});
  // The isolated timeout recertification exercises only the real route factory;
  // it does not need to rebuild a UI already certified in the full run.
  if(!cfg.routeOnly){const next=require('next');app=next({dev:true,dir:cfg.repo,hostname:'127.0.0.1',port:cfg.port});emit({stage:'ui_preparing'});await app.prepare();handle=app.getRequestHandler();}
  server=http.createServer(async(req,res)=>{
   const parsed=new URL(req.url,`http://127.0.0.1:${cfg.port}`);req.query=Object.fromEntries(parsed.searchParams);
   res.status=n=>{res.statusCode=n;return res;};res.json=v=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));return res;};
   try {
    if(parsed.pathname==='/api/operaciones/shadow-ai-real-run'){
     let body='';for await(const part of req){body+=part;if(body.length>2048)throw Error('request_too_large');}req.body=body?JSON.parse(body):{};
     if(req.body.action==='authorize'&&!cfg.fixtures.some(f=>manualMessageRef(f.messageId)===req.body.messageRef))throw Error('fixture_scope_violation');
     return await handler(req,res);
    }
    if(parsed.pathname==='/api/operaciones/shadow-coordinator'){
     const actor=await authorizeShadowAdministrator(req);if(!actor)return res.status(403).json({ok:false});
     // Dashboard fixture projection only, never read unrelated DEV conversations.
     const {data:messages,error}=await admin.from('shadow_messages').select('*').in('id',cfg.fixtures.map(f=>f.messageId));if(error)throw Error('fixture_read_failed');
     return res.status(200).json({ok:true,messages:messages.map(m=>({...m,manual_message_ref:manualMessageRef(m.id)})),conversations:[],matches:[],evaluations:[],aiRuns:[],aiDecisions:[],toolAudit:[],conversationActions:[],metrics:{},operationalEvents:[],runIdentityObservability:[]});
    }
    if(parsed.pathname.startsWith('/api/'))return res.status(403).json({ok:false,error:'outside_certification_scope'});
    return handle(req,res);
   }catch{if(!res.headersSent)res.status(500).json({ok:false,error:'certification_server_error'});}
  });
  server.listen(cfg.port,'127.0.0.1',()=>emit({stage:'local_ready',gates:Object.fromEntries(Object.entries(manualEnv).filter(([k])=>k.startsWith('SHADOW_'))),provider:'synthetic_fetch'}));
  const stop=async()=>{emit({stage:'stopped',providerCalls,writeOperations:writes,blockedWrites});server?.close();await app?.close();process.exit(0);};process.on('SIGTERM',stop);process.on('SIGINT',stop);
 }catch{emit({stage:'local_start_failed'});process.exitCode=1;}
});
