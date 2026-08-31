import assert from "node:assert/strict";
import test from "node:test";
import {
  actorAwarePriorConversation,
  applyActorRoleGuards,
  attributesHumanOutboundToContact,
  confirmedIdentityRoles,
  plannableShadowToolCalls,
} from "../lib/shadow/ai/actorRoleGuards.js";

const decision = (summary, extra = {}) => ({
  intent:"pago_renta", secondaryIntents:[], urgency:"normal", summary,
  entitiesMentioned:[], resolvedEntities:[], entityResolutionStatus:"unresolved", informationNeeded:[], proposedToolCalls:[],
  contextAssessment:summary, proposedAction:"Revisión administrativa.", factualClaims:[],
  conversationalResponseParts:{acknowledgement:"Entiendo.",verifiedFactReferences:[],clarificationQuestion:null,escalationMessage:null},
  executionCommitment:"none", confidence:.8, requiresHuman:false, escalationReason:null, safetyFlags:[], ...extra,
});
const identity = (roles) => [{name:"resolve_contact_identity",ok:true,result:[{entityType:"contact_identity",resolved:true,status:"confirmed",roles}]}];
const envelope = (priorConversation = []) => ({direction:"inbound",sanitizedText:"Buenos días",providerMetadata:{priorConversation}});

test("priorConversation fija actor exclusivamente desde direction",()=>{
  assert.deepEqual(actorAwarePriorConversation([
    {direction:"inbound",actor:"emporio_human",sanitizedText:"hola"},
    {direction:"outbound_human",actor:"contact",sanitizedText:"respuesta"},
  ]),[
    {direction:"inbound",actor:"contact",sanitizedText:"hola"},
    {direction:"outbound_human",actor:"emporio_human",sanitizedText:"respuesta"},
  ]);
});

test("rol owner confirmed es constraint duro contra reclasificación tenant",()=>{
  const result=applyActorRoleGuards(decision("La inquilina solicita entregar la renta."),envelope(),identity(["owner"]));
  assert.deepEqual(confirmedIdentityRoles(identity(["owner"])),["owner"]);
  assert.equal(result.responseBlocked,true);
  assert.ok(result.safetyFlags.includes("canonical_identity_role_contradiction_blocked"));
});

test("rol tenant confirmed es constraint duro contra reclasificación owner",()=>{
  const result=applyActorRoleGuards(decision("La persona figura como propietaria y solicita seguimiento."),envelope(),identity(["tenant"]));
  assert.equal(result.responseBlocked,true);
  assert.ok(result.safetyFlags.includes("canonical_identity_role_contradiction_blocked"));
});

const insufficientIdentityRegressions = [
  "Inquilina confirma que está pendiente.", "El inquilino solicita entregar la renta.",
  "Tenant pregunta por el pago.", "La propietaria confirma disponibilidad.",
  "Propietario solicita información.", "Owner indica que puede recibir mañana.",
  "La inquilina responde que sí.", "El propietario agradece la información.",
  "Inquilino necesita coordinar la entrega.", "Propietaria consulta por un depósito.",
  "Tenant señala que está pendiente.", "Owner quiere revisar el periodo.",
  "La inquilina informa que pagará.", "El propietario dice que puede recibir.",
];

test("14 regresiones sanitizadas: identidad insuficiente nunca asigna tenant/owner al contacto",()=>{
  assert.equal(insufficientIdentityRegressions.length,14);
  for(const summary of insufficientIdentityRegressions){
    const result=applyActorRoleGuards(decision(summary),envelope(),[]);
    assert.equal(result.responseBlocked,true,summary);
    assert.ok(result.safetyFlags.includes("unresolved_identity_role_attribution_blocked"),summary);
    assert.doesNotMatch(`${result.summary} ${result.contextAssessment}`,/inquilin|tenant|propietari|owner/i,summary);
  }
});

test("mención legítima de tercero no reclasifica al contacto owner",()=>{
  const result=applyActorRoleGuards(decision("La inquilina no ha pagado; el contacto solicita seguimiento."),envelope(),identity(["owner"]));
  assert.equal(result.safetyFlags.includes("canonical_identity_role_contradiction_blocked"),false);
});

test("atribución al contacto de afirmación outbound_human falla cerrado",()=>{
  const prior=[{direction:"outbound_human",actor:"emporio_human",sanitizedText:"Aún no nos ha pagado la inquilina, hoy es el último día"}];
  const value=decision("El contacto indicó que la inquilina no ha pagado y hoy es el último día.");
  assert.equal(attributesHumanOutboundToContact(value,prior),true);
  const result=applyActorRoleGuards(value,envelope(prior),identity(["owner"]));
  assert.equal(result.responseBlocked,true);
  assert.ok(result.safetyFlags.includes("outbound_human_attribution_blocked"));
});

test("find_properties vacío se elimina en planificación antes de tools",()=>{
  const calls=plannableShadowToolCalls(decision("Contacto solicita apoyo.",{proposedToolCalls:[
    {tool:"find_properties",arguments:{propertyReference:""},reason:"buscar"},
    {tool:"resolve_contact_identity",arguments:{respondContactId:"opaque"},reason:"resolver"},
  ]}));
  assert.deepEqual(calls.map((call)=>call.tool),["resolve_contact_identity"]);
});
