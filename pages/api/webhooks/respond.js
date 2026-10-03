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
import { captureRespondLegalInboundIsolated } from "../../../lib/agentsV2/legalCapture";
import { processLegalInboundById } from "../../../lib/agentsV2/processLegalInbound";
import { captureRespondAppointmentLifecycleIsolated } from "../../../lib/agentsV2/respondAppointmentSync";
import { socialEligible } from "../../../lib/social/routing.js";
import { captureSocialRouteSafely } from "../../../lib/social/captureReceipt.js";
import { processSocialRouteImmediate } from "../../../lib/social/immediate.js";

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
      payload_meta: socialEligible(event) ? { ...event.payloadMeta, social_capture_required: true } : event.payloadMeta,
    });
    // Fail closed: never fall through to legacy capture after a Social Routing error.
    // Replayed webhook deliveries may recover an uncommitted route, but never enqueue twice.
    if ((!error || error.code === "23505") && socialEligible(event)) {
      const social = await captureSocialRouteSafely(admin, body, event);
      if (social.status) return res.status(200).json({ ok: true, commercial: social.status, duplicate: !social.created });
      const immediate = await processSocialRouteImmediate(admin, social, {
        SALES: processSalesInboundById, OWNER: processOwnerInboundById, LEGAL: processLegalInboundById,
      });
      return res.status(200).json({ ok: true, social: social.destination, duplicate: !social.created, status: immediate.status });
    }
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
    await captureRespondAppointmentLifecycleIsolated(admin, body);

    const legalCapture=await captureRespondLegalInboundIsolated(admin, body);
    let legalImmediate=null;
    if(legalCapture?.status==="captured"&&legalCapture?.id){
      try{
        const waitMs=Math.max(0,new Date(legalCapture.debounceUntil||0).getTime()-Date.now());
        if(waitMs>0)await sleep(Math.min(waitMs,5000));
        const {data:newer,error:newerError}=await admin.from("legal_agent_v1_inbound_messages")
          .select("id").eq("respond_contact_id",legalCapture.respondContactId)
          .gt("created_at",legalCapture.createdAt).in("status",["captured","processing","processed"]).limit(1);
        if(newerError)throw newerError;
        if((newer||[]).length){
          await admin.from("legal_agent_v1_inbound_messages").update({status:"skipped"}).eq("id",legalCapture.id).eq("status","captured");
          legalImmediate={status:"absorbed_by_newer_message"};
        }else{
          legalImmediate=await processLegalInboundById(admin,legalCapture.id,{env:process.env});
        }
      }catch(error){
        console.error("[legal-ai-immediate]",String(error?.message||"legal_immediate_failed").slice(0,160));
        legalImmediate={status:"fallback_to_cron"};
      }
    }

    const ownerCapture=legalCapture?.status==="captured"
      ? {status:"skipped",reason:"legal_intent"}
      : await captureRespondOwnerInboundIsolated(admin, body);
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
    if(legalCapture?.status!=="captured"&&ownerCapture?.status!=="captured"){
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
      legal:legalCapture?.status||null,legalImmediate:legalImmediate?.status||null,
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
