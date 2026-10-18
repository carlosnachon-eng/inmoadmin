import {useEffect,useRef,useState} from 'react';
import Head from 'next/head';
import {supabase} from '../../lib/supabase';
import {projectOAuthShapeDiagnostic} from '../../lib/messaging/instagram/business/diagnosticDisplay';

// No OAuth code/state is serialized into page props or rendered as text.
export async function getServerSideProps({res}){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('X-Robots-Tag','noindex, nofollow');
 const production=process.env.VERCEL_ENV==='production';
 if(process.env.INSTAGRAM_BUSINESS_ENABLED!=='true'||!(process.env.VERCEL_ENV==='preview'||production&&process.env.INSTAGRAM_BUSINESS_ROLLOUT==='closed_canary'))return {notFound:true};
 return {props:{environment:production?'Producción · canary cerrado':'DEV'}};
}
async function request(op,body){
 const {data}=await supabase.auth.getSession();
 if(!data?.session?.access_token)throw Error('Inicia sesión con el operador autorizado de este entorno antes de continuar.');
 const r=await fetch('/api/operaciones/instagram-business?op='+op,{
  method:body?'POST':'GET',cache:'no-store',redirect:'error',
  headers:{Authorization:`Bearer ${data.session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})});
 if(!r.ok){
  const result=await r.json().catch(()=>null),d=result?.diagnostic;
  const stages=['callback_input','state_validation','short_token_exchange','short_token_shape','granted_scopes','short_token_presence','short_token_identity','long_token_exchange','long_token_type_expiry','long_token_identity','credential_encryption','credential_persistence'];
  if(op==='oauth-complete'&&stages.includes(d?.stage)){
   const fields=['http_status','code','subcode'].filter(k=>Number.isSafeInteger(d[k])).map(k=>`${k}=${d[k]}`);
   const error=Error(`OAuth bloqueado: ${d.stage}${fields.length?' · '+fields.join(' · '):''}. Sin reintento automático.`);
   error.safeShape=projectOAuthShapeDiagnostic(d);throw error;
  }
  throw Error('Validación bloqueada. No se reintentará automáticamente.');
 }
 return r.json();
}
export default function InstagramBusinessSetup({environment='DEV'}){
 const [busy,setBusy]=useState(false),[status,setStatus]=useState('Configuración Instagram Login · '+environment),[health,setHealth]=useState(null);
 const [shape,setShape]=useState(null);
 const lock=useRef(false),processed=useRef(false);
 async function run(op,body){
  if(lock.current)return;lock.current=true;setBusy(true);setShape(null);
  try{
   const result=await request(op,body);
   if(op==='oauth-start'){
    const target=new URL(result.url);
    if(target.origin!=='https://www.instagram.com'||target.pathname!=='/oauth/authorize')throw Error('Destino OAuth no autorizado.');
    window.location.assign(target.href);return;
   }
   setHealth(result);setStatus(op==='oauth-complete'?'OAuth verificado; credencial cifrada server-side.':'Estado actualizado.');
  }catch(e){setStatus(e.message);setShape(e.safeShape||null);}finally{lock.current=false;setBusy(false);}
 }
 useEffect(()=>{
  if(processed.current)return;processed.current=true;
  const params=new URLSearchParams(window.location.search);
  const codes=params.getAll('code'),states=params.getAll('state'),denied=params.has('error');
  // Remove transient OAuth values from the current history entry before any API work.
  window.history.replaceState(null,'',window.location.pathname);
  if(denied){setStatus('OAuth cancelado. Sin intercambio.');return;}
  if(codes.length===1&&states.length===1){void run('oauth-complete',{code:codes[0],state:states[0]});}
  else if(codes.length||states.length)setStatus('Callback inválido. Inicia un OAuth nuevo.');
 },[]);
 return <main style={{maxWidth:700,margin:'40px auto',padding:24}}>
  <Head><title>Instagram Login · {environment}</title><meta name="referrer" content="no-referrer"/></Head>
  <h1>Instagram Login · {environment}</h1>
  <p>Usa la sesión del operador autorizado en este entorno. No se solicitan permisos WhatsApp ni se modifica Respond. Esta pantalla no envía mensajes.</p>
  <button disabled={busy} onClick={()=>run('oauth-start',{})}>Autorizar Emporio Social Business</button>{' '}
  <button disabled={busy} onClick={()=>run('health')}>Consultar salud</button>{' '}
  <button disabled={busy} onClick={()=>run('maintain',{})}>Verificar / renovar credencial</button>
  <p role="status">{status}</p>
  {shape&&<section aria-label="Diagnóstico sanitizado OAuth"><h2>Estructura de respuesta · sin valores</h2><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(shape,null,2)}</pre></section>}
  {health&&<dl><dt>Estado</dt><dd>{health.status}</dd><dt>Vencimiento</dt><dd>{health.expires_at||'No acreditado'}</dd><dt>Última verificación</dt><dd>{health.verified_at||'No acreditada'}</dd></dl>}
  <p>La renovación no habilita el sender. Ante resultado incierto no se reintenta automáticamente.</p>
  <a href="/administracion/inbox">Volver a Inbox</a>
 </main>;
}
