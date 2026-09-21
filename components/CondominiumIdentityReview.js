import { useRef, useState } from "react";
import { requestCondominiumIdentityReview } from "../lib/shadow/condominiumIdentityClient";

export default function CondominiumIdentityReview({ supabase, profile }) {
  const [data, setData] = useState(null); const [unitId, setUnitId] = useState(""); const [contactId, setContactId] = useState("");
  const [reviewed, setReviewed] = useState({}); const [busy, setBusy] = useState(false); const pending = useRef(false);
  const [attachConfirmedIdentity, setAttachConfirmedIdentity] = useState(false);
  const [result, setResult] = useState(null); const [error, setError] = useState("");
  if (profile?.active !== true || profile.role_id !== "admin") return null;
  const operate = async (action, candidate = null) => {
    if (pending.current) return;
    if (action === "confirm" && !reviewed[candidate?.candidateId]) return;
    if (["confirm", "revoke"].includes(action) && !window.confirm(`${action === "confirm" ? "Aprobar" : "Revocar"} propietario: unidad ${candidate.unitRef}, condominio ${candidate.condominiumRef}, contacto ${candidate.contactRef}. No concede acceso al portal ni autoriza envíos o pagos. ¿Continuar?`)) return;
    pending.current = true; setBusy(true); setError(""); setResult(null);
    try {
      const body = { action: `condominium_${action}`, ...(action === "prepare" ? { unitId, respondContactId: contactId.trim(),
        ...(attachConfirmedIdentity ? { attachConfirmedIdentity: true, ownershipReviewed: true } : {}) } : {}),
        ...(candidate ? { candidateId: candidate.candidateId, ...(action === "confirm" ? { ownershipReviewed: true } : {}) } : {}) };
      const response = await requestCondominiumIdentityReview({ supabase, profile, body });
      if (action === "list") setData(response);
      else { setResult(response.result); setData(null); setReviewed({}); }
    } catch (e) { setError(e.message || "condominium_review_failed"); }
    finally { pending.current = false; setBusy(false); }
  };
  return <details style={{ padding: 16, border: "1px solid #ddd", marginBottom: 14 }}>
    <summary><strong>Identidad canónica — propietarios de Condominios</strong></summary>
    <p>La coincidencia telefónica sólo prepara un candidato. Requiere revisión administrativa explícita; no crea contratos ni acceso al portal. Teléfonos compartidos sin vínculo estructural se bloquean.</p>
    <button disabled={busy} onClick={() => operate("list")}>Consultar unidades y candidatos</button>
    {error && <p role="alert">{error}</p>}
    {result && <p role="status">Resultado: {result.status} · {result.reason || "sin bloqueo"} · unidad {result.unitRef} · candidato {result.candidateRef || "no creado"}. Sin reintento automático.</p>}
    {data && !data.capabilities.review && <p>Confirmación y revocación OFF. Sólo lectura{data.capabilities.prepare ? " y preparación explícita" : ""}.</p>}
    {data?.capabilities.prepare && <fieldset disabled={busy}>
      <legend>Preparar un candidato (sin confirmar)</legend>
      <label>Unidad <select value={unitId} onChange={(e) => setUnitId(e.target.value)}><option value="">Seleccionar</option>{data.units.map((u) => <option key={u.unitId} value={u.unitId} disabled={!u.active}>Unidad {u.unitRef} · condominio {u.condominiumRef}{u.active ? "" : " (inactiva)"}</option>)}</select></label>
      <label>ID estructurado del contacto Respond <input value={contactId} onChange={(e) => setContactId(e.target.value)} autoComplete="off" /></label>
      <label><input type="checkbox" checked={attachConfirmedIdentity} onChange={(e) => setAttachConfirmedIdentity(e.target.checked)} />Revisé que esta unidad pertenece a la misma persona ya aprobada para este contacto Respond. Preparar una unidad adicional, sin unir identidades por teléfono.</label>
      <button disabled={!unitId || !contactId.trim()} onClick={() => operate("prepare")}>Preparar candidato</button>
    </fieldset>}
    {(data?.candidates || []).map((c) => <article key={c.candidateId} style={{ borderTop: "1px solid #ddd", padding: 10 }}>
      <strong>Candidato {c.candidateRef} · {c.status}</strong>
      <p>Contacto {c.contactRef} → unidad {c.unitRef} → condominio {c.condominiumRef}</p>
      <p>Rol: propietario condominal · fuente: {c.source} · motivo: {c.reason} · evidencia: {c.checkedAt || "sin dato"}</p>
      {data.capabilities.review && c.status === "requires_review" && <>
        <label><input type="checkbox" checked={reviewed[c.candidateId] === true} onChange={(e) => setReviewed((v) => ({ ...v, [c.candidateId]: e.target.checked }))} />Revisé la procedencia y la relación de propietario. No estoy uniendo personas sólo por teléfono.</label>
        <button disabled={busy || !reviewed[c.candidateId]} onClick={() => operate("confirm", c)}>Aprobar relación e identidad</button>
        <button disabled={busy} onClick={() => operate("reject", c)}>Rechazar candidato</button>
      </>}
      {data.capabilities.review && c.status === "confirmed" && <button disabled={busy} onClick={() => operate("revoke", c)}>Revocar relación de forma auditada</button>}
    </article>)}
  </details>;
}
