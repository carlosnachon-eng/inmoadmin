import {useEffect,useState} from 'react';
import {supabase} from '../lib/supabase';
export default function FacebookReceivedMedia({input,index,type}){
 const [url,setUrl]=useState(''),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let active=true,created='';setError(false);setUrl('');
  (async()=>{
   const {data}=await supabase.auth.getSession();
   if(!data?.session)throw Error('session');
   const q=new URLSearchParams({input,index:String(index)});
   const r=await fetch('/api/operaciones/facebook-messenger-media?'+q,{
    headers:{Authorization:'Bearer '+data.session.access_token},cache:'no-store'});
   if(!r.ok)throw Error('media');
   const blob=await r.blob();
   if(active){created=URL.createObjectURL(blob);setUrl(created);}
  })().catch(()=>{if(active)setError(true)});
  return()=>{active=false;if(created)URL.revokeObjectURL(created)};
 },[input,index,type,attempt]);
 if(error)return <div><small>Adjunto no disponible</small> <button type="button" onClick={()=>setAttempt(n=>n+1)}>Reintentar carga</button></div>;
 if(!url)return <small>Cargando adjunto…</small>;
 if(type==='image')return <img src={url} alt="Imagen recibida" style={{maxWidth:'100%',maxHeight:320}}/>;
 if(type==='audio')return <audio controls src={url}/>;
 if(type==='video')return <video controls src={url} style={{maxWidth:'100%',maxHeight:320}}/>;
 return <a href={url} download="archivo-facebook.pdf">Descargar archivo</a>;
}
