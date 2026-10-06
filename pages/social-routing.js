import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function SocialRoutingReview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load(page = 0) {
    setBusy(true); setError("");
    try {
      const { data: auth } = await supabase.auth.getSession();
      if (!auth.session) throw new Error("Inicia sesión como administrador.");
      const response = await fetch(`/api/operaciones/social-routing?capturePage=${page}`, { headers: { Authorization: `Bearer ${auth.session.access_token}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo consultar.");
      setData(result);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <main style={{ padding: 24 }}>
    <h1>Social Routing — revisión</h1>
    <p>Sólo lectura. No envía mensajes, reasigna contactos ni habilita Administración.</p>
    <button onClick={() => load()} disabled={busy}>{busy ? "Consultando…" : "Consultar decisiones"}</button>
    {error && <p role="alert">{error}</p>}
    {data && <><p>Routing: {data.enabled ? "ON" : "OFF"}. Últimas 100 decisiones; “encolado” no acredita ejecución.</p>
      <h2>Captura comercial pendiente / revisión</h2>
      <p>Cola de administradores activos. Snapshot “processed” no significa routing completado. No reenvía ni reasigna.</p>
      <table><thead><tr><th>Evento</th><th>Transporte / snapshot</th><th>Routing</th><th>Diagnóstico</th><th>Intentos</th><th>Revisión</th></tr></thead>
        <tbody>{(data.captureReviews || []).map(r => <tr key={r.eventRef}>
          <td>{r.eventRef}</td><td>Recibido / {r.snapshotState}</td><td>{r.routingState}</td>
          <td>{r.reason || "Captura aún no completada"} / {r.sqlstate || "—"} / {r.stage || "—"}</td><td>{r.attempts}</td>
          <td>{r.operationalOwner} {r.inboxUrl && <a href={r.inboxUrl} target="_blank" rel="noreferrer">Abrir Inbox</a>}</td>
        </tr>)}</tbody>
      </table>
      <button onClick={() => load(data.capturePage - 1)} disabled={busy || !data.capturePage}>Anterior</button>
      <span> Página {(data.capturePage || 0) + 1} </span>
      <button onClick={() => load(data.capturePage + 1)} disabled={busy || !(data.captureHasMore || data.executionHasMore)}>Siguiente</button>
      <h2>Ejecución comercial — recuperación / revisión</h2>
      <p>Máximo dos intentos. Una revisión no acredita atención humana ni cancelación de un envío incierto.</p>
      <table><thead><tr><th>Evento</th><th>Área</th><th>Estado / fase</th><th>Intentos</th><th>Motivo</th><th>Revisión manual</th></tr></thead>
        <tbody>{(data.executionReviews || []).map(r => <tr key={r.eventRef}>
          <td>{r.eventRef}</td><td>{r.lane}</td><td>{r.state} / {r.phase}</td><td>{r.attempts}</td><td>{r.reason || "—"}</td>
          <td>{r.inboxUrl && <a href={r.inboxUrl} target="_blank" rel="noreferrer">Abrir Inbox</a>}</td>
        </tr>)}</tbody>
      </table>
      <table><thead><tr><th>Referencia</th><th>Origen</th><th>Destino</th><th>Motivo</th><th>Identidad</th><th>Estado</th></tr></thead>
        <tbody>{data.routes.map((r) => <tr key={r.routeRef}><td>{r.routeRef}</td><td>{r.source.platform} / {r.source.channelId}</td><td>{r.destination}</td><td>{r.reason}</td><td>{r.identityStatus}</td><td>{r.status} {r.inboxUrl && <a href={r.inboxUrl} target="_blank" rel="noreferrer">Abrir Inbox</a>}</td></tr>)}</tbody>
      </table></>}
  </main>;
}
