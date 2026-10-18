import {timingSafeEqual} from "node:crypto";
import {createClient} from "@supabase/supabase-js";

const BUCKET="instagram-business-outbound";
const MAX_AGE_MS=24*60*60*1000;
const MAX_DELETE=200;
const equal=(a,b)=>{const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||""));return x.length===y.length&&timingSafeEqual(x,y);};

export const config={maxDuration:60};

export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  if(req.method!=="GET")return res.status(405).json({ok:false,error:"method_not_allowed"});
  if(!process.env.CRON_SECRET||!equal(req.headers.authorization,`Bearer ${process.env.CRON_SECRET}`))return res.status(401).json({ok:false,error:"not_authorized"});
  if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)return res.status(503).json({ok:false,error:"storage_unavailable"});

  const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const storage=admin.storage.from(BUCKET);
  const cutoff=Date.now()-MAX_AGE_MS;
  const deletions=[];

  try{
    const root=await storage.list("",{limit:100,sortBy:{column:"name",order:"asc"}});
    if(root.error)throw root.error;

    for(const entry of root.data||[]){
      if(deletions.length>=MAX_DELETE)break;
      if(entry.id)continue;
      const prefix=entry.name;
      const listed=await storage.list(prefix,{limit:100,sortBy:{column:"created_at",order:"asc"}});
      if(listed.error)throw listed.error;
      for(const file of listed.data||[]){
        if(deletions.length>=MAX_DELETE)break;
        if(!file.id)continue;
        const created=Date.parse(file.created_at||file.updated_at||"");
        if(Number.isFinite(created)&&created<cutoff)deletions.push(`${prefix}/${file.name}`);
      }
    }

    if(!deletions.length)return res.status(200).json({ok:true,deleted:0});
    const removed=await storage.remove(deletions);
    if(removed.error)throw removed.error;
    return res.status(200).json({ok:true,deleted:removed.data?.length||deletions.length});
  }catch(error){
    console.error("[instagram-outbound-media-cleanup]",String(error?.message||"cleanup_failed").slice(0,120));
    return res.status(503).json({ok:false,error:"cleanup_failed"});
  }
}
