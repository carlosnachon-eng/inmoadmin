import {
  MANAGEMENT_ROLES,
  assertSupabaseEnvironment,
  authHeaderToken,
  getAdminSupabase,
  getServerSupabase,
} from "../../../lib/ejecutivo/workCenter";

const monthBounds=(month)=>{
  const m=/^\d{4}-\d{2}$/.test(String(month||""))?String(month):new Date().toLocaleDateString("en-CA",{timeZone:"America/Mexico_City"}).slice(0,7);
  const [y,mo]=m.split("-").map(Number);
  const ny=mo===12?y+1:y,nm=mo===12?1:mo+1;
  return{month:m,start:m+"-01T00:00:00-06:00",end:String(ny)+"-"+String(nm).padStart(2,"0")+"-01T00:00:00-06:00"};
};
const summarize=(rows)=>({
  runs:(rows||[]).length,
  meteredRuns:(rows||[]).filter(r=>r.total_tokens!==null&&r.total_tokens!==undefined).length,
  inputTokens:(rows||[]).reduce((s,r)=>s+Number(r.input_tokens||0),0),
  outputTokens:(rows||[]).reduce((s,r)=>s+Number(r.output_tokens||0),0),
  totalTokens:(rows||[]).reduce((s,r)=>s+Number(r.total_tokens||0),0),
  estimatedCostUsd:Number((rows||[]).reduce((s,r)=>s+Number(r.estimated_cost_usd||0),0).toFixed(8)),
});

export default async function handler(req,res){
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  if(req.method!=="GET")return res.status(405).json({ok:false,error:"method_not_allowed"});
  try{
    assertSupabaseEnvironment();
    const jwt=authHeaderToken(req);
    if(!jwt)return res.status(401).json({ok:false,error:"Sesion requerida."});
    const scoped=getServerSupabase(jwt),admin=getAdminSupabase();
    const {data:{user},error:userError}=await scoped.auth.getUser();
    if(userError||!user)return res.status(401).json({ok:false,error:"Sesion invalida."});
    const {data:profile,error:profileError}=await admin.from("profiles").select("id,role_id,active").eq("id",user.id).maybeSingle();
    if(profileError)throw profileError;
    if(!profile?.active||!MANAGEMENT_ROLES.has(profile.role_id))return res.status(403).json({ok:false,error:"No autorizado."});

    const bounds=monthBounds(req.query.month);
    const fields="id,model,input_tokens,output_tokens,total_tokens,estimated_cost_usd,completed_at";
    const [sales,owner,legal,adminRuns]=await Promise.all([
      admin.from("sales_agent_v2_shadow_runs").select(fields).gte("completed_at",bounds.start).lt("completed_at",bounds.end),
      admin.from("owner_agent_v1_runs").select(fields).gte("completed_at",bounds.start).lt("completed_at",bounds.end),
      admin.from("legal_agent_v1_runs").select(fields).gte("completed_at",bounds.start).lt("completed_at",bounds.end),
      admin.from("shadow_ai_runs").select("id,model,input_tokens,output_tokens,estimated_cost_usd,completed_at").gte("completed_at",bounds.start).lt("completed_at",bounds.end),
    ]);
    const first=[sales,owner,legal,adminRuns].find(x=>x.error)?.error;if(first)throw first;
    const adminNormalized=(adminRuns.data||[]).map(r=>({...r,total_tokens:Number(r.input_tokens||0)+Number(r.output_tokens||0)}));
    const agents=[
      {key:"sales",label:"Ventas IA",...summarize(sales.data)},
      {key:"owners",label:"Propietarios IA",...summarize(owner.data)},
      {key:"legal",label:"Jurídico IA",...summarize(legal.data)},
      {key:"admin",label:"Administración IA",...summarize(adminNormalized)},
    ];
    const total={
      runs:agents.reduce((s,a)=>s+a.runs,0),
      meteredRuns:agents.reduce((s,a)=>s+a.meteredRuns,0),
      inputTokens:agents.reduce((s,a)=>s+a.inputTokens,0),
      outputTokens:agents.reduce((s,a)=>s+a.outputTokens,0),
      totalTokens:agents.reduce((s,a)=>s+a.totalTokens,0),
      estimatedCostUsd:Number(agents.reduce((s,a)=>s+a.estimatedCostUsd,0).toFixed(8)),
    };
    return res.status(200).json({ok:true,month:bounds.month,agents,total});
  }catch(error){
    console.error("[ai-usage]",String(error?.message||"ai_usage_failed").slice(0,160));
    return res.status(500).json({ok:false,error:"No se pudo cargar el consumo de IA."});
  }
}