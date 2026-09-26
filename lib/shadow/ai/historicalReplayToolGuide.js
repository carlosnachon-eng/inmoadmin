import { REAL_SHADOW_AI_TOOL_GUIDE } from "./realPrompt.js";

// Fixed transport instructions, selected only by the capability-checked reduced
// Replay gateway. No runtime/user text, reference map or business policy here.
export const REDUCED_REPLAY_REFERENCE_CONTRACT = `Contrato de referencias exclusivo de Historical Replay reducido:
- Conserva proposedToolCalls como lista de {tool, arguments, reason}; en este transporte arguments es siempre una lista de pares {key,value}. Las anotaciones uuid/string y los objetos de argumentos de la guía anterior describen el contrato interno, no el formato wire reducido.
- Son argumentos de referencia: respondContactId, propertyReference, propertyId, contractId, paymentId, serviceId, ticketId, contextKey, keyId, ownerPaymentId, recordId, unitId, clientIdentityId, workItemId y sourceId. Para ellos, copia exactamente el valor ref_... ya emitido por el servidor en metadata, resultados de tools o evidenceLedger del contexto de la ronda actual, sólo si corresponde al tipo requerido. Un alias de evidencia no sustituye al alias de la entidad referenciada.
- Nunca inventes UUIDs, IDs, referencias ni aliases. Nunca conviertas un ref_... a otro formato, lo recortes o reconstruyas; no reutilices aliases de otra ronda o de otro caso. El servidor resuelve internamente los valores copiados.
- Si no existe una referencia emitida válida para un argumento requerido, no solicites esa tool. Si falta un argumento opcional, omite su par {key,value}. Nunca envíes vacío, null, texto descriptivo ni un ID inventado para completar una referencia faltante. Una decisión sin herramientas usa proposedToolCalls: [].
- domain, status, sourceType, serviceType y period son argumentos literales: conserva su texto/enum permitido por el contrato de cada tool; no los conviertas en aliases. sourceId sigue siendo una referencia y debe corresponder al sourceType indicado. No agregues claves ni cambies requisitos de las tools.
- Usa los aliases sólo en campos estructurados de referencia permitidos; no los escribas en summary, reason, mensajes ni otros textos libres. No cambies las reglas de evidencia, grounding, revisión humana ni seguridad.`;

export const REDUCED_REPLAY_TOOL_GUIDE = `${REAL_SHADOW_AI_TOOL_GUIDE}\n\n${REDUCED_REPLAY_REFERENCE_CONTRACT}`;
