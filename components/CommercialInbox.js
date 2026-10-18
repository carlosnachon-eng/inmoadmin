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
 const [filter,setFilter]=useState('all'),[query,setQuery]=useState(''),[threads,setThreads]=useState([]),[selected,setSelected]=useState(null),[error,setError]=useState('');
 const [canSyncHistory,setCanSyncHistory]=useState(false),[syncBusy,setSyncBusy]=useState(false),[syncStatus,setSyncStatus]=useState(''),[historyRevision,setHistoryRevision]=useState(0);
 const generation=useRef(0);
 async function load(){
  const gen=++generation.current;
  const channels=instagramAvailable?['instagram','facebook']:['facebook'];
  const results=await Promise.all(channels.map(async channel=>{
   try{const r=await inboxRequest(channel,'threads');return {rows:(r.rows||[]).map(t=>({...t,channel,key:channel+':'+t.thread_ref}))};}
   catch{return {rows:[],error:channel};}
  }));
  if(gen!==generation.current)return;
  let names={};
  if(results.some(r=>r.rows.some(t=>t.channel==='facebook'))){
   try{
    const {data}=await supabase.auth.getSession();
    if(data?.session){
     const response=await fetch('/api/operaciones/facebook-messenger-names',{cache:'no-store',headers:{Authorization:'Bearer '+data.session.access_token}});
     if(response.ok){const payload=await response.json();names=Object.fromEntries((payload.rows||[]).map(n=>[n.thread_ref,n]));}
    }
   }catch{}
  }
  if(gen!==generation.current)return;
  setThreads(results.flatMap(r=>r.rows).map(t=>t.channel==='facebook'?{...t,...(names[t.thread_ref]||{})}:t).sort((a,b)=>String(b.occurred_at||b.last_at||'').localeCompare(String(a.occurred_at||a.last_at||''))));
  setError(results.filter(r=>r.error).map(r=>`${r.error}: no disponible`).join(' · '));
 }
 useEffect(()=>{void load();return()=>{generation.current++;};},[instagramAvailable]);
 useEffect(()=>{let live=true;
  supabase.auth.getUser().then(async({data})=>{
   if(!data?.user)return;
   const {data:profile}=await supabase.from('profiles').select('role_id,active').eq('id',data.user.id).maybeSingle();
   if(live)setCanSyncHistory(profile?.active===true&&profile.role_id==='admin');
  }).catch(()=>{if(live)setCanSyncHistory(false)});
  return()=>{live=false};
 },[]);
 async function recoverHistory(){
  if(syncBusy)return;setSyncBusy(true);setSyncStatus('Recuperando historial de Instagram…');
  try{
   const result=await inboxRequest('instagram','history-sync',{body:{}});
   setSyncStatus(`Recuperación terminada: ${result.inserted??0} mensajes incorporados, ${result.duplicates??0} duplicados evitados.`);
   await load();setHistoryRevision(n=>n+1);
  }catch{setSyncStatus('No se pudo recuperar el historial. No se enviaron mensajes.');}
  finally{setSyncBusy(false)}
 }
 async function recoverFacebookHistory(){
  if(syncBusy)return;setSyncBusy(true);setSyncStatus('Recuperando 7 días de Facebook…');
  try{
   const {data}=await supabase.auth.getSession();
   if(!data?.session)throw Error('Sesión requerida');
   const response=await fetch('/api/operaciones/facebook-messenger-history',{method:'POST',cache:'no-store',redirect:'error',
    headers:{Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},body:'{}'});
   if(!response.ok)throw Error('No disponible');
   const result=await response.json();
   setSyncStatus(`Facebook: ${result.inserted??0} mensajes incorporados, ${result.duplicates??0} duplicados evitados.${result.truncated?' El historial puede estar incompleto por límites de Meta.':''}`);
   await load();
  }catch{setSyncStatus('No se pudo recuperar Facebook: comprueba permisos de Meta y vigencia de la conexión. No se enviaron mensajes.');}
  finally{setSyncBusy(false)}
 }
 const visible=threads.filter(t=>(filter==='all'||t.channel===filter)&&`${t.alias||''} ${t.profile_name||''} ${t.profile_username||''} ${t.channel}`.toLocaleLowerCase('es-MX').includes(query.toLocaleLowerCase('es-MX').trim()));
 return <section aria-label="Inbox comercial omnicanal" className="commercialInbox">
  <header className="inboxHeader"><div><span className="eyebrow">EMPORIO · MENSAJERÍA</span><h1>Inbox</h1><p className="subtitle">Conversaciones y atención desde un solo lugar</p></div>
  <div className="inboxActions">{instagramAvailable&&canSyncHistory&&<button type="button" className="refresh" disabled={syncBusy} onClick={recoverHistory}>{syncBusy?'Recuperando…':'↻ Recuperar 7 días IG'}</button>}{canSyncHistory&&<button type="button" className="refresh" disabled={syncBusy} onClick={recoverFacebookHistory}>{syncBusy?'Recuperando…':'↻ Recuperar 7 días FB'}</button>}<button type="button" className="refresh" onClick={load} aria-label="Actualizar conversaciones">↻ Actualizar</button></div></header>
  <nav aria-label="Canales" className="channelTabs">{[['all','Todos'],['instagram','Instagram'],['facebook','Facebook'],['comments','Comentarios']].map(([id,label])=>
   <button type="button" key={id} className={filter===id?'active':''} aria-pressed={filter===id} onClick={()=>{setFilter(id);setSelected(null);}}>{label}{id==='all'&&<span className="counter">{threads.length}</span>}{(id==='instagram'||id==='facebook')&&<span className="counter">{threads.filter(t=>t.channel===id).length}</span>}</button>)}</nav>
  {syncStatus&&<p role="status" className="loadWarning">{syncStatus}</p>}
  {error&&<p role="status" className="loadWarning">Algunos canales no están disponibles: {error}</p>}
  {filter==='comments'?<InstagramCommentsPanel open onClose={()=>setFilter('all')}/>:<div className={'workspace '+(selected?'hasSelection':'')}>
   <aside aria-label="Conversaciones" className="threadsPane"><div className="paneHeading"><strong>Conversaciones</strong><span>{visible.length}</span></div>
    <label className="searchBox"><span aria-hidden="true">⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar conversaciones" aria-label="Buscar conversaciones"/></label>
    <div className="threadList">{!visible.length&&<p className="emptyThreads">{query?'No hay coincidencias.':'No hay conversaciones autorizadas en este canal.'}</p>}
     {visible.map((t,i)=><button type="button" key={t.key} className="thread" aria-pressed={selected?.key===t.key} onClick={()=>setSelected(t)}>
      <span className={'avatar '+(t.channel==='facebook'?'fb':'ig')}>{t.channel==='facebook'?'f':'◎'}</span>
      <span className="threadCopy"><strong>{t.alias||t.profile_name||t.profile_username||(t.channel==='facebook'?`Facebook · ${new Date(t.occurred_at).toLocaleDateString('es-MX',{day:'2-digit',month:'short'})}`:'Conversación')}</strong><small>{t.channel==='facebook'?(t.preview||'Facebook Messenger'): 'Instagram Direct'}</small></span>
      <span className="threadArrow" aria-hidden="true">›</span>
     </button>)}</div>
   </aside>
   <main className="conversationPane"><button type="button" className="back" onClick={()=>setSelected(null)}>← Conversaciones</button>
    {!selected?<div className="emptyConversation"><span className="emptyIcon" aria-hidden="true">✉</span><h2>Tu bandeja, en un solo lugar</h2><p>Elige una conversación para consultar sus mensajes y dar seguimiento.</p></div>:selected.channel==='facebook'
     ?<FacebookMessengerConversation key={selected.key} thread={selected.thread_ref}
      displayName={threads.find(t=>t.key===selected.key)?.alias||threads.find(t=>t.key===selected.key)?.profile_name||''}
      onNameSaved={load}/>
     :<InstagramBusinessInbox key={selected.key+':'+historyRevision} embedded externalThread={selected.thread_ref} onBack={()=>setSelected(null)}/>}
   </main>
  </div>}
  <style jsx>{`
  .commercialInbox{height:calc(100dvh - 190px);max-height:calc(100dvh - 190px);display:flex;flex-direction:column;overflow:hidden;background:#fff;color:#202b3c;min-width:0;border:1px solid #e8e9ec;border-radius:14px;overflow:hidden}
   .inboxActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}.inboxHeader{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:24px 26px 16px;background:white}
  .eyebrow{font-size:10px;letter-spacing:1.5px;font-weight:800;color:#a4a9b4}.inboxHeader h1{margin:4px 0 2px;font-size:27px;letter-spacing:-.7px}.subtitle{font-size:12px;color:#87909c;margin:0}
  button{font:inherit;cursor:pointer}.refresh{border:1px solid #e8e9ef;border-radius:9px;padding:9px 13px;background:white;color:#657081;font-size:12px;font-weight:700}
  .channelTabs{display:flex;gap:7px;flex-wrap:wrap;padding:0 26px 16px;border-bottom:1px solid #eff0f3}.channelTabs button{display:flex;align-items:center;gap:7px;border:1px solid transparent;border-radius:9px;background:transparent;color:#788291;padding:9px 12px;font-size:12px;font-weight:700;min-height:39px}.channelTabs button.active{color:#a51d40;background:#fff2f5;border-color:#f4d8df}.counter{font-size:10px;color:inherit;background:#f1f2f5;border-radius:15px;padding:2px 6px}.active .counter{background:#f8dfe6}
  .loadWarning{background:#fff7ed;color:#9a3412;padding:10px 24px;font-size:12px;margin:0}.workspace{display:grid;grid-template-columns:minmax(255px,310px) minmax(0,1fr);flex:1;min-height:0;overflow:hidden}
  .threadsPane{display:flex;flex-direction:column;border-right:1px solid #eceef2;overflow:hidden;min-width:0}.paneHeading{display:flex;justify-content:space-between;align-items:center;padding:20px 17px 12px}.paneHeading strong{font-size:14px}.paneHeading span{color:#9299a4;font-size:11px}
  .searchBox{margin:0 13px 12px;display:flex;gap:6px;align-items:center;background:#f6f7f9;border:1px solid #edf0f2;padding:8px 11px;border-radius:10px;color:#98a1ac}.searchBox input{background:transparent;border:0;outline:none;width:100%;font-size:12px;color:#253245}.threadList{overflow-y:auto;flex:1;padding:0 8px 16px}
  .thread{width:100%;border:0;display:flex;align-items:center;gap:10px;text-align:left;padding:12px 10px;border-radius:11px;background:transparent;min-height:67px}.thread:hover{background:#f7f8fa}.thread[aria-pressed=true]{background:#fff0f4}.avatar{width:38px;height:38px;flex:0 0 38px;border-radius:50%;display:grid;place-items:center;color:white;font-size:20px;font-weight:800}.avatar.ig{background:linear-gradient(135deg,#884dda,#f14980,#f8a553)}.avatar.fb{background:#1877f2}.threadCopy{display:flex;min-width:0;flex:1;flex-direction:column;gap:5px}.threadCopy strong{font-size:12px;color:#263348;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.threadCopy small{font-size:10px;color:#929aab}.threadArrow{font-size:21px;color:#adb4c1}.emptyThreads{padding:20px 12px;color:#7d8796;font-size:12px}
  .conversationPane{min-width:0;min-height:0;overflow:hidden;background:#fafbfc;padding:0;display:flex;flex-direction:column}.conversationPane :global(.inboxShell){height:100%!important;max-height:100%!important;min-height:0;min-width:0}.conversationPane :global(.inboxShell .chatPane){min-height:0;overflow:hidden}.conversationPane :global(.inboxShell .messages){flex:1;min-height:0;overflow-y:auto}.conversationPane :global(.inboxShell .composer){flex-shrink:0}.conversationPane :global(.inboxShell .detailsPane){height:100%;min-height:0;overflow-y:auto;overscroll-behavior:contain}.conversationPane :global(.fbConversation){flex:1;min-height:0}.emptyConversation{height:100%;min-height:360px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px;color:#8791a2}.emptyIcon{display:grid;place-items:center;background:#fff1f4;color:#bb3155;border-radius:50%;width:58px;height:58px;font-size:28px}.emptyConversation h2{color:#303e51;font-size:17px;margin:20px 0 5px}.emptyConversation p{max-width:300px;font-size:12px;line-height:1.5}.back{display:none;background:transparent;border:0;color:#9b2042;padding:12px;font-weight:700}
  @media(max-width:760px){.commercialInbox{border-radius:0}.inboxHeader{padding:17px 15px 12px}.inboxHeader h1{font-size:23px}.subtitle{display:none}.channelTabs{padding:0 12px 12px;flex-wrap:nowrap;overflow-x:auto}.channelTabs button{white-space:nowrap}.commercialInbox{height:calc(100dvh - 66px);max-height:calc(100dvh - 66px)}.inboxHeader{padding:8px 12px 5px}.inboxHeader .eyebrow,.inboxHeader .subtitle{display:none}.inboxHeader h1{font-size:18px;margin:0}.inboxHeader .refresh{padding:6px 9px;min-height:34px}.channelTabs{padding:0 8px 6px}.channelTabs button{min-height:33px;padding:6px 9px}.workspace{display:block;min-height:0;flex:1;overflow:hidden}.threadsPane{height:100%;min-height:0;border:0}.conversationPane{display:none}.workspace.hasSelection .threadsPane{display:none}.workspace.hasSelection .conversationPane{display:flex;min-height:0;height:100%}.back{display:block;padding:7px 12px;font-size:13px;flex-shrink:0}.conversationPane :global(.inboxShell.embedded){height:100%!important;max-height:100%!important;min-height:0!important}.conversationPane :global(.inboxShell.embedded .chatPane){min-height:0;height:100%;display:flex;flex-direction:column}.conversationPane :global(.inboxShell.embedded .messages){flex:1;min-height:0;overflow-y:auto}.conversationPane :global(.inboxShell.embedded .composer){flex-shrink:0}}
  `}</style>
 </section>;
}
