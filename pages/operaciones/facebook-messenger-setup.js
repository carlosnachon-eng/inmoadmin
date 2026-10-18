import {useRef,useState} from 'react';
import Head from 'next/head';
import {supabase} from '../../lib/supabase';

export async function getServerSideProps({res}) {
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow');
 if(process.env.VERCEL_ENV==='production'||!['preview','development'].includes(process.env.APP_ENV)||process.env.NEXT_PUBLIC_SUPABASE_URL!=='https://hjfwjnejbcpmknvfpdcq.supabase.co')return {notFound:true};
 return {props:{}};
}
export default function MessengerSetup(){
 const [busy,setBusy]=useState(false),[result,setResult]=useState(null);const lock=useRef(false);
 async function run(operation){
  if(lock.current)return;lock.current=true;setBusy(true);
  try{
   const {data}=await supabase.auth.getSession();
   if(!data?.session?.access_token){setResult({status:'Inicia sesión Admin DEV.'});return;}
   const r=await fetch('/api/operaciones/facebook-messenger-setup',{method:'POST',redirect:'error',cache:'no-store',
    headers:{Authorization:`Bearer ${data.session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({operation})});
   const safe=await r.json().catch(()=>({status:'Configuración no disponible.'}));
   // No credential input or generic response dump. Only known diagnostic fields.
   setResult(Object.fromEntries(['status','stage','ok','http_status','code','subcode','identity_verified','app_verified','token_type','expires_at','data_access_expires_at','verified_at','valid_until','inbound_ready','echo_ready','sender'].filter(k=>Object.hasOwn(safe,k)).map(k=>[k,safe[k]])));
  }catch{setResult({status:'No verificable; sin reintento automático.'});}finally{lock.current=false;setBusy(false);}
 }
 return <main style={{maxWidth:720,margin:'40px auto',padding:24}}>
  <Head><title>Messenger · Configuración DEV</title></Head>
  <h1>Facebook Messenger · DEV</h1>
  <p>Configuración exclusiva de administradores. Sin mensajes, sin IA y sin modificar Instagram ni Respond.</p>
  <p>La credencial se provisiona desde un secreto server-side. No pegues tokens aquí.</p>
  <button disabled={busy} onClick={()=>run('provision')}>Validar y guardar credencial DEV</button>{' '}
  <button disabled={busy} onClick={()=>run('health')}>Verificar salud de credencial</button>
  <p>Ambas acciones requieren sender OFF. No suscriben webhooks ni conceden permisos.</p>
  <section aria-live="polite">{result&&<pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(result,null,2)}</pre>}</section>
  <a href="/administracion/inbox">Volver al Inbox existente</a>
 </main>;
}
