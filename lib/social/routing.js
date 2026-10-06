import { createHash } from "node:crypto";
import { hasLegalIntent } from "../agentsV2/legalCapture.js";
import { hasOwnerIntent } from "../agentsV2/ownerCapture.js";
import { salesMessageText } from "../agentsV2/salesCapture.js";
import { sanitizeShadowText } from "../shadow/coordinator.js";
import { readSocialContinuity, ownerTransition } from "./continuity.js";
import { isCommercialServiceOffer, isShortSocialCta } from "./commercialIntent.js";
import { resolvePublicPropertyReference } from "./publicPropertyReference.js";
import { hasOwnerAcquisitionRequest } from "./ownerAcquisitionIntent.js";

export const SOCIAL_DESTINATIONS = Object.freeze(["SALES", "OWNER", "ADMINISTRATION", "LEGAL", "EXISTING_CLIENT", "HUMAN_REVIEW", "UNKNOWN"]);
export const SOCIAL_CHANNELS = Object.freeze({ "497382": "instagram", "497385": "tiktok", "498219": "whatsapp", "515318": "facebook_messenger" });
const REASONS = new Set(["sensitive_or_complaint", "identity_ambiguous", "administration_intent", "existing_client_review", "legal_intent", "owner_intent", "sales_intent", "conversation_continuity", "whatsapp_compatible_fallback", "classification_uncertain", "sanitization_rejected", "owner_explicit_closure", "explicit_intent_change", "commercial_service_offer", "verified_property_context", "cta_clarification_required", "late_message_requires_review"]);
export const socialRoutingEnabled = (env = process.env) => env.SOCIAL_ROUTING_V1_ENABLED === "true";
export const socialEligible = (event, env = process.env) => socialRoutingEnabled(env)
  && event?.eventType === "message.received" && Object.hasOwn(SOCIAL_CHANNELS, String(event?.channelId));
const id = (v) => typeof v === "string" || Number.isSafeInteger(v) ? (/^[A-Za-z0-9_.:-]{1,200}$/.test(String(v)) ? String(v) : null) : null;
const normalized = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Only explicit identifier fields are retained. Never spread arbitrary provider metadata.
// The platform is a configured channel mapping, not an inference from message text.
export function socialAttribution(body, event) {
  const explicit = body?.source || {};
  const referral = body?.message?.referral || body?.referral || {};
  const pick = (...values) => values.map(id).find(Boolean) || null;
  const metadata = {};
  const suppliedMetadata = explicit.metadata || body?.source_metadata || {};
  if (["dm", "private_reply", "comment", "ad", "post", "reel", "story"].includes(suppliedMetadata.origin_kind)) metadata.origin_kind = suppliedMetadata.origin_kind;
  if (["text", "image", "video", "audio"].includes(suppliedMetadata.media_type)) metadata.media_type = suppliedMetadata.media_type;
  return {
    source_platform: SOCIAL_CHANNELS[String(event.channelId)] || null,
    source_channel_id: id(event.channelId), source_event_id: id(event.eventId), source_message_id: id(event.messageId),
    source_post_id: pick(explicit.post_id, body?.post?.id, referral.post_id),
    source_comment_id: pick(explicit.comment_id, body?.comment?.id, referral.comment_id),
    source_ad_id: pick(explicit.ad_id, body?.ad?.id, referral.ad_id),
    source_campaign_id: pick(explicit.campaign_id, body?.campaign?.id, referral.campaign_id),
    // Must be validated against the catalog server-side before assigning this field.
    source_property_id: null,
    source_metadata: Object.keys(metadata).length ? metadata : null,
  };
}

export function classifySocialRoute({ text, channelId, identityStatus = "unresolved", previousDestination = null, recentOwner = false, verifiedProperty = false }) {
  const t = normalized(text);
  const result = (destination, reason) => ({ destination, reason });
  if (/\b(quejas?|reclamos?|amenazas?|amenazar|violencia|acoso|fraude|estafa|demandas?|denuncias?|conflicto|rechazaron|rechazad[oa]|aprobaron|excepciones?|excepcion|desalojo|incumplimiento|rescision|mi expediente|mi dictamen|problema legal|me rechazo|negociar contrato|cambiar contrato|quitar pagare|emergencia|urgencia medica|peligro)\b/.test(t)) return result("HUMAN_REVIEW", "sensitive_or_complaint");
  if (identityStatus === "ambiguous") return result("HUMAN_REVIEW", "identity_ambiguous");
  if (previousDestination === "OWNER" || recentOwner) return ownerTransition(text) || result("OWNER", "conversation_continuity");
  if (isCommercialServiceOffer(text)) return result("HUMAN_REVIEW", "commercial_service_offer");
  if (/\b(administracion|administrar|administren|administrador|condominio|mantenimiento|inquilino actual)\b/.test(t)) return result("ADMINISTRATION", "administration_intent");
  if (/\b(ya soy cliente|soy cliente|mi asesor|mi cita|mi contrato actual)\b/.test(t)) return result("EXISTING_CLIENT", "existing_client_review");
  // Existing specialized intent expressions, unchanged; Legal retains priority over Owner.
  if (hasLegalIntent(text)) return result("LEGAL", "legal_intent");
  if (hasOwnerIntent(text) || hasOwnerAcquisitionRequest(text) || recentOwner) return result("OWNER", "owner_intent");
  if (verifiedProperty) return result("SALES", "verified_property_context");
  if (/\b(busco|comprar|rentar|renta|venta|departamento|casa|terreno|inmueble|propiedad|precio|disponible|visita|cita)\b/.test(t)) return result("SALES", "sales_intent");
  if (["SALES", "OWNER", "LEGAL"].includes(previousDestination) && t.trim()) return result(previousDestination, "conversation_continuity");
  // New plural evidence requires a property inquiry, not "opciones" / "manejan"
  // alone. Ownership/offers that existing Owner rules cannot resolve stay on
  // their existing continuity/review path, rather than gaining SALES authority.
  const pluralPropertyQuery = /\b(departamentos|casas|terrenos|inmuebles|propiedades)\b/.test(t)
    && /\b(opciones|informacion|informes|detalles|tienen|tendran?|manejan|ofrecen|me interesan|estoy buscando)\b/.test(t)
    && !/\b(mis|tengo|tenemos|ofrezco|ofrecemos)\b/.test(t);
  if (pluralPropertyQuery) return result("SALES", "sales_intent");
  if (isShortSocialCta(text)) return result("SALES", "cta_clarification_required");
  // Preserve WhatsApp's existing commercial fallback; unsafe intents still take precedence.
  if (String(channelId) === "498219" && t.trim()) return result("SALES", "whatsapp_compatible_fallback");
  return result("UNKNOWN", "classification_uncertain");
}

export async function readSocialIdentity(admin, contactId) {
  const { data, error } = await admin.from("respond_identity_links")
    .select("client_identity_id,link_status").eq("respond_contact_id", contactId).in("link_status", ["confirmed", "conflict"]).limit(3);
  if (error) throw error;
  if ((data || []).some((x) => x.link_status === "conflict") || (data || []).length > 1) return { status: "ambiguous", canonicalId: null };
  const link = data?.[0];
  if (!link?.client_identity_id) return { status: "unresolved", canonicalId: null };
  const identity = await admin.from("client_identities").select("id,status").eq("id", link.client_identity_id).maybeSingle();
  if (identity.error) throw identity.error;
  return identity.data?.status === "active" ? { status: "confirmed", canonicalId: identity.data.id } : { status: "unresolved", canonicalId: null };
}

export async function captureSocialRoute(admin, body, event, { env = process.env, now = () => new Date(), onStage = () => {} } = {}) {
  if (!socialEligible(event, env)) return { handled: false };
  if (!id(event.eventId) || !id(event.respondContactId) || !id(event.messageId)) throw new Error("social_missing_stable_message_identity");
  const safe = sanitizeShadowText(salesMessageText(body));
  onStage("identity");
  const identity = await readSocialIdentity(admin, event.respondContactId);
  onStage("context");
  const continuity = await readSocialContinuity(admin, event.respondContactId, event.channelId, event.eventOccurredAt || now().toISOString());
  if(safe.rejected&&continuity.owner&&(body?.message?.attachment||body?.message?.attachments?.length)){
    safe.rejected=false;
    safe.text="[Adjunto recibido; contenido no interpretado]";
  }
  const attribution = socialAttribution(body, event);
  const propertyRef = id(body?.source?.property_id);
  onStage("reference");
  const reference = await resolvePublicPropertyReference(admin, salesMessageText(body), propertyRef);
  attribution.source_property_id = reference.propertyId;
  // Existing schema stores only the verified catalog FK; unresolved links stay
  // [URL] in sanitized text. Do not broaden the metadata constraint or retain URL.
  const decision = continuity.late ? { destination: "HUMAN_REVIEW", reason: "late_message_requires_review" }
    : safe.rejected ? { destination: "HUMAN_REVIEW", reason: "sanitization_rejected" }
    : classifySocialRoute({ text: safe.text, channelId: event.channelId, identityStatus: identity.status, previousDestination: continuity.previous?.destination, recentOwner: continuity.owner, verifiedProperty: Boolean(attribution.source_property_id) });
  onStage("capture_rpc");
  const { data, error } = await admin.rpc("capture_social_route_v1", { p_route: {
    ...attribution, ...decision, respond_contact_id: event.respondContactId,
    identity_status: identity.status, canonical_identity_id: identity.canonicalId,
    previous_route_id: continuity.previous?.id || null,
    occurred_at: event.eventOccurredAt || now().toISOString(),
    sanitized_text: safe.rejected ? "" : safe.text.slice(0, 2000),
  } });
  if (error) throw error; // Never fall through to another agent on persistence failure.
  return { handled: true, ...data };
}

export const opaqueSocialRef = (value) => value ? createHash("sha256").update(`social:${value}`).digest("hex").slice(0, 16) : null;
export function socialRouteReview(row) {
  return { routeRef: opaqueSocialRef(row.id), contactRef: opaqueSocialRef(row.respond_contact_id),
    destination: SOCIAL_DESTINATIONS.includes(row.destination) ? row.destination : "UNKNOWN",
    reason: REASONS.has(row.reason) ? row.reason : "unknown",
    status: row.inbound_id ? "queued_specialist" : "requires_human_review",
    identityStatus: ["confirmed", "unresolved", "ambiguous"].includes(row.identity_status) ? row.identity_status : "unresolved",
    source: { platform: Object.values(SOCIAL_CHANNELS).includes(row.source_platform) ? row.source_platform : null, channelId: Object.hasOwn(SOCIAL_CHANNELS, row.source_channel_id) ? row.source_channel_id : null, eventRef: opaqueSocialRef(row.source_event_id),
      messageRef: opaqueSocialRef(row.source_message_id), postRef: opaqueSocialRef(row.source_post_id), commentRef: opaqueSocialRef(row.source_comment_id),
      adRef: opaqueSocialRef(row.source_ad_id), campaignRef: opaqueSocialRef(row.source_campaign_id), propertyRef: opaqueSocialRef(row.source_property_id) },
    occurredAt: row.occurred_at, createdAt: row.created_at };
}
