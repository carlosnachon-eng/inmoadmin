import {useEffect,useState} from 'react';

export default function WhatsAppAdminConversation({thread,request}){
 const [data,setData]=useState(null),[error,setError]=useState('');
 useEffect(()=>{
  let active=true,busy=false;
  setData(null);setError('');
  const load=async()=>{
   if(busy||document.visibilityState!=='visible')return;
   busy=true;
   try{
    const result=await request('whatsapp_admin','history',{thread});
    if(active){setData(result);setError('');}
   }catch{if(active){setData(null);setError('Historial no disponible o permiso insuficiente.');}}
   finally{busy=false;}
  };
  void load();
  const timer=setInterval(()=>void load(),10000);
  return()=>{active=false;clearInterval(timer);};
 },[thread,request]);
 return <section className="waAdmin" aria-label="WhatsApp Administración — sólo lectura">
  <header><h2>WhatsApp Administración</h2><p>Sólo lectura · conexión oficial no certificada · envíos deshabilitados</p></header>
  <details><summary>Ficha y disponibilidad</summary>
   <p>Historial almacenado exclusivamente de Administración. No incluye WhatsApp Ventas.</p>
   <p>Asignaciones, citas, propiedades y descarga multimedia: pendientes, no operativas.</p>
   <p>Los mensajes salientes observados no acreditan qué persona los envió.</p>
   {data&&<p>Identidad: {data.identity_state}. {data.history_truncated?'Se muestran los últimos 100 mensajes.':''}</p>}
  </details>
  {error?<p role="alert">{error}</p>:!data?<p role="status">Consultando historial autorizado…</p>:
   <ol aria-label="Mensajes almacenados">{!data.rows.length&&<li>No hay mensajes almacenados disponibles.</li>}
    {data.rows.map(m=><li key={m.message_ref} className={m.provenance==='customer_inbound'?'inbound':'echo'}>
     <small>{m.provenance==='customer_inbound'?'Entrante':'Eco de WhatsApp · autor no acreditado'} · {new Date(m.occurred_at).toLocaleString('es-MX')}</small>
     <p>{m.modified?'Contenido modificado o anulado':m.text||'Contenido no disponible en el historial almacenado'}</p>
     {m.type!=='text'&&<small>Adjunto: {m.type} · sin descarga ni reproducción habilitada</small>}
    </li>)}
   </ol>}
  <style jsx>{`
   .waAdmin{display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto;padding:16px;overflow-wrap:anywhere}
   h2{font-size:17px;margin:0}header p,details{font-size:12px;color:#556273}details{padding:10px 0}summary{cursor:pointer}
   ol{list-style:none;padding:0;margin:12px 0;display:flex;flex-direction:column;gap:10px}
   li{padding:12px;border:1px solid #dfe8e2;border-radius:12px;max-width:85%;background:white}
   li.echo{align-self:flex-end;background:#edf8f1}small{font-size:11px;color:#566575}li p{white-space:pre-wrap;font-size:13px}
   @media(max-width:760px){.waAdmin{padding:12px}li{max-width:95%}}
  `}</style>
 </section>;
}
