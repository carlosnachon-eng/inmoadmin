import {useRef,useState} from 'react';
import {supabase} from '../../lib/supabase';
export async function getServerSideProps({res}){
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow');
 if(process.env.VERCEL_ENV!=='production'||process.env.INSTAGRAM_BUSINESS_ROLLOUT!=='closed_canary'||Date.now()>=Date.parse('2026-10-19T02:27:08.193Z'))return {notFound:true};
 return {props:{}};
}
export default function BindingCheck(){
 const [status,setStatus]=useState(''),[done,setDone]=useState(false),lock=useRef(false);
 async function run(){
  if(lock.current)return;lock.current=true;setDone(true);
  try{
   const {data}=await supabase.auth.getSession();if(!data?.session?.access_token)throw Error();
   const r=await fetch('/api/operaciones/instagram-business-binding-check',{method:'POST',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},body:'{}'});
   const result=await r.json();setStatus(r.ok&&result.status==='PASS'?'PASS':'FAIL');
  }catch{setStatus('FAIL');}
 }
 return <main style={{maxWidth:650,margin:'60px auto',padding:24}}><h1>Verificación de binding</h1><p>IGPROD-INBOUND-20261017-01 · Sólo lectura. Requiere sesión del administrador autorizado. No envía mensajes.</p><button disabled={done} onClick={run}>Verificar binding</button><p role="status">{status}</p></main>;
}
