import {createHmac} from 'node:crypto';
import {ref} from '../facebook/messenger/crypto.js';
const stop=new Set('para por del las los una uno unos unas con sin desde hasta este esta esto como mas muy que sus tus nuestros nuestra emporio inmobiliario informacion informes contactanos agenda visita conoce venta renta casa departamento propiedad'.split(' '));
const normalize=s=>String(s||'').slice(0,12000).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/https?:\/\/\S+|\S+@\S+/g,' ').replace(/[^a-zñ\s]/g,' ').replace(/\s+/g,' ').trim();
const tokens=s=>new Set(normalize(s).split(' ').filter(t=>t.length>2&&!stop.has(t)));
const grams=s=>{const a=normalize(s).split(' ');return new Set(a.slice(0,-2).map((x,i)=>a.slice(i,i+3).join(' ')));};
// Deterministic observation, NOT a probability, verified association or response authority.
export function compareCopies(text,properties){
 const q=tokens(text),normalized=normalize(text),qg=grams(text);
 const docs=properties.map(p=>({p,t:tokens(p.descripcion),g:grams(p.descripcion)}));
 const df=new Map();for(const d of docs)for(const t of d.t)df.set(t,(df.get(t)||0)+1);
 const weight=t=>Math.log(1+docs.length/(1+(df.get(t)||0)));
 const scored=docs.filter(d=>d.t.size>=8).map(d=>{
  const shared=[...q].filter(t=>d.t.has(t));
  const dot=shared.reduce((s,t)=>s+weight(t)**2,0);
  const norm=s=>Math.sqrt([...s].reduce((v,t)=>v+weight(t)**2,0));
  const cosine=dot/(norm(q)*norm(d.t)||1);
  const phrases=[...qg].filter(g=>d.g.has(g)).length;
  return {public_id:d.p.public_id,score:Math.round(cosine*1000)/1000,shared_terms:shared.length,shared_trigrams:phrases,normalized_exact:normalized.length>80&&normalized===normalize(d.p.descripcion)};
 }).sort((a,b)=>b.score-a.score||a.public_id.localeCompare(b.public_id));
 const best=scored[0],margin=best?Math.round((best.score-(scored[1]?.score||0))*1000)/1000:0;
 return {status:q.size<8?'insufficient_copy':!best||best.score<0.35?'weak_similarity':margin<0.12?'ambiguous_candidates':'candidate_for_human_review',margin,candidates:q.size<8?[]:scored.slice(0,3),association_verified:false,auto_link:false};
}
export async function observeFacebookCopies({c,token,db,fetchImpl=fetch}){
 const {data,error}=await db.from('propiedades').select('public_id,descripcion').eq('status','published').order('public_id').limit(501);
 if(error||!Array.isArray(data)||data.length>500)throw Error('inventory_unavailable');
 const inventory=data.filter(p=>typeof p.public_id==='string'&&/^EMP-[A-Z0-9]{4,40}$/.test(p.public_id)&&typeof p.descripcion==='string'&&p.descripcion.trim());
 if(!inventory.length)return {status:'blocked_inventory_descriptions_missing',inventory_total:data.length,descriptions_usable:0,posts_checked:0,rows:[],writes:0,links_created:0,responses_prepared:0};
 const u=new URL('https://graph.facebook.com/v26.0/'+c.page+'/posts');u.searchParams.set('fields','id,from,message,created_time');u.searchParams.set('limit','30');
 u.searchParams.set('appsecret_proof',createHmac('sha256',c.secret).update(token).digest('hex'));
 const r=await fetchImpl(u,{method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
 const d=await r.json();if(!r.ok||d?.error)throw Error('meta_read_unavailable');
 if(!Array.isArray(d.data)||d.data.length>30)throw Error('history_shape');
 const rows=d.data.map(p=>{
  if(typeof p.id!=='string'||!/^\d{1,32}_\d{1,32}$/.test(p.id)||!p.id.startsWith(c.page+'_')||p.from?.id!==c.page)throw Error('publication_owner_denied');
  return {post_ref:ref(c,'public-post',p.id),...compareCopies(p.message,inventory)};
 });
 return {status:'copy_observation_complete',method:'weighted_lexical_cosine_v1',score_is_probability:false,inventory_total:data.length,descriptions_usable:inventory.length,posts_checked:rows.length,rows,more_posts_available:!!d.paging?.next,writes:0,links_created:0,responses_prepared:0};
}
