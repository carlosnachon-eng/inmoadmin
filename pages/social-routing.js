import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function SocialRoutingReview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true); setError("");
    try {
      const { data: auth } = await supabase.auth.getSession();
      if (!auth.session) throw new Error("Inicia sesión como administrador.");
      const response = await fetch("/api/operaciones/social-routing", { headers: { Authorization: `Bearer ${auth.session.access_token}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo consultar.");
      setData(result);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <main style={{ padding: 24 }}>
    <h1>Social Routing — revisión</h1>
    <p>Sólo lectura. No envía mensajes, reasigna contactos ni habilita Administración.</p>
    <button onClick={load} disabled={busy}>{busy ? "Consultando…" : "Consultar decisiones"}</button>
    {error && <p role="alert">{error}</p>}
    {data && <><p>Routing: {data.enabled ? "ON" : "OFF"}. Últimas 100 decisiones; “encolado” no acredita ejecución.</p>
      <table><thead><tr><th>Referencia</th><th>Origen</th><th>Destino</th><th>Motivo</th><th>Identidad</th><th>Estado</th></tr></thead>
        <tbody>{data.routes.map((r) => <tr key={r.routeRef}><td>{r.routeRef}</td><td>{r.source.platform} / {r.source.channelId}</td><td>{r.destination}</td><td>{r.reason}</td><td>{r.identityStatus}</td><td>{r.status}</td></tr>)}</tbody>
      </table></>}
  </main>;
}
