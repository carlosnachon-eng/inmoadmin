import {
  assertSupabaseEnvironment,
  getAdminSupabase,
} from "../../../lib/ejecutivo/workCenter";
import { assertRespondIncrementalWebhooksEnabled } from "../../../lib/ejecutivo/respondSync";
import {
  extractRespondWebhookEvent,
  isValidRespondWebhookSignature,
  readRespondWebhookBody,
  resolveRespondWebhookSigningKeys,
} from "../../../lib/ejecutivo/respondWebhook";
import { captureRespondAdminShadowIsolated } from "../../../lib/shadow/providers/respondAdmin";
import { routeRespondMessageIsolated } from "../../../lib/respond/channelRouter";
import { captureRespondMediaReferenceIsolated } from "../../../lib/shadow/media/reference";
import { captureRespondSalesV2InboundIsolated } from "../../../lib/agentsV2/salesCapture";
import { processSalesInboundById } from "../../../lib/agentsV2/processSalesInbound";
import { captureRespondOwnerInboundIsolated } from "../../../lib/agentsV2/ownerCapture";
import { processOwnerInboundById } from "../../../lib/agentsV2/processOwnerInbound";

const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

export const config = {
  maxDuration: 120,
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  try {
    assertSupabaseEnvironment();
    assertRespondIncrementalWebhooksEnabled();
    const signingKeys = resolveRespondWebhookSigningKeys();

    const body = await readRespondWebhookBody(req);
    const signature = req.headers["x-webhook-signature"];
    if (!isValidRespondWebhookSignature(body, signature, signingKeys)) {
      return res.status(401).json({ ok: false, error: "Firma invalida." });
    }

    const event = extractRespondWebhookEvent(body);
    if (!event.supported) return res.status(200).json({ ok: true, skipped: "unsupported_event" });
    if (!event.eventId || !event.respondContactId) {
      return res.status(400).json({ ok: false, error: "Evento sin event_id o contact.id." });
    }

    const admin = getAdminSupabase();
    const { error } = await admin.from("gv_respond_webhook_events").insert({
      event_id: event.eventId,
      event_type: event.eventType,
      respond_contact_id: event.respondContactId,
      event_occurred_at: event.eventOccurredAt,
      message_id: event.messageId,
      payload_meta: event.payloadMeta,
    });
    if (error?.code === "23505") {
      await captureRespondAdminShadowIsolated(admin, body);
      await captureRespondMediaReferenceIsolated(admin, body);
      return res.status(200).json({ ok: true, duplicate: true });
    }
    if (error) throw error;

    const routing = await routeRespondMessageIsolated(event);
    if (routing.audit && routing.reason !== "disabled") {
      const { error: auditError } = await admin
        .from("gv_respond_webhook_events")
        .update({ payload_meta: { ...event.payloadMeta, routing: routing.audit } })
        .eq("event_id", event.eventId);
      if (auditError) console.error("[respond-channel-router-audit]", auditError.message || "audit_failed");
    }

    await captureRespondAdminShadowIsolated(admin, body);
    await captureRespondMediaReferenceIsolated(admin, body);

    const ownerCapture=await captureRespondOwnerInboundIsolated(admin, body);
    let ownerImmediate=null;
    if(ownerCapture?.status==="captured"&&ownerCapture?.id){
      try{
        const waitMs=Math.max(0,new Date(ownerCapture.debounceUntil||0).getTime()-Date.now());
        if(waitMs>0)await sleep(Math.min(waitMs,5000));

        const {data:newer,error:newerError}=await admin.from("owner_agent_v1_inbound_messages")
          .select("id")
          .eq("respond_contact_id",ownerCapture.respondContactId)
          .gt("created_at",ownerCapture.createdAt)
          .in("status",["captured","processing","processed"])
          .limit(1);
        if(newerError)throw newerError;

        if((newer||[]).length){
          await admin.from("owner_agent_v1_inbound_messages")
            .update({status:"skipped"}).eq("id",ownerCapture.id).eq("status","captured");
          ownerImmediate={status:"absorbed_by_newer_message"};
        }else{
          ownerImmediate=await processOwnerInboundById(admin,ownerCapture.id,{env:process.env});
        }
      }catch(error){
        console.error("[owner-ai-immediate]",String(error?.message||"owner_immediate_failed").slice(0,160));
        ownerImmediate={status:"fallback_to_cron"};
      }
    }

    let salesCapture={status:"skipped",reason:"owner_intent"};
    let salesImmediate=null;
    if(ownerCapture?.status!=="captured"){
      salesCapture=await captureRespondSalesV2InboundIsolated(admin, body);
      const immediateEnabled=process.env.SALES_AGENT_V2_IMMEDIATE_ENABLED!=="false"
        && process.env.SALES_AGENT_V2_AUTO_SHADOW_ENABLED==="true";
      if(immediateEnabled&&salesCapture?.status==="captured"&&salesCapture?.id){
        try{
          const waitMs=Math.max(0,new Date(salesCapture.debounceUntil||0).getTime()-Date.now());
          if(waitMs>0)await sleep(Math.min(waitMs,5000));

          const {data:newer,error:newerError}=await admin.from("sales_agent_v2_inbound_messages")
            .select("id")
            .eq("respond_contact_id",salesCapture.respondContactId)
            .gt("created_at",salesCapture.createdAt)
            .in("status",["captured","processing","processed"])
            .limit(1);
          if(newerError)throw newerError;

          if((newer||[]).length){
            await admin.from("sales_agent_v2_inbound_messages")
              .update({status:"skipped"})
              .eq("id",salesCapture.id)
              .eq("status","captured");
            salesImmediate={status:"absorbed_by_newer_message"};
          }else{
            salesImmediate=await processSalesInboundById(admin,salesCapture.id,{env:process.env});
          }
        }catch(error){
          console.error("[sales-v2-immediate]",String(error?.message||"immediate_processing_failed").slice(0,160));
          salesImmediate={status:"fallback_to_cron"};
        }
      }
    }

    return res.status(200).json({
      ok:true,queued:true,
      owner:ownerCapture?.status||null,ownerImmediate:ownerImmediate?.status||null,
      sales:salesCapture?.status||null,salesImmediate:salesImmediate?.status||null
    });
  } catch (error) {
    if (error?.statusCode === 404) return res.status(404).json({ ok: false, error: "Not Found" });
    if (error?.statusCode === 413) return res.status(413).json({ ok: false, error: error.message });
    if (error?.statusCode === 400) return res.status(400).json({ ok: false, error: error.message });
    console.error("[respond-webhook]", error?.code || error?.message || "receiver_failed");
    return res.status(503).json({ ok: false, error: "No se pudo persistir el evento." });
  }
}
