import { authorizeShadowAdministrator } from "../../../lib/shadow/ai/apiAuth.js";
import { runShadowOutputAbVariant, SHADOW_OUTPUT_AB_FIXTURES } from "../../../lib/shadow/ai/outputAbEvaluation.js";
import { sameOriginAdminRequest } from "../../../lib/shadow/identityBootstrap.js";

const isDev = (env) => env.SUPABASE_ENVIRONMENT==="dev"&&String(env.NEXT_PUBLIC_SUPABASE_URL||"").includes("hjfwjnejbcpmknvfpdcq");
export default async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({ok:false,error:"method_not_allowed"});
  if(!await authorizeShadowAdministrator(req))return res.status(403).json({ok:false,error:"not_authorized"});
  if(!sameOriginAdminRequest(req))return res.status(403).json({ok:false,error:"invalid_origin"});
  if(!isDev(process.env)||process.env.SHADOW_AI_OUTPUT_AB_EVAL_ENABLED!=="true")return res.status(403).json({ok:false,error:"evaluation_disabled"});
  if(process.env.SHADOW_OUTBOUND_ENABLED==="true"||process.env.SHADOW_ADMIN_OUTBOUND_ENABLED==="true"||process.env.SHADOW_ADMIN_WORK_R1_ENABLED==="true")return res.status(409).json({ok:false,error:"unsafe_capability_state"});
  const fixtureId=String(req.body?.fixtureId||"");if(!Object.hasOwn(SHADOW_OUTPUT_AB_FIXTURES,fixtureId))return res.status(400).json({ok:false,error:"fixture_not_allowlisted"});
  const variant=String(req.body?.variant||"");if(!["structured","text_json_local"].includes(variant))return res.status(400).json({ok:false,error:"variant_not_allowlisted"});
  try{return res.status(200).json({ok:true,result:await runShadowOutputAbVariant(fixtureId,variant)});}catch(error){return res.status(500).json({ok:false,error:String(error?.message||"evaluation_failed").slice(0,80)});}
}
