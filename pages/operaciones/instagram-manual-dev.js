import {useEffect,useRef,useState} from 'react';
import Head from 'next/head';
import {supabase} from '../../lib/supabase';

export async function getServerSideProps({res}) {
  res.setHeader('Cache-Control','no-store');
  if(process.env.VERCEL_ENV!=='preview'||process.env.NEXT_PUBLIC_SUPABASE_URL!=='https://hjfwjnejbcpmknvfpdcq.supabase.co')return {notFound:true};
  return {props:{}};
}
export default function InstagramManualDev() {
  const [result,setResult]=useState(null),[text,setText]=useState(''),[busy,setBusy]=useState(false);
  const attempted=useRef(false),inflight=useRef(false),action=useRef(null);
  async function request(op,body) {
    const {data:{session}}=await supabase.auth.getSession();
    if(!session)throw Error('session_required');
    const response=await fetch('/api/operaciones/instagram-inbox-manual-dev'+(body?'':`?op=${op}`),{
      method:body?'POST':'GET',cache:'no-store',headers:{Authorization:`Bearer ${session.access_token}`,
        ...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return response.json();
  }
  async function inspect(op='preflight') {
    if(inflight.current)return;inflight.current=true;setBusy(true);
    try{setResult(await request(op));}catch{setResult({status:'blocked'});}finally{inflight.current=false;setBusy(false);}
  }
  useEffect(()=>{inspect();},[]); // Read-only preflight; never dispatch on mount.
  async function send(e) {
    e.preventDefault();
    if(inflight.current||attempted.current||!result?.sender_enabled||!result?.no_prior_claim||result?.status!=='ready')return;
    attempted.current=true;inflight.current=true;setBusy(true);setResult({status:'pending'});
    action.current=crypto.randomUUID();
    try{setResult(await request('send',{action:action.current,text:text.trim()}));}
    catch{setResult({status:'uncertain'});}finally{inflight.current=false;setBusy(false);}
  }
  return <main style={{maxWidth:720,margin:'40px auto',padding:24,fontFamily:'sans-serif'}}>
    <Head><title>Instagram · Emporio DEV</title><meta name="robots" content="noindex,nofollow"/></Head>
    <h1>Emporio · Instagram DEV</h1><p>Prueba manual única · Sin IA</p>
    <section aria-label="Inbound acreditado" style={{background:'#f1f5f9',padding:20,borderRadius:16}}>
      <strong>Mensaje recibido de Instagram</strong><p>Contenido no almacenado.</p>
      {result?.occurred_at&&<time dateTime={result.occurred_at}>{result.occurred_at}</time>}
      <p>El destinatario se verifica en el servidor; no puede editarse.</p>
    </section>
    <p role="status" aria-live="polite">Estado: {busy?'pending':result?.status||'Verificando sesión y vínculo…'}</p>
    {result?.binding_verified&&<p>Vínculo cifrado verificado. Administrador autorizado.</p>}
    {result?.paused&&<p>IA pausada por atención humana.</p>}
    {result?.status==='ready'&&!result?.sender_enabled&&<p>Sender deshabilitado. No se puede enviar.</p>}
    <form onSubmit={send}>
      <label htmlFor="reply">Respuesta manual</label>
      <textarea id="reply" value={text} maxLength={999} onChange={e=>setText(e.target.value)} disabled={busy||attempted.current}
        rows={4} style={{display:'block',width:'100%',margin:'12px 0'}}/>
      <button disabled={busy||attempted.current||!text.trim()||result?.status!=='ready'||!result?.sender_enabled||!result?.no_prior_claim}>
        Enviar respuesta DEV</button>
    </form>
    <button type="button" disabled={busy} onClick={()=>inspect(attempted.current?'status':'preflight')} style={{marginTop:16}}>
      Consultar estado (sin reenviar)</button>
    <p>No hay reintentos automáticos. Accepted no acredita entrega ni lectura.</p>
  </main>;
}
