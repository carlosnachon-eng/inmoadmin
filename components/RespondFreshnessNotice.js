import { RESPOND_FROZEN_NOTICE } from "../lib/respondDegradedMode.js";

export default function RespondFreshnessNotice({ lastUpdatedAt }) {
  const date = lastUpdatedAt && Number.isFinite(Date.parse(lastUpdatedAt))
    ? new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" }).format(new Date(lastUpdatedAt))
    : "No disponible";
  return <aside role="status" style={{ padding: 14, margin: "12px 0", border: "1px solid #fcd34d", borderRadius: 10, background: "#fffbeb", color: "#78350f" }}>
    <strong>{RESPOND_FROZEN_NOTICE}</strong>
    <div>Última actualización disponible: {date} (México).</div>
    <div>Responsable, etapa, conversaciones abiertas y sin respuesta son históricos, no estado actual. Consulta la Inbox de Respond para operar. Automatización comercial de Inmoadmin pausada; backlog conservado.</div>
  </aside>;
}
