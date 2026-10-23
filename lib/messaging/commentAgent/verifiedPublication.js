import {publicPropertyReferences} from '../../social/publicPropertyReference.js';
// Exact authenticated publication only; comment text can never select a property.
export async function publicationFacts({publication,event,db,reference,association=null,now=Date.now()}){
 if(publication?.verified!==true||publication.platform!==event.platform||publication.connection_ref!==event.connection_ref||publication.post_ref!==event.post_ref)return null;
 const ids=publicPropertyReferences(publication.text).publicIds;
 if(association&&ids.some(id=>id!==association.public_id))return null;
 if(!association&&ids.length!==1)return null;
 let query=db.from('propiedades').select('id,public_id,status,operacion,precio,moneda,colonia,ciudad').eq('public_id',association?.public_id||ids[0]).eq('status','published');
 if(association)query=query.eq('id',association.property_id);
 const {data,error}=await query.limit(2);
 if(error)throw Error('inventory_unavailable');if(!Array.isArray(data)||data.length!==1)return null;
 const p=data[0];
 if(association&&(p.id!==association.property_id||p.public_id!==association.public_id))throw Error('association_inventory_binding');
 const price=typeof p.precio==='number'?p.precio:typeof p.precio==='string'&&/^\d+(?:\.0+)?$/.test(p.precio)?Number(p.precio):null;
 return {platform:event.platform,connection_ref:event.connection_ref,post_ref:event.post_ref,source:'inmoadmin_verified_publication',property_ref:reference(p.id),active:true,public:true,verified_at:new Date(now).toISOString(),
  price:Number.isSafeInteger(price)&&price>0?price:null,currency:p.moneda,operation:p.operacion==='sale'?'venta':p.operacion==='rental'?'renta mensual':null,
  association_source:association?.source||'exact_publication_reference',
  public_location:[p.colonia,p.ciudad].filter(x=>typeof x==='string'&&x.length<100).join(', '),public_id:p.public_id};
}

// Read-only Graph adapter. No arbitrary host, redirects, pagination URLs or values logged.
export async function inspectMetaComment({platform,account,comment,post,token,fetchImpl=fetch}){
 const id=x=>typeof x==='string'&&/^\d{1,32}(?:_\d{1,32})?$/.test(x);
 if(!['instagram','facebook'].includes(platform)||![account,comment,post].every(id))throw Error('reference_denied');
 const host=platform==='instagram'?'graph.instagram.com':'graph.facebook.com';
 async function get(node,fields){
  const u=new URL(`https://${host}/v26.0/${node}`);u.searchParams.set('fields',fields);
  if(platform==='facebook'&&node===`${post}/comments`){u.searchParams.set('limit','100');u.searchParams.set('filter','toplevel');}
  if(platform==='facebook'&&node===`${comment}/comments`)u.searchParams.set('limit','100');
  const r=await fetchImpl(u,{method:'GET',headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('meta_read_unavailable');const data=await r.json();if(data?.error)throw Error('meta_read_unavailable');return data;
 }
 const p=await get(post,platform==='instagram'?'id,owner,caption':'id,from,message');
 const owner=platform==='instagram'?p.owner?.id:p.from?.id;
 if(p.id!==post||owner!==account)throw Error('publication_owner_denied');
 if(platform==='facebook'){
  // parent identifies a parent COMMENT, not a post. Prove exact membership
  // through the authenticated owned post edge; never guess from ID prefixes.
  const edge=await get(`${post}/comments`,'id');
  if(!Array.isArray(edge.data)||edge.data.length>100||!edge.data.every(r=>id(r.id))
   ||edge.data.filter(r=>r.id===comment).length!==1)throw Error('comment_post_denied');
  // No pagination URL followed. A missing candidate remains unverified.
 }
 const node=await get(comment,platform==='instagram'?'id,media,from,replies.limit(100){id,from,text}':'id,parent,from,is_hidden');
 if(node.id!==comment||(platform==='instagram'?node.media?.id!==post:node.parent!=null))throw Error('comment_post_denied');
 // Facebook may omit expanded comments even with HTTP 200. Read the exact
 // comment edge only after ownership and membership have been authenticated.
 const replies=platform==='instagram'?node.replies:await get(`${comment}/comments`,'id,from');
 // Incomplete pagination/hidden identities are unknown, never proof of no reply.
 const complete=Array.isArray(replies?.data)&&replies.data.length<=100&&!replies.paging?.next&&replies.data.every(r=>id(r?.id)&&id(r?.from?.id));
 return {verified:true,publicationText:platform==='instagram'?p.caption:p.message,replies_verified:complete,
  replied:complete&&replies.data.some(r=>r.from.id===account),own_author:node.from?.id===account,deleted:node.is_hidden===true};
}
