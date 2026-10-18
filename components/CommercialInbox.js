import {useEffect,useRef,useState} from 'react';
import {supabase} from '../lib/supabase';
import InstagramBusinessInbox from './InstagramBusinessInbox';
import InstagramCommentsPanel from './InstagramCommentsPanel';
import FacebookMessengerConversation from './FacebookMessengerConversation';

export async function inboxRequest(channel,op,{thread,body}={}){
 const {data}=await supabase.auth.getSession();
 if(!data?.session)throw Error('Sesión requerida');
 const path=channel==='facebook'?(body?'facebook-messenger':'facebook-messenger-inbox'):'instagram-business';
 const response=await fetch('/api/operaciones/'+path+'?'+new URLSearchParams({op,...(thread?{thread}:{})}),{
  method:body?'POST':'GET',cache:'no-store',redirect:'error',
  headers:{Authorization:`Bearer ${data.session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json().catch(()=>null);
 if(!response.ok||!result)throw Error('No fue posible consultar el canal.');
 return result;
}

export default function CommercialInbox({instagramAvailable}){
 const [filter,setFilter]=useState('all'),[threads,setThreads]=useState([]),[selected,setSelected]=useState(null),[error,setError]=useState('');
 const generation=useRef(0);
 async function load(){
  const gen=++generation.current;
  const channels=instagramAvailable?['instagram','facebook']:['facebook'];
  const results=await Promise.all(channels.map(async channel=>{
   try{const r=await inboxRequest(channel,'threads');return {rows:(r.rows||[]).map(t=>({...t,channel,key:channel+':'+t.thread_ref}))};}
   catch{return {rows:[],error:channel};}
  }));
  if(gen!==generation.current)return;
  setThreads(results.flatMap(r=>r.rows).sort((a,b)=>String(b.occurred_at||b.last_at||'').localeCompare(String(a.occurred_at||a.last_at||''))));
  setError(results.filter(r=>r.error).map(r=>`${r.error}: no disponible`).join(' · '));
 }
 useEffect(()=>{void load();return()=>{generation.current++;};},[instagramAvailable]);
 const visible=threads.filter(t=>filter==='all'||t.channel===filter);
 return <section aria-label="Inbox comercial omnicanal" className="commercialInbox">
  <header><h1>Inbox</h1><nav aria-label="Canales">{[['all','Todos'],['instagram','Instagram'],['facebook','Facebook'],['comments','Comentarios']].map(([id,label])=>
   <button type="button" key={id} aria-pressed={filter===id} onClick={()=>{setFilter(id);setSelected(null);}}>{label}</button>)}<button type="button" onClick={load}>Actualizar</button></nav></header>
  {error&&<p role="status">{error}</p>}
  {filter==='comments'?<InstagramCommentsPanel open onClose={()=>setFilter('all')}/>:<div className={'workspace '+(selected?'hasSelection':'')}>
   <aside aria-label="Conversaciones"><h2>Conversaciones</h2>{!visible.length&&<p>No hay hilos autorizados para esta vista.</p>}
    {visible.map((t,i)=><button type="button" key={t.key} aria-pressed={selected?.key===t.key} onClick={()=>setSelected(t)}>
     <b>{t.channel==='facebook'?'Facebook':'Instagram'}</b><span>{t.alias||t.profile_name||t.profile_username||`Conversación ${i+1}`}</span>
    </button>)}
   </aside>
   <main><button type="button" className="back" onClick={()=>setSelected(null)}>← Conversaciones</button>
    {!selected?<p>Selecciona una conversación.</p>:selected.channel==='facebook'
     ?<FacebookMessengerConversation key={selected.key} thread={selected.thread_ref}/>
     :<InstagramBusinessInbox key={selected.key} embedded externalThread={selected.thread_ref} onBack={()=>setSelected(null)}/>}
   </main>
  </div>}
  <style jsx>{`
   .commercialInbox{background:white;color:#1f2937;min-width:0}.commercialInbox header{padding:16px;border-bottom:1px solid #ddd}h1{margin:0 0 12px}nav{display:flex;flex-wrap:wrap;gap:8px}button{cursor:pointer;min-height:44px;border:1px solid #ddd;border-radius:8px;background:white;padding:10px}button[aria-pressed=true]{background:#eef2ff;border-color:#6366f1}.workspace{display:grid;grid-template-columns:270px minmax(0,1fr)}aside{padding:12px;border-right:1px solid #ddd;max-height:75vh;overflow:auto}aside button{display:flex;flex-direction:column;width:100%;text-align:left;gap:5px;margin-bottom:8px}aside b{font-size:12px}main{min-width:0;padding:12px}.back{display:none}@media(max-width:760px){.workspace{grid-template-columns:1fr}.workspace main{display:none}.workspace.hasSelection aside{display:none}.workspace.hasSelection main{display:block}.back{display:block;margin-bottom:12px}}
  `}</style>
 </section>;
}
