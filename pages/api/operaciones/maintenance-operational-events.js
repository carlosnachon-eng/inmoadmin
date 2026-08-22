import { authHeaderToken, getAdminSupabase, getServerSupabase } from "../../../lib/ejecutivo/workCenter";
import { validateMaintenanceScope } from "../../../lib/shadow/operationalEvents";

export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  if(req.method!=="POST")return res.status(405).json({ok:false,error:"Método no permitido."});
  try{
    const action=String(req.body?.action||"");
    if(action==="create_ticket"){
      const token=authHeaderToken(req); if(!token)return res.status(401).json({ok:false,error:"Sesión requerida."});
      validateMaintenanceScope(req.body?.ticket||{});
      const client=getServerSupabase(token);
      const {data:{user},error:authError}=await client.auth.getUser();
      if(authError||!user)return res.status(401).json({ok:false,error:"Sesión inválida."});
      const {data,error}=await client.rpc("create_maintenance_ticket_with_event",{p_ticket:req.body.ticket});
      if(error)throw error;
      return res.status(201).json({ok:true,...data});
    }
    if(action==="approve_quote"){
      const quoteId=String(req.body?.quoteId||"").trim();
      if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(quoteId))return res.status(400).json({ok:false,error:"Cotización inválida."});
      const admin=getAdminSupabase();
      const {data,error}=await admin.rpc("approve_maintenance_quote_with_event",{p_quote_id:quoteId});
      if(error)throw error;
      return res.status(200).json({ok:true,...data});
    }
    return res.status(400).json({ok:false,error:"Acción no permitida."});
  }catch(error){
    console.error("[maintenance-operational-events]",error?.message||error);
    return res.status(500).json({ok:false,error:"No se pudo completar la operación de mantenimiento."});
  }
}
