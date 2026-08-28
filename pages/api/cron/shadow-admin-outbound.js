import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase } from "../../../lib/ejecutivo/workCenter";
import { processOneAdminOutbound } from "../../../lib/shadow/ai/adminOutbound";
const equal=(a,b)=>{const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||""));return x.length===y.length&&timingSafeEqual(x,y);};
export const config={maxDuration:30};
export default async function handler(req,res){
  if(!["GET","POST"].includes(req.method))return res.status(405).json({ok:false,error:"Método no permitido."});
  if(!process.env.CRON_SECRET||!equal(req.headers.authorization,`Bearer ${process.env.CRON_SECRET}`))return res.status(401).json({ok:false,error:"No autorizado."});
  try{const result=await processOneAdminOutbound(getAdminSupabase());return res.status(200).json({ok:true,claimed:result.status==="no_work"?0:1,processed:result.status==="no_work"?[]:[{id:result.id,status:result.status,error:result.error||result.reason||null}]});}
  catch(error){const status=Number(error?.statusCode||503);console.error("[shadow-admin-outbound]",String(error?.message||"admin_outbound_failed").slice(0,80));return res.status(status).json({ok:false,error:status===409?"Admin outbound deshabilitado.":"Admin outbound no procesado."});}
}
