import { validateShadowToolArguments } from "../context.js";

const ROLE_WORD = /\b(?:inquilin[oa]s?|tenant|propietari[oa]s?|owner)\b/gi;
const TENANT_WORD = /\b(?:inquilin[oa]s?|tenant)\b/i;
const OWNER_WORD = /\b(?:propietari[oa]s?|owner)\b/i;
const CONTACT_ASSERTION = /\b(?:el contacto|la persona|el remitente|la remitente)\b[^.!?]{0,120}(?:afirm[aoó]|confirm[aoó]|dij[oa]|indic[aoó]|inform[aoó]|report[aoó]|señal[aoó]|est[aá] pendiente)/i;
const UNRESOLVED_ROLE_AS_CONTACT = /(?:^|[.!?;]\s*)(?:el\s+|la\s+)?(?:inquilin[oa]|tenant|propietari[oa]|owner)\b[^.!?;]{0,80}\b(?:agradece|confirma|consulta|dice|informa|indica|necesita|pregunta|quiere|responde|señala|solicita|est[aá]\s+pendiente)\b/i;
const STOP_WORDS = new Set(["a","al","de","del","el","en","es","la","las","lo","los","nos","para","por","que","se","su","un","una","y","ya"]);

export const priorConversationActor = (direction) => direction === "inbound" ? "contact"
  : direction === "outbound_human" ? "emporio_human"
    : direction === "outbound_ai_inmoadmin" ? "emporio_ai" : null;

export function actorAwarePriorConversation(items = []) {
  return items.flatMap((item) => {
    const actor = priorConversationActor(item?.direction);
    return actor ? [{ direction: item.direction, actor, sanitizedText: String(item?.sanitizedText || "") }] : [];
  });
}

const identityRow = (tools = []) => tools
  .filter((tool) => tool?.ok && tool.name === "resolve_contact_identity")
  .flatMap((tool) => tool.result || [])
  .find((row) => row?.entityType === "contact_identity" && row?.resolved === true && row?.status === "confirmed");

export function confirmedIdentityRoles(tools = []) {
  const row = identityRow(tools);
  return row ? [...new Set((row.roles || []).map((role) => String(role).toLowerCase()).filter((role) => role === "tenant" || role === "owner"))] : [];
}

const words = (value) => new Set(String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{3,}/g)?.filter((word) => !STOP_WORDS.has(word)) || []);
const overlap = (left, right) => [...left].filter((word) => right.has(word)).length;
const narrativeEntries = (decision) => [
  ["summary", decision.summary], ["contextAssessment", decision.contextAssessment], ["proposedAction", decision.proposedAction],
  ["acknowledgement", decision.conversationalResponseParts?.acknowledgement],
  ["clarificationQuestion", decision.conversationalResponseParts?.clarificationQuestion],
  ["escalationMessage", decision.conversationalResponseParts?.escalationMessage],
].filter(([, value]) => typeof value === "string" && value);

function neutralizeRoleWords(value) {
  return String(value || "").replace(ROLE_WORD, "contacto");
}

function neutralizeDecisionRoles(decision) {
  for (const key of ["summary", "contextAssessment", "proposedAction"]) if (typeof decision[key] === "string") decision[key] = neutralizeRoleWords(decision[key]);
  for (const key of ["acknowledgement", "clarificationQuestion", "escalationMessage"]) {
    if (typeof decision.conversationalResponseParts?.[key] === "string") decision.conversationalResponseParts[key] = neutralizeRoleWords(decision.conversationalResponseParts[key]);
  }
}

function directCanonicalRoleContradiction(text, roles) {
  const value = String(text || "");
  if (roles.includes("owner") && TENANT_WORD.test(value) && UNRESOLVED_ROLE_AS_CONTACT.test(value)) return true;
  if (roles.includes("tenant") && OWNER_WORD.test(value) && UNRESOLVED_ROLE_AS_CONTACT.test(value)) return true;
  if (roles.includes("owner") && /\b(?:el contacto|la persona|el remitente|la remitente)\b[^.!?]{0,50}\b(?:es|como|rol)\b[^.!?]{0,30}\b(?:inquilin[oa]|tenant)\b/i.test(value)) return true;
  if (roles.includes("tenant") && /\b(?:el contacto|la persona|el remitente|la remitente)\b[^.!?]{0,50}\b(?:es|como|rol)\b[^.!?]{0,30}\b(?:propietari[oa]|owner)\b/i.test(value)) return true;
  return false;
}

export function attributesHumanOutboundToContact(decision, priorConversation = []) {
  const outbound = actorAwarePriorConversation(priorConversation).filter((item) => item.actor === "emporio_human");
  if (!outbound.length) return false;
  return narrativeEntries(decision).some(([, text]) => {
    if (!CONTACT_ASSERTION.test(text)) return false;
    const candidate = words(text);
    return outbound.some((item) => overlap(candidate, words(item.sanitizedText)) >= 3);
  });
}

export function hasUnplannableEmptyPropertyLookup(decision) {
  return (decision?.proposedToolCalls || []).some((call) => call?.tool === "find_properties" && (
    (Object.hasOwn(call?.arguments || {}, "propertyReference") && !String(call.arguments.propertyReference || "").trim())
    || (Object.hasOwn(call?.arguments || {}, "propertyId") && !String(call.arguments.propertyId || "").trim())
  ));
}

export function plannableShadowToolCalls(decision) {
  return (decision?.proposedToolCalls || []).filter((call) => {
    try { validateShadowToolArguments(call?.tool, call?.arguments); return true; }
    catch { return false; }
  });
}

export function applyActorRoleGuards(decision, envelope = {}, tools = []) {
  const next = structuredClone(decision);
  next.safetyFlags = Array.isArray(next.safetyFlags) ? next.safetyFlags : [];
  const roles = confirmedIdentityRoles(tools);
  const narrative = narrativeEntries(next).map(([, value]) => value).join(" ");
  const unresolvedRoleAttribution = roles.length === 0 && narrativeEntries(next).some(([, text]) => UNRESOLVED_ROLE_AS_CONTACT.test(text));
  const canonicalContradiction = roles.length > 0 && narrativeEntries(next).some(([, text]) => directCanonicalRoleContradiction(text, roles));
  const outboundMisattribution = attributesHumanOutboundToContact(next, envelope?.providerMetadata?.priorConversation || []);
  const invalidPropertyPlan = hasUnplannableEmptyPropertyLookup(next);
  const plannableCalls = plannableShadowToolCalls(next);
  const invalidToolPlan = plannableCalls.length < (next.proposedToolCalls || []).length;

  if (invalidToolPlan) {
    next.proposedToolCalls = plannableCalls;
    next.safetyFlags.push("invalid_tool_arguments_plan_blocked");
    if (invalidPropertyPlan) next.safetyFlags.push("invalid_property_reference_plan_blocked");
  }
  if (unresolvedRoleAttribution) {
    neutralizeDecisionRoles(next);
    next.safetyFlags.push("unresolved_identity_role_attribution_blocked");
  }
  if (canonicalContradiction) next.safetyFlags.push("canonical_identity_role_contradiction_blocked");
  if (outboundMisattribution) next.safetyFlags.push("outbound_human_attribution_blocked");

  if (unresolvedRoleAttribution || canonicalContradiction || outboundMisattribution) {
    next.requiresHuman = true;
    next.responseBlocked = true;
    next.groundingStatus = "blocked";
    next.groundingReason = canonicalContradiction ? "canonical_identity_role_contradiction"
      : outboundMisattribution ? "outbound_human_attribution" : "insufficient_identity_role_attribution";
    next.confidence = Math.min(Number(next.confidence || 0), 0.4);
    next.proposedResponse = "Respuesta bloqueada por seguridad; requiere revisión humana.";
    next.conversationalResponseParts = { acknowledgement: "Esto requiere revisión del equipo de Administración.", verifiedFactReferences: [], clarificationQuestion: null, escalationMessage: null };
  }
  next.safetyFlags = [...new Set(next.safetyFlags)];
  return next;
}
