import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const fmt = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0 }).format(n || 0);

const periodoActual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const periodoLabel = (p) => {
  if (!p) return "—";
  const [y, m] = p.split("-");
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
};

const CATEGORIAS = {
  agua: "💧 Agua", luz: "⚡ Luz", limpieza: "🧹 Limpieza",
  mantenimiento: "🔧 Mantenimiento", vigilancia: "👮 Vigilancia",
  jardineria: "🌿 Jardinería", otro: "📦 Otro",
};

const StatusBadge = ({ status }) => {
  const map = {
    pagado:   { bg: "#d1fae5", color: "#065f46", label: "✅ Pagado" },
    pendiente:{ bg: "#fef3c7", color: "#92400e", label: "⏳ Pendiente" },
    atrasado: { bg: "#fee2e2", color: "#991b1b", label: "🔴 Atrasado" },
    abierto:  { bg: "#fef3c7", color: "#92400e", label: "Abierto" },
    en_proceso:{ bg: "#dbeafe", color: "#1e40af", label: "En proceso" },
    resuelto: { bg: "#d1fae5", color: "#065f46", label: "Resuelto" },
  };
  const s = map[status] || { bg: "#f3f4f6", color: "#374151", label: status };
  return <span style={{ background: s.bg, color: s.color, padding: "3px 12px", borderRadius: 99, fontSize: 12, fontWeight: 700 }}>{s.label}</span>;
};

const CondominoLogin = () => {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const send = async () => {
    setLoading(true); setError("");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: "https://app.emporioinmobiliario.com.mx/condomino" } });
    setLoading(false);
    if (error) { setError("No encontramos tu email. Contacta a Emporio Inmobiliario."); return; }
    setSent(true);
  };
  return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 20 }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 52, objectFit: "contain", marginBottom: 24 }} />
      <div style={{ background: "#fff", borderRadius: 20, padding: 36, width: "100%", maxWidth: 400, boxShadow: "0 2px 12px rgba(0,0,0,0.08)", border: "1px solid #e5e7eb" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 800, color: "#1a1a2e", textAlign: "center" }}>Portal Condómino</h1>
        <p style={{ margin: "0 0 24px", fontSize: 13, color: "#9ca3af", textAlign: "center" }}>Emporio Inmobiliario</p>
        {error && <div style={{ background: "#fff0f3", color: "#b91c3c", padding: "12px 16px", borderRadius: 10, marginBottom: 16, fontSize: 13, fontWeight: 600 }}>{error}</div>}
        {!sent ? (
          <>
            <p style={{ fontSize: 14, color: "#6b7280", margin: "0 0 20px", textAlign: "center" }}>Ingresa el email registrado con tu condominio</p>
            <input type="email" placeholder="tu@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", marginBottom: 14 }} />
            <button onClick={send} disabled={loading || !email} style={{ width: "100%", background: "#b91c3c", color: "#fff", border: "none", borderRadius: 10, padding: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontSize: 15, opacity: loading ? 0.6 : 1 }}>
              {loading ? "Enviando…" : "Enviar enlace de acceso →"}
            </button>
          </>
        ) : (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📧</div>
            <h3 style={{ margin: "0 0 8px", color: "#1a1a2e" }}>¡Revisa tu email!</h3>
            <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 6px" }}>Enviamos un enlace a:</p>
            <p style={{ color: "#1a1a2e", fontWeight: 700, fontSize: 15, margin: "0 0 16px" }}>{email}</p>
            <p style={{ color: "#9ca3af", fontSize: 12 }}>Revisa también tu carpeta de spam</p>
            <button onClick={() => { setSent(false); setEmail(""); }} style={{ background: "transparent", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 13, textDecoration: "underline", marginTop: 12 }}>Usar otro email</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default function CondominoPortal() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tab, setTab] = useState("inicio");
  const [unidad, setUnidad] = useState(null);
  const [condominio, setCondominio] = useState(null);
  const [cuotas, setCuotas] = useState([]);
  const [gastos, setGastos] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [uploadingComp, setUploadingComp] = useState(false);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setAuthLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) loadData(); }, [session]);

  const loadData = async () => {
    setLoading(true);
    const email = session.user.email;

    // Buscar por email de propietario o residente
    const { data: unidades } = await supabase
      .from("unidades_condominio")
      .select("*, condominios(*)")
      .or(`propietario_email.eq.${email},residente_email.eq.${email}`)
      .eq("activo", true)
      .limit(1);

    if (!unidades || unidades.length === 0) { setLoading(false); return; }

    const u = unidades[0];
    setUnidad(u);
    setCondominio(u.condominios);

    const [
      { data: cuotasData },
      { data: gastosData },
      { data: ticketsData },
    ] = await Promise.all([
      supabase.from("cuotas_condominio").select("id, periodo, monto, status, fecha_vencimiento, fecha_pago, comprobante_url, recibo_url, unidad_id").eq("unidad_id", u.id).order("periodo", { ascending: false }),
      supabase.from("gastos_condominio").select("*").eq("condominio_id", u.condominio_id).order("fecha", { ascending: false }).limit(20),
      supabase.from("maintenance_tickets").select("*").eq("condominio_id", u.condominio_id).order("created_at", { ascending: false }),
    ]);

    setCuotas(cuotasData || []);
    setGastos(gastosData || []);
    setTickets(ticketsData || []);
    setLoading(false);
  };

  const subirComprobante = async (cuota, file) => {
    setUploadingComp(true);
    try {
      const ext = file.name.split(".").pop();
      const fileName = `cuotas-condominio/${cuota.id}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("documentos").upload(fileName, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("documentos").getPublicUrl(fileName);
      await supabase.from("cuotas_condominio").update({
        comprobante_url: urlData.publicUrl,
        status: "pendiente", // queda pendiente hasta que Emporio confirme
      }).eq("id", cuota.id);
      showToast("Comprobante enviado, Emporio lo revisará pronto");
      loadData();
    } catch (e) { showToast("Error al subir: " + e.message, false); }
    setUploadingComp(false);
  };

  const logout = async () => { await supabase.auth.signOut(); setSession(null); };

  if (authLoading) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}><img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, opacity: 0.4 }} /></div>;
  if (!session) return <CondominoLogin />;
  if (loading) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}><p style={{ color: "#9ca3af" }}>Cargando…</p></div>;

  if (!unidad) return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", padding: 40 }}>
        <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, marginBottom: 20 }} />
        <h2 style={{ color: "#1a1a2e", margin: "0 0 8px" }}>No encontramos tu unidad</h2>
        <p style={{ color: "#9ca3af", margin: "0 0 20px" }}>Usa el email registrado con tu condominio</p>
        <button onClick={logout} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontWeight: 600 }}>Cerrar sesión</button>
      </div>
    </div>
  );

  const cuotaMesActual = cuotas.find(q => q.periodo === periodoActual());
  const cuotasPagadas = cuotas.filter(q => q.status === "pagado").length;
  const totalPagado = cuotas.filter(q => q.status === "pagado").reduce((a, q) => a + (q.monto || 0), 0);
  const adeudos = cuotas.filter(q => q.status !== "pagado").length;

  const TABS = [
    { id: "inicio",   label: "📊 Mi unidad" },
    { id: "cuotas",   label: "💰 Mis cuotas" },
    { id: "recibos",  label: "🧾 Mis recibos" },
    { id: "gastos",   label: "📤 Gastos comunes" },
    { id: "tickets",  label: "🔧 Mantenimiento" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", fontFamily: "system-ui, sans-serif" }}>
      {toast && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, background: toast.ok ? "#065f46" : "#b91c3c", color: "#fff", padding: "14px 20px", fontWeight: 700, fontSize: 14, zIndex: 2000, textAlign: "center" }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "12px 20px" }}>
        <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 34, objectFit: "contain" }} />
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: 0, fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Portal Condómino</p>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1a1a2e" }}>{unidad.propietario_nombre}</p>
          </div>
        </div>
      </div>

      {/* Hero */}
      <div style={{ background: "#1a1a2e", padding: "20px 20px 0" }}>
        <div style={{ maxWidth: 680, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{condominio?.nombre || "Mi condominio"}</p>
              <h1 style={{ margin: "4px 0 2px", fontSize: 26, fontWeight: 800, color: "#fff" }}>Unidad {unidad.numero}</h1>
              {!unidad.residente_es_propietario && unidad.residente_nombre && (
                <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Residente: {unidad.residente_nombre}</p>
              )}
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Cuota mensual</p>
              <p style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 800, color: "#fff" }}>{fmt(condominio?.cuota_mensual || 0)}</p>
              {cuotaMesActual && (
                <div style={{ marginTop: 6 }}>
                  <StatusBadge status={cuotaMesActual.status} />
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "8px 14px", borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", background: tab === t.id ? "#fff" : "rgba(255,255,255,0.1)", color: tab === t.id ? "#1a1a2e" : "rgba(255,255,255,0.7)" }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 20px" }}>

        {/* TAB: MI UNIDAD */}
        {tab === "inicio" && (
          <div>
            {/* Estatus del mes */}
            {cuotaMesActual && cuotaMesActual.status !== "pagado" && (
              <div style={{ background: cuotaMesActual.status === "atrasado" ? "#fee2e2" : "#fffbeb", border: `1px solid ${cuotaMesActual.status === "atrasado" ? "#fca5a5" : "#fcd34d"}`, borderRadius: 12, padding: "14px 18px", marginBottom: 16 }}>
                <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 15, color: cuotaMesActual.status === "atrasado" ? "#991b1b" : "#92400e" }}>
                  {cuotaMesActual.status === "atrasado" ? "🔴 Cuota atrasada" : "⏳ Cuota pendiente"} — {periodoLabel(periodoActual())}
                </p>
                <p style={{ margin: "0 0 10px", fontSize: 14, color: cuotaMesActual.status === "atrasado" ? "#991b1b" : "#92400e" }}>
                  {fmt(cuotaMesActual.monto)} · Vence: {cuotaMesActual.fecha_vencimiento || "día 10"}
                </p>
                {!cuotaMesActual.comprobante_url && (
                  <div>
                    <input type="file" accept="image/*,application/pdf" id="comp-mes" style={{ display: "none" }} onChange={e => e.target.files[0] && subirComprobante(cuotaMesActual, e.target.files[0])} disabled={uploadingComp} />
                    <label htmlFor="comp-mes" style={{ display: "inline-block", background: "#1a1a2e", color: "#fff", borderRadius: 8, padding: "8px 16px", cursor: uploadingComp ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700 }}>
                      {uploadingComp ? "Subiendo…" : "📎 Subir comprobante"}
                    </label>
                  </div>
                )}
                {cuotaMesActual.comprobante_url && (
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: "#065f46", fontWeight: 600 }}>✓ Comprobante enviado — pendiente confirmación de Emporio</p>
                )}
              </div>
            )}

            {cuotaMesActual?.status === "pagado" && (
              <div style={{ background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: 12, padding: "14px 18px", marginBottom: 16 }}>
                <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: "#065f46" }}>✅ Cuota de {periodoLabel(periodoActual())} pagada</p>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#065f46" }}>Gracias por tu pago puntual</p>
              </div>
            )}

            {/* KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              {[
                { label: "Cuotas pagadas", value: cuotasPagadas, color: "#065f46" },
                { label: "Adeudos",        value: adeudos,       color: adeudos > 0 ? "#b91c3c" : "#065f46" },
                { label: "Total pagado",   value: fmt(totalPagado), color: "#1e40af" },
                { label: "Cuota mensual",  value: fmt(condominio?.cuota_mensual || 0), color: "#1a1a2e" },
              ].map((s, i) => (
                <div key={i} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                  <p style={{ margin: 0, fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Info del condominio */}
            <div style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
              <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: 14, color: "#1a1a2e" }}>Información del condominio</p>
              <p style={{ margin: "0 0 4px", fontSize: 13, color: "#6b7280" }}>🏢 {condominio?.nombre}</p>
              {condominio?.direccion && <p style={{ margin: "0 0 4px", fontSize: 13, color: "#6b7280" }}>📍 {condominio.direccion}</p>}
              <p style={{ margin: "0 0 4px", fontSize: 13, color: "#6b7280" }}>🏠 {condominio?.total_unidades} unidades</p>
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>📞 222 257 3237</p>
            </div>

            <button onClick={logout} style={{ width: "100%", background: "#f3f4f6", border: "none", borderRadius: 10, padding: 12, cursor: "pointer", fontSize: 14, color: "#9ca3af", fontWeight: 600, marginTop: 12 }}>Cerrar sesión</button>
          </div>
        )}

        {/* TAB: MIS CUOTAS */}
        {tab === "cuotas" && (
          <div>
            <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>Historial de cuotas</h3>
            {cuotas.length === 0 && <div style={{ background: "#fff", borderRadius: 12, padding: 32, textAlign: "center" }}><p style={{ color: "#9ca3af" }}>Sin cuotas registradas aún</p></div>}
            {cuotas.map(q => (
              <div key={q.id} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", marginBottom: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", borderLeft: `4px solid ${q.status === "pagado" ? "#065f46" : q.status === "atrasado" ? "#b91c3c" : "#fcd34d"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a1a2e" }}>{periodoLabel(q.periodo)}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>Vence: {q.fecha_vencimiento || "—"}</p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 16, color: "#1a1a2e" }}>{fmt(q.monto)}</p>
                    <StatusBadge status={q.status} />
                  </div>
                </div>
                {q.status === "pagado" && q.fecha_pago && (
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: "#065f46" }}>✓ Pagado el {q.fecha_pago}</p>
                )}
                {q.comprobante_url && (
                  <a href={q.comprobante_url} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 6, fontSize: 12, color: "#1e40af", fontWeight: 600 }}>📄 Ver comprobante</a>
                )}
                {q.status !== "pagado" && !q.comprobante_url && (
                  <div style={{ marginTop: 8 }}>
                    <input type="file" accept="image/*,application/pdf" id={`comp-${q.id}`} style={{ display: "none" }} onChange={e => e.target.files[0] && subirComprobante(q, e.target.files[0])} disabled={uploadingComp} />
                    <label htmlFor={`comp-${q.id}`} style={{ display: "inline-block", background: "#1a1a2e", color: "#fff", borderRadius: 6, padding: "6px 12px", cursor: uploadingComp ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700 }}>
                      {uploadingComp ? "Subiendo…" : "📎 Subir comprobante"}
                    </label>
                  </div>
                )}
                {q.status !== "pagado" && q.comprobante_url && (
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: "#b45309", fontWeight: 600 }}>⏳ Comprobante enviado — pendiente confirmación</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* TAB: MIS RECIBOS */}
        {tab === "recibos" && (
          <div>
            <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>Mis recibos de pago</h3>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#9ca3af" }}>Recibos oficiales generados por Emporio Inmobiliario al confirmar tu pago</p>
            {cuotas.filter(q => q.recibo_url).length === 0 ? (
              <div style={{ background: "#fff", borderRadius: 12, padding: 48, textAlign: "center" }}>
                <p style={{ fontSize: 32, margin: "0 0 8px" }}>🧾</p>
                <p style={{ color: "#9ca3af" }}>Sin recibos generados aún</p>
                <p style={{ color: "#9ca3af", fontSize: 12 }}>Los recibos aparecen aquí cuando Emporio confirma tu pago</p>
              </div>
            ) : (
              cuotas.filter(q => q.recibo_url).sort((a, b) => b.periodo.localeCompare(a.periodo)).map(q => (
                <div key={q.id} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", marginBottom: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a1a2e" }}>{periodoLabel(q.periodo)}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>Pagado el {q.fecha_pago || "—"} · {fmt(q.monto)}</p>
                  </div>
                  <a href={q.recibo_url} target="_blank" rel="noreferrer" style={{ background: "#b91c3c", color: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
                    📄 Descargar recibo
                  </a>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB: GASTOS COMUNES */}
        {tab === "gastos" && (
          <div>
            <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>Gastos comunes del condominio</h3>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#9ca3af" }}>Estos son los gastos pagados por Emporio con el fondo del condominio</p>
            {gastos.length === 0 && <div style={{ background: "#fff", borderRadius: 12, padding: 32, textAlign: "center" }}><p style={{ color: "#9ca3af" }}>Sin gastos registrados</p></div>}
            {gastos.map(g => (
              <div key={g.id} style={{ background: "#fff", borderRadius: 12, padding: "12px 16px", marginBottom: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#1a1a2e" }}>{g.concepto}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>{CATEGORIAS[g.categoria] || g.categoria} · {g.fecha}</p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: "#7c3aed" }}>{fmt(g.monto)}</p>
                    {g.comprobante_url && (
                      <a href={g.comprobante_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#1e40af", fontWeight: 600 }}>📄 Ver</a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TAB: MANTENIMIENTO */}
        {tab === "tickets" && (
          <div>
            <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>Mantenimiento del condominio</h3>
            {tickets.length === 0 && (
              <div style={{ background: "#fff", borderRadius: 12, padding: 48, textAlign: "center" }}>
                <p style={{ fontSize: 32, margin: "0 0 8px" }}>✅</p>
                <p style={{ color: "#9ca3af" }}>Sin reportes de mantenimiento</p>
              </div>
            )}
            {tickets.map(t => (
              <div key={t.id} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", marginBottom: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", borderLeft: `4px solid ${t.status === "resuelto" ? "#065f46" : t.status === "en_proceso" ? "#1e40af" : "#fcd34d"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a1a2e" }}>{t.title}</p>
                  <StatusBadge status={t.status} />
                </div>
                {t.description && <p style={{ margin: "0 0 6px", fontSize: 13, color: "#374151" }}>{t.description}</p>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {t.charged_amount > 0 && <span style={{ fontSize: 11, color: "#7c3aed", background: "#faf5ff", padding: "2px 8px", borderRadius: 6, fontWeight: 700 }}>Costo: {fmt(t.charged_amount)}</span>}
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>{new Date(t.created_at).toLocaleDateString("es-MX")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
