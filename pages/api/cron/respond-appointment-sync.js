import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { processOneRespondAppointmentSync } from "../../../lib/agentsV2/respondAppointmentSync";

export const config={maxDuration:120};
const equal=(a,b)=>{const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||""));return x.length===y.length&&timingSafeEqual(x,y);};

export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  if(!["GET","POST"].includes(req.method))return res.status(405).json({ok:false,error:"method_not_allowed"});
  if(!process.env.CRON_SECRET||!equal(req.headers.authorization,"Bearer "+process.env.CRON_SECRET))return res.status(401).json({ok:false,error:"not_authorized"});
  try{
    const admin=getAdminSupabase();
    const result=await processOneRespondAppointmentSync(admin);
    return res.status(200).json({ok:true,...result});
  }catch(error){
    console.error("[respond-appointment-sync]",String(error?.message||"appointment_sync_failed").slice(0,160));
    return res.status(503).json({ok:false,error:"appointment_sync_failed"});
  }
}