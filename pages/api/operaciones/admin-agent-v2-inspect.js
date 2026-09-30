import {
  assertAdminAgentV2Environment,
  retrieveAdminAgentV2Session,
} from "../../../lib/agentsV2/openaiAdminAgent.js";

async function listItems(sessionId, env=process.env) {
  const response = await fetch(`https://api.openai.com/v1/agents/sessions/${encodeURIComponent(sessionId)}/items?order=asc&limit=100`, {
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "OpenAI-Beta": "agents=v1",
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`admin_agent_v2_items_failed_${response.status}`);
  return Array.isArray(body?.data) ? body.data : [];
}

const safe=(value,max=1200)=>typeof value==="string"?value.slice(0,max):value??null;
function safeItem(item) {
  return {
    id:safe(item?.id,120),
    type:safe(item?.type || item?.object,80),
    role:safe(item?.role,40),
    name:safe(item?.name,80),
    status:safe(item?.status,40),
    error:safe(item?.error,300),
    content:Array.isArray(item?.content)?item.content.map((part)=>({
      type:safe(part?.type,80),
      text:safe(part?.text || part?.output_text,1600),
    })).slice(0,12):[],
  };
}

export default async function handler(req,res) {
  res.setHeader("Cache-Control","no-store");
  if (req.method!=="GET") return res.status(405).json({ok:false,error:"method_not_allowed"});
  if (process.env.VERCEL_ENV!=="preview" || process.env.SUPABASE_ENVIRONMENT!=="dev") {
    return res.status(403).json({ok:false,error:"preview_dev_only"});
  }
  if (req.query?.confirm!=="inspect-v2-session") return res.status(403).json({ok:false,error:"explicit_inspect_confirmation_required"});
  const sessionId=String(req.query?.sessionId||"");
  if (!/^sess_[A-Za-z0-9_-]{10,}$/.test(sessionId)) return res.status(400).json({ok:false,error:"invalid_session_id"});
  try {
    assertAdminAgentV2Environment(process.env);
    const session=await retrieveAdminAgentV2Session({sessionId});
    const items=await listItems(sessionId);
    return res.status(200).json({
      ok:true,
      sessionId,
      status:session.status,
      error:session.error||null,
      requiredActions:session.required_actions||[],
      usage:session.usage||null,
      lastActiveAt:session.last_active_at||null,
      items:items.map(safeItem).slice(-30),
    });
  } catch(error) {
    return res.status(500).json({ok:false,error:String(error?.message||"inspect_failed").slice(0,180)});
  }
}
