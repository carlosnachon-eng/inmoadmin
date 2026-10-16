import {useEffect,useRef,useState} from 'react';
import Head from 'next/head';
import {supabase} from '../../lib/supabase';

// No OAuth code/state is serialized into page props or rendered as text.
export async function getServerSideProps({res}){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('X-Robots-Tag','noindex, nofollow');
 if(process.env.VERCEL_ENV!=='preview'||process.env.INSTAGRAM_BUSINESS_ENABLED!=='true')return {notFound:true};
 return {props:{}};
}
async function request(op,body){
 const {data}=await supabase.auth.getSession();
 if(!data?.session?.access_token)throw Error('Inicia sesión Admin DEV antes de continuar.');
 const r=await fetch('/api/operaciones/instagram-business?op='+op,{
  method:body?'POST':'GET',cache:'no-store',redirect:'error',
  headers:{Authorization:`Bearer ${data.session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})});
 if(!r.ok)throw Error('Validación bloqueada. No se reintentará automáticamente.');
 return r.json();
}
export default function InstagramBusinessSetup(){
 const [busy,setBusy]=useState(false),[status,setStatus]=useState('Configuración Instagram Login DEV'),[health,setHealth]=useState(null);
 const lock=useRef(false),processed=useRef(false);
 async function run(op,body){
  if(lock.current)return;lock.current=true;setBusy(true);
  try{
   const result=await request(op,body);
   if(op==='oauth-start'){
    const target=new URL(result.url);
    if(target.origin!=='https://www.instagram.com'||target.pathname!=='/oauth/authorize')throw Error('Destino OAuth no autorizado.');
    window.location.assign(target.href);return;
   }
   setHealth(result);setStatus(op==='oauth-complete'?'OAuth verificado; credencial cifrada server-side.':'Estado actualizado.');
  }catch(e){setStatus(e.message);}finally{lock.current=false;setBusy(false);}
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
  <Head><title>Instagram Login · configuración DEV</title><meta name="referrer" content="no-referrer"/></Head>
  <h1>Instagram Login · DEV</h1>
  <p>Usa tu sesión Admin DEV existente. No se solicitan permisos WhatsApp ni se modifica Respond. Esta pantalla no envía mensajes.</p>
  <button disabled={busy} onClick={()=>run('oauth-start',{})}>Autorizar Emporio Social Business</button>{' '}
  <button disabled={busy} onClick={()=>run('health')}>Consultar salud</button>{' '}
  <button disabled={busy} onClick={()=>run('maintain',{})}>Verificar / renovar credencial</button>
  <p role="status">{status}</p>
  {health&&<dl><dt>Estado</dt><dd>{health.status}</dd><dt>Vencimiento</dt><dd>{health.expires_at||'No acreditado'}</dd><dt>Última verificación</dt><dd>{health.verified_at||'No acreditada'}</dd></dl>}
  <p>La renovación no habilita el sender. Ante resultado incierto no se reintenta automáticamente.</p>
  <a href="/administracion/inbox">Volver a Inbox DEV</a>
 </main>;
}
