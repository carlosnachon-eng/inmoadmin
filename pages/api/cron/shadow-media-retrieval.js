import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { mediaRetrievalWorkerEnabled, processOneMediaRetrieval } from "../../../lib/shadow/media/worker";

const equal=(a,b)=>{const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||""));return x.length===y.length&&timingSafeEqual(x,y);};
export const config={api:{responseLimit:"1mb"},maxDuration:30};

export default async function handler(req,res){
  if(!["GET","POST"].includes(req.method))return res.status(405).json({ok:false,error:"Método no permitido."});
  if(!process.env.CRON_SECRET||!equal(req.headers.authorization,`Bearer ${process.env.CRON_SECRET}`))return res.status(401).json({ok:false,error:"No autorizado."});
  if(!mediaRetrievalWorkerEnabled())return res.status(409).json({ok:false,error:"Media retrieval deshabilitado."});
  try{const processed=await processOneMediaRetrieval(getAdminSupabase());return res.status(200).json({ok:true,claimed:processed?1:0,processed:processed?[{id:processed.id,status:processed.status,error:processed.error||null}]:[]});}
  catch(error){console.error("[shadow-media-worker]",String(error?.code||error?.message||"worker_failed").slice(0,80));return res.status(503).json({ok:false,error:"Media retrieval pendiente."});}
}
