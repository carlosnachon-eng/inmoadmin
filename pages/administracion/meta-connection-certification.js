import {useRef,useState} from 'react';
import Layout from '../../components/Layout';
import {supabase} from '../../lib/supabase';
export default function MetaConnectionCertification(){
  const used=useRef(false),[result,setResult]=useState(null),[busy,setBusy]=useState(false);
  async function run(){
    if(used.current)return;used.current=true;setBusy(true);
    try{
      const {data}=await supabase.auth.getSession();
      if(!data?.session?.access_token)throw Error();
      const r=await fetch('/api/operaciones/meta-admin-connection-certification',{
        method:'GET',cache:'no-store',redirect:'error',headers:{Authorization:`Bearer ${data.session.access_token}`}});
      setResult(await r.json());
    }catch{setResult({status:'unavailable'});}finally{setBusy(false);}
  }
  return <Layout><main style={{padding:24}}><h1>Certificación de conexión WhatsApp Administración</h1>
    <p>Consulta de sólo lectura. No envía mensajes ni inicia una conexión.</p>
    <button disabled={busy||used.current} onClick={run}>Consultar estado de conexión</button>
    <pre aria-label="Resultado sanitizado">{result?JSON.stringify(result,null,2):'Sin ejecutar'}</pre>
  </main></Layout>;
}
