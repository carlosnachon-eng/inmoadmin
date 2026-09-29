import { assertManualTurnDev } from "./manualTurnContext.js";
import { authorizeManualTurn, executeManualTurn, readManualTurn, readManualTurnForMessage } from "./manualTurn.js";

export function manualTurnSameOrigin(req) {
  const host = String(req.headers?.host || "");
  let browserRead = false;
  try { browserRead = req.method === "GET" && req.headers["sec-fetch-site"] === "same-origin"
    && new URL(req.headers.referer).origin === `http://${host}`; } catch { /* absent/invalid referer fails closed */ }
  return /^(localhost|127\.0\.0\.1):\d{1,5}$/.test(host)
    && (req.headers?.origin === `http://${host}` || (!req.headers?.origin && browserRead))
    && !req.headers["x-forwarded-host"] && !req.headers["x-forwarded-proto"];
}
export function createManualTurnHandler({ authorize,createAdmin,env=process.env,executionOptions={} }) {
  return async (req,res) => {
    res.setHeader("Cache-Control","private, no-store");
    try {
      assertManualTurnDev(env);
      if (!manualTurnSameOrigin(req)) return res.status(403).json({ok:false,error:"same_origin_required"});
      const actor = await authorize(req);
      if (actor?.active !== true || actor?.role_id !== "admin") return res.status(403).json({ok:false,error:"admin_required"});
      const db = createAdmin();
      if (req.method === "GET") {
        if (Object.keys(req.query || {}).some((k)=>!["mode","authorizationRef","messageRef"].includes(k)) || Boolean(req.query.authorizationRef)===Boolean(req.query.messageRef)) return res.status(400).json({ok:false,error:"manual_request_invalid"});
        const result=req.query.authorizationRef?await readManualTurn(db,req.query.authorizationRef,actor):await readManualTurnForMessage(db,req.query.messageRef,actor);
        return res.status(200).json({ok:true,...result});
      }
      if (req.method !== "POST") return res.status(405).json({ok:false,error:"method_not_allowed"});
      const body=req.body || {}, action=body.action;
      const allowed=action==="authorize"?["mode","action","messageRef"]:["mode","action","authorizationRef"];
      if (!["authorize","execute"].includes(action) || Object.keys(body).some((k)=>!allowed.includes(k))) return res.status(400).json({ok:false,error:"manual_request_invalid"});
      const result=action==="authorize"?await authorizeManualTurn(db,body.messageRef,actor,env)
        :await executeManualTurn(db,body.authorizationRef,actor,{...executionOptions,env});
      return res.status(action==="authorize" && result.created?201:200).json({ok:true,...result});
    } catch (error) {
      const known=new Set(["manual_turn_dev_isolation_required","manual_context_limit","manual_attachment_review_required","manual_turn_not_eligible","manual_reference_invalid","manual_authorization_invalid","manual_persistence_uncertain"]);
      return res.status(409).json({ok:false,error:known.has(error.message)?error.message:"manual_turn_rejected"});
    }
  };
}
