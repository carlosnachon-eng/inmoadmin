import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const fmt = (value) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0,
}).format(Number(value || 0));
const periodLabel = (period) => {
  if (!period) return "—";
  const [year, month] = period.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
};

function StatusBadge({ status }) {
  const styles = {
    pagado: ["#d1fae5", "#065f46", "Pagado"], pendiente: ["#fef3c7", "#92400e", "Pendiente"],
    atrasado: ["#fee2e2", "#991b1b", "Atrasado"], REPORTADO: ["#fef3c7", "#92400e", "Reportado"],
    EN_REVISION: ["#dbeafe", "#1e40af", "En revisión"], VALIDADO: ["#d1fae5", "#065f46", "Validado"],
    CONTROVERTIDO: ["#fee2e2", "#991b1b", "En aclaración"],
  };
  const [background, color, label] = styles[status] || ["#f3f4f6", "#374151", status || "—"];
  return <span style={{ background, color, padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>{label}</span>;
}

function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const send = async () => {
    setLoading(true); setError("");
    const result = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        data: { rol_pretendido: "condomino" },
        emailRedirectTo: "https://app.emporioinmobiliario.com.mx/condomino",
      },
    });
    setLoading(false);
    if (result.error) { setError("No encontramos una cuenta habilitada con ese correo."); return; }
    setSent(true);
  };
  return <main style={styles.center}>
    <section style={styles.loginCard}>
      <h1 style={styles.title}>Portal Condómino</h1>
      <p style={styles.muted}>Emporio Inmobiliario</p>
      {error && <p style={styles.error}>{error}</p>}
      {!sent ? <>
        <label style={styles.label}>Correo autorizado</label>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} onKeyDown={(event) => event.key === "Enter" && send()} style={styles.input} />
        <button onClick={send} disabled={loading || !email} style={styles.primaryButton}>{loading ? "Enviando…" : "Enviar enlace de acceso"}</button>
      </> : <>
        <h2 style={{ ...styles.title, fontSize: 18 }}>Revisa tu correo</h2>
        <p style={styles.muted}>El enlace sólo funcionará para una cuenta previamente habilitada.</p>
        <button onClick={() => { setSent(false); setEmail(""); }} style={styles.secondaryButton}>Usar otro correo</button>
      </>}
    </section>
  </main>;
}

export default function CondominoPortal() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [units, setUnits] = useState([]);
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [tab, setTab] = useState("current");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const loadUnits = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("condominium_owner_portal_units");
    if (error) { setUnits([]); setSelectedUnitId(""); setSnapshot(null); setLoading(false); return; }
    const available = data || [];
    setUnits(available);
    setSelectedUnitId((current) => available.some((unit) => unit.unidad_id === current) ? current : available[0]?.unidad_id || "");
    setLoading(false);
  };

  const loadSnapshot = async (unitId) => {
    if (!unitId) { setSnapshot(null); return; }
    setLoading(true);
    const { data, error } = await supabase.rpc("condominium_owner_portal_snapshot", { p_unidad_id: unitId });
    setSnapshot(error ? null : data);
    setLoading(false);
  };

  useEffect(() => { if (session) loadUnits(); else { setUnits([]); setSnapshot(null); } }, [session]);
  useEffect(() => { if (session && selectedUnitId) loadSnapshot(selectedUnitId); }, [session, selectedUnitId]);

  const currentFees = snapshot?.currentFees || [];
  const historical = snapshot?.historical || [];
  const historicalPayments = snapshot?.historicalPayments || [];
  const currentSummary = useMemo(() => ({
    issued: currentFees.reduce((sum, fee) => sum + Number(fee.amount || 0), 0),
    paid: currentFees.filter((fee) => fee.status === "pagado").reduce((sum, fee) => sum + Number(fee.amount || 0), 0),
  }), [currentFees]);

  if (authLoading) return <main style={styles.center}><p style={styles.muted}>Cargando…</p></main>;
  if (!session) return <Login />;
  if (loading && !snapshot) return <main style={styles.center}><p style={styles.muted}>Cargando portal…</p></main>;
  if (!units.length) return <main style={styles.center}><section style={styles.loginCard}><h1 style={styles.title}>Portal no disponible</h1><p style={styles.muted}>No hay unidades habilitadas para esta cuenta.</p><button onClick={() => supabase.auth.signOut()} style={styles.secondaryButton}>Cerrar sesión</button></section></main>;

  const tabs = [["current", "Administración Emporio"], ["historical", "Histórico Antive"]];

  return <main style={styles.page}>
    <header style={styles.header}>
      <div><p style={styles.eyebrow}>{snapshot?.unit?.condominiumName}</p><h1 style={styles.title}>Unidad {snapshot?.unit?.number}</h1></div>
      <button onClick={() => supabase.auth.signOut()} style={styles.secondaryButton}>Cerrar sesión</button>
    </header>

    {units.length > 1 && <section style={styles.card}>
      <label style={styles.label}>Unidad autorizada</label>
      <select value={selectedUnitId} onChange={(event) => setSelectedUnitId(event.target.value)} style={styles.input}>
        {units.map((unit) => <option key={unit.unidad_id} value={unit.unidad_id}>{unit.condominium_name} · {unit.unit_number}</option>)}
      </select>
    </section>}

    <nav style={styles.tabs}>{tabs.map(([id, label]) => <button key={id} onClick={() => setTab(id)} style={tab === id ? styles.activeTab : styles.tab}>{label}</button>)}</nav>

    {tab === "current" && <section>
      <div style={styles.split}>
        <article style={styles.card}><p style={styles.eyebrow}>Emitido por Emporio</p><strong style={styles.amount}>{fmt(currentSummary.issued)}</strong></article>
        <article style={styles.card}><p style={styles.eyebrow}>Pagos conciliados</p><strong style={styles.amount}>{fmt(currentSummary.paid)}</strong></article>
      </div>
      <h2 style={styles.sectionTitle}>Cuotas corrientes</h2>
      {currentFees.map((fee) => <article key={fee.id} style={styles.card}>
        <div style={styles.row}><div><strong>{periodLabel(fee.period)}</strong><p style={styles.muted}>Vence: {fee.dueDate || "—"}</p></div><div style={{ textAlign: "right" }}><strong>{fmt(fee.amount)}</strong><br/><StatusBadge status={fee.status} /></div></div>
      </article>)}
    </section>}

    {tab === "historical" && <section>
      <h2 style={styles.sectionTitle}>Saldo administrativo histórico — Antive</h2>
      <p style={styles.callout}>Este saldo proviene de registros anteriores administrados por Antive. No forma parte de la cobranza corriente generada por Emporio y puede solicitarse aclaración individual.</p>
      {historical.map((item) => <article key={item.id} style={styles.card}>
        <div style={styles.row}><div><p style={styles.eyebrow}>Corte {item.cutoffDate}</p><strong>{item.sourceLabel}</strong></div><StatusBadge status={item.reviewStatus}/></div>
        <div style={styles.split}><p>Cargos<br/><strong>{fmt(item.reportedCharges)}</strong></p><p>Pagos registrados<br/><strong>{fmt(item.reportedPayments)}</strong></p><p>Saldo administrativo<br/><strong>{fmt(item.reportedBalance)}</strong></p></div>
      </article>)}
      <h3 style={styles.sectionTitle}>Pagos históricos registrados</h3>
      {historicalPayments.length ? historicalPayments.map((payment) => <article key={payment.id} style={styles.card}><div style={styles.row}><div><strong>{payment.period ? periodLabel(payment.period) : "Periodo reportado"}</strong><p style={styles.muted}>Recibido por {payment.receivedBy}</p></div><strong>{fmt(payment.amount)}</strong></div></article>) : <p style={styles.muted}>Sin pagos históricos registrados.</p>}
    </section>}

  </main>;
}

const styles = {
  page: { minHeight: "100vh", background: "#f7f7f8", fontFamily: "system-ui,sans-serif", padding: "28px 20px 60px", color: "#1a1a2e" },
  center: { minHeight: "100vh", display: "grid", placeItems: "center", background: "#f7f7f8", fontFamily: "system-ui,sans-serif", padding: 20 },
  loginCard: { width: "100%", maxWidth: 390, background: "#fff", borderRadius: 18, padding: 30, boxShadow: "0 8px 30px rgba(0,0,0,.08)" },
  header: { maxWidth: 760, margin: "0 auto 20px", display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" },
  title: { margin: 0, fontSize: 24, fontWeight: 800 }, eyebrow: { margin: "0 0 4px", color: "#6b7280", fontSize: 11, fontWeight: 700, textTransform: "uppercase" },
  muted: { margin: "4px 0", color: "#6b7280", fontSize: 13 }, label: { display: "block", marginBottom: 7, fontSize: 12, fontWeight: 700 },
  input: { width: "100%", boxSizing: "border-box", padding: "11px 12px", border: "1px solid #d1d5db", borderRadius: 9, marginBottom: 12 },
  primaryButton: { border: 0, borderRadius: 8, background: "#b91c3c", color: "#fff", padding: "9px 14px", fontWeight: 700, cursor: "pointer" },
  secondaryButton: { border: 0, borderRadius: 8, background: "#e5e7eb", color: "#374151", padding: "9px 14px", fontWeight: 700, cursor: "pointer" },
  error: { background: "#fee2e2", color: "#991b1b", padding: 10, borderRadius: 8 },
  tabs: { maxWidth: 760, margin: "0 auto 18px", display: "flex", gap: 6, overflowX: "auto" }, tab: { border: 0, borderRadius: 8, padding: "9px 12px", background: "#e5e7eb", whiteSpace: "nowrap", cursor: "pointer" }, activeTab: { border: 0, borderRadius: 8, padding: "9px 12px", background: "#1a1a2e", color: "#fff", whiteSpace: "nowrap", cursor: "pointer" },
  card: { maxWidth: 728, margin: "0 auto 10px", background: "#fff", borderRadius: 12, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14 }, split: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, maxWidth: 760, margin: "0 auto 14px" },
  amount: { fontSize: 22 }, sectionTitle: { maxWidth: 760, margin: "22px auto 12px", fontSize: 16 }, callout: { maxWidth: 728, margin: "0 auto 14px", background: "#fff7ed", color: "#9a3412", padding: 16, borderRadius: 10, fontSize: 13, lineHeight: 1.5 },
};
