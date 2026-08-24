import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { processOperationalOutbox, processOperationalOutboxEvent } from "../../../lib/shadow/operationalEvents";
import { operationalWorkerGuard } from "../../../lib/shadow/operationalWorkerGuard";

const equal=(a,b)=>{const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||""));return x.length===y.length&&timingSafeEqual(x,y);};

export default async function handler(req,res){
  if(!["GET","POST"].includes(req.method))return res.status(405).json({ok:false,error:"Método no permitido."});
  if(!process.env.CRON_SECRET||!equal(req.headers.authorization,`Bearer ${process.env.CRON_SECRET}`))return res.status(401).json({ok:false,error:"No autorizado."});
  const guard=operationalWorkerGuard();
  if(!guard.allowed)return res.status(409).json({ok:false,error:guard.error});
  const admin=getAdminSupabase();
  try{
    const eventId=String(req.body?.eventId||req.query?.eventId||"").trim();
    const processed=eventId
      ? await processOperationalOutboxEvent(admin,eventId)
      : await processOperationalOutbox(admin);
    return res.status(200).json({ok:true,processed});
  }catch(error){
    console.error("[shadow-operational-worker]",error?.message||error);
    return res.status(503).json({ok:false,error:"Operational events permanecen pendientes."});
  }
}
