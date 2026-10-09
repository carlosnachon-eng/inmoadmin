import {useState,useRef} from 'react';
import Layout from '../../components/Layout';
import {supabase} from '../../lib/supabase';
export default function Diagnostic(){
 const [result,setResult]=useState(null),[busy,setBusy]=useState(false);const used=useRef(false);
 async function run(){if(used.current)return;used.current=true;setBusy(true);try{const {data}=await supabase.auth.getSession();if(!data?.session?.access_token)throw Error();const r=await fetch('/api/operaciones/meta-admin-diagnostic',{method:'GET',cache:'no-store',redirect:'error',headers:{Authorization:`Bearer ${data.session.access_token}`}});setResult(await r.json());}catch{setResult({status:'diagnostic_unavailable'});}finally{setBusy(false);}}
 return <Layout><main style={{padding:24}}><h1>Diagnóstico temporal Meta</h1><p>Sólo lectura · sin envío · caduca automáticamente.</p><button disabled={busy||used.current} onClick={run}>Consultar diagnóstico sanitizado</button><pre aria-label="Resultado sanitizado">{result?JSON.stringify(result,null,2):'Sin ejecutar'}</pre></main></Layout>;
}
