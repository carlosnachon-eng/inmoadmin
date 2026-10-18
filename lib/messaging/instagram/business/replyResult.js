// Browser-safe result reconciliation. Exactly one POST; the fallback is one
// authenticated history GET, never a resend or a claim reset.
const statuses=new Set(['accepted','failed','uncertain','blocked','disabled','already_consumed_or_blocked']);
export async function submitBusinessReply({request,thread,input,action,text}){
 try{
  const result=await request('reply',{body:{input,action,text}});
  if(result&&statuses.has(result.status)&&result.status!=='uncertain')return result;
 }catch{/* Response may be lost after the journal committed. */}
 try{
  const history=await request('history',{query:{thread}});
  const matches=Array.isArray(history?.rows)?history.rows.filter(r=>r?.input===input&&r?.action_id===action):[];
  const row=matches.length===1?matches[0]:null;
  if(row?.thread_ref===thread&&row.provider==='instagram_login_business'
   &&row.thread_type==='instagram_dm'&&row.direction==='customer_inbound'
   &&['accepted','failed','uncertain'].includes(row.status))
   return {status:row.status,source:'journal'};
 }catch{/* Unavailable or unauthorized history cannot establish an outcome. */}
 return {status:'uncertain'};
}
