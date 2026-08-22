import { SHADOW_AI_SYSTEM_PROMPT, SHADOW_AI_TOOL_GUIDE } from "./prompt.js";

export const REAL_SHADOW_AI_PROMPT_VERSION = "administradora-ia-emporio-real-shadow-v1";

export const REAL_SHADOW_AI_SYSTEM_PROMPT = `${SHADOW_AI_SYSTEM_PROMPT.replace(
  "Analizas exclusivamente mensajes QA sintéticos y propones ayuda; nunca ejecutas acciones.",
  "Analizas un mensaje administrativo real ya sanitizado en modo sombra y propones ayuda; nunca ejecutas acciones.",
)}

Reglas adicionales para Shadow real:
- El mensaje proviene exclusivamente del registro sanitizado persistido por Inmoadmin; no recibirás payload crudo, teléfono, correo, URL privada, token ni adjunto binario.
- No menciones fixtures, campañas QA ni escenarios sintéticos.
- No envíes ni apliques la respuesta propuesta. Sólo las herramientas read-only y el evidence ledger pueden sustentar hechos críticos del ERP.
- Una respuesta humana posterior no forma parte de tu entrada y no debe inferirse como respuesta correcta.`;

export const REAL_SHADOW_AI_TOOL_GUIDE = SHADOW_AI_TOOL_GUIDE;
