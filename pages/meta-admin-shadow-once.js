import { useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

// No mount effect: navigation, reload and prefetch cannot execute the model.
export default function MetaAdminShadowOnce() {
  const sent=useRef(false);
  const [disabled,setDisabled]=useState(false);
  const [result,setResult]=useState(null);
  async function execute() {
    if(sent.current)return;
    sent.current=true;setDisabled(true);
    try {
      const {data,error}=await supabase.auth.getSession();
      if(error||!data?.session?.access_token){setResult({status:'blocked',proposed_response:null});return;}
      const response=await fetch('/api/operaciones/meta-admin-shadow-self-invoke',{
        method:'POST',redirect:'error',headers:{'Content-Type':'application/json',
          Authorization:`Bearer ${data.session.access_token}`},body:'{}',
      });
      const body=await response.json();
      setResult({status:body.status,proposed_response:body.proposed_response});
    } catch {setResult({status:'uncertain',proposed_response:null});}
    // No retry button: durable server claim is authoritative across reloads.
  }
  return <main style={{maxWidth:760,margin:'48px auto',padding:24}}>
    <h1>Meta Admin Shadow Once</h1>
    <p>Acción manual sólo para Admin. Únicamente el input autorizado en el servidor.
      Una propuesta interceptada; sin herramientas, mutaciones ni envíos.</p>
    <button disabled={disabled} onClick={execute}>Ejecutar una sola vez</button>
    {result&&<pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(result,null,2)}</pre>}
  </main>;
}
