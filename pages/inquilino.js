import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

const StatusBadge = ({ status }) => {
  const map = {
    pagado: { bg: "#d1fae5", color: "#065f46", label: "Pagado" },
    atrasado: { bg: "#fee2e2", color: "#991b1b", label: "Atrasado" },
    pendiente: { bg: "#fef3c7", color: "#92400e", label: "Pendiente" },
    en_revision: { bg: "#dbeafe", color: "#1e40af", label: "En revisión" },
    nuevo: { bg: "#fef3c7", color: "#92400e", label: "Nuevo" },
    en_proceso: { bg: "#dbeafe", color: "#1e40af", label: "En proceso" },
    resuelto: { bg: "#d1fae5", color: "#065f46", label: "Resuelto" },
  };
  const s = map[status] || { bg: "#f3f4f6", color: "#374151", label: status };
  return <span style={{ background: s.bg, color: s.color, padding: "2px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{s.label}</span>;
};

const Input = (props) => (
  <input {...props} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 15, boxSizing: "border-box", ...props.style }} />
);

const Btn = ({ children, onClick, color = "#1a1a2e", disabled, full }) => (
  <button onClick={onClick} disabled={disabled} style={{ background: color, color: "#fff", border: "none", borderRadius: 12, padding: "13px 24px", fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", fontSize: 15, opacity: disabled ? 0.6 : 1, width: full ? "100%" : "auto" }}>
    {children}
  </button>
);

const TenantLogin = ({ onLogin }) => {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const sendMagicLink = async () => {
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: "https://app.emporioinmobiliario.com.mx/inquilino",
      }
    });
    setLoading(false);
    if (error) {
      setError("Error al enviar el enlace: " + error.message);
    } else {
      setSent(true);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #1a1a2e, #2d2d5e)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 24, padding: 40, width: "100%", maxWidth: 400, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🏢</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#1a1a2e" }}>Portal Inquilino</h1>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "#6b7280" }}>Emporio Inmobiliario</p>
        </div>

        {error && (
          <div style={{ background: "#fee2e2", color: "#991b1b", padding: "12px 16px", borderRadius: 10, marginBottom: 20, fontSize: 14, fontWeight: 600 }}>
            {error}
          </div>
        )}

        {!sent ? (
          <>
            <p style={{ fontSize: 14, color: "#6b7280", margin: "0 0 20px", textAlign: "center" }}>
              Ingresa tu email y te mandamos un enlace para entrar
            </p>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Tu email</label>
              <Input type="email" placeholder="tu@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMagicLink()} />
            </div>
            <Btn full color="#c8a96e" onClick={sendMagicLink} disabled={loading || !email}>
              {loading ? "Enviando..." : "Enviar enlace de acceso →"}
            </Btn>
          </>
        ) : (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>📧</div>
            <h3 style={{ margin: "0 0 12px", color: "#1a1a2e", fontSize: 18, fontWeight: 800 }}>¡Revisa tu email!</h3>
            <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 8px" }}>
              Enviamos un enlace de acceso a:
            </p>
            <p style={{ color: "#1a1a2e", fontWeight: 700, fontSize: 15, margin: "0 0 20px" }}>{email}</p>
            <p style={{ color: "#9ca3af", fontSize: 13, margin: "0 0 20px" }}>
              Haz clic en el enlace del email para entrar a tu portal. Revisa también tu carpeta de spam.
            </p>
            <button onClick={() => { setSent(false); setEmail(""); }} style={{ background: "transparent", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 14, textDecoration: "underline" }}>
              Usar otro email
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default function InquilinoPortal() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tab, setTab] = useState("inicio");
  const [contract, setContract] = useState(null);
  const [payments, setPayments] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [ticketForm, setTicketForm] = useState({ title: "", description: "", category: "otro", priority: "media" });
  const [saving, setSaving] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(null);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) loadTenantData();
  }, [session]);

  const loadTenantData = async () => {
    setLoading(true);
    const email = session.user.email;
    const { data: contractData } = await supabase
      .from("contracts")
      .select("*")
      .eq("tenant_email", email)
      .eq("status", "activo")
      .single();
    if (contractData) {
      setContract(contractData);
      const { data: paymentsData } = await supabase
        .from("payments")
        .select("*")
        .eq("contract_id", contractData.id)
        .order("due_date", { ascending: true });
      setPayments(paymentsData || []);
      const { data: ticketsData } = await supabase
        .from("maintenance_tickets")
        .select("*")
        .eq("tenant_name", contractData.tenant_name)
        .order("created_at", { ascending: false });
      setTickets(ticketsData || []);
    }
    setLoading(false);
  };

  const submitTicket = async () => {
    if (!contract) return;
    setSaving(true);
    const { error } = await supabase.from("maintenance_tickets").insert([{
      property_name: contract.property_name,
      tenant_name: contract.tenant_name,
      title: ticketForm.title,
      description: ticketForm.description,
      category: ticketForm.category,
      priority: ticketForm.priority,
      status: "nuevo",
    }]);
    setSaving(false);
    if (error) { showToast("Error al enviar: " + error.message, false); return; }
    showToast("✅ Reporte enviado, te contactaremos pronto");
    setTicketForm({ title: "", description: "", category: "otro", priority: "media" });
    setTab("mantenimiento");
    loadTenantData();
  };

  const uploadReceipt = async (paymentId, file) => {
    setUploadingFile(paymentId);
    try {
      const ext = file.name.split(".").pop();
      const fileName = `comprobantes/${paymentId}_${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(fileName, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from("receipts").getPublicUrl(fileName);
      await supabase.from("payments").update({ receipt_url: publicUrl, status: "en_revision" }).eq("id", paymentId);
      showToast("✅ Comprobante enviado, lo revisaremos pronto");
      loadTenantData();
    } catch (e) {
      showToast("Error al subir: " + e.message, false);
    }
    setUploadingFile(null);
  };

  const logout = async () => { await supabase.auth.signOut(); setSession(null); };

  const hoy = new Date();
  const pagosMes = payments.filter(p => {
    if (!p.due_date) return false;
    const d = new Date(p.due_date);
    return d.getMonth() === hoy.getMonth() && d.getFullYear() === hoy.getFullYear();
  });
  const pagoPendiente = pagosMes.find(p => ["pendiente", "atrasado"].includes(p.status));
  const totalPagado = payments.filter(p => p.status === "pagado").length;

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#c8a96e", fontSize: 18, fontWeight: 700 }}>Cargando...</p>
    </div>
  );

  if (!session) return <TenantLogin onLogin={() => loadTenantData()} />;

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#6b7280" }}>Cargando tu información...</p>
    </div>
  );

  if (!contract) return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", padding: 40 }}>
        <p style={{ fontSize: 48, margin: "0 0 16px" }}>🔍</p>
        <h2 style={{ color: "#1a1a2e", margin: "0 0 8px" }}>No encontramos tu contrato</h2>
        <p style={{ color: "#6b7280", margin: "0 0 20px" }}>Asegúrate de usar el mismo email que registraste con tu inmobiliaria</p>
        <button onClick={logout} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontWeight: 600 }}>Cerrar sesión</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", fontFamily: "system-ui, sans-serif" }}>
      {toast && <div style={{ position: "fixed", top: 24, right: 24, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 2000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", maxWidth: 300 }}>{toast.msg}</div>}

      <div style={{ background: "linear-gradient(135deg, #1a1a2e, #2d2d5e)", padding: "24px 20px 0" }}>
        <div style={{ maxWidth: 600, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              <p style={{ margin: 0, fontSize: 12, color: "#c8a96e", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>Portal Inquilino</p>
              <h2 style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 800, color: "#fff" }}>Hola, {contract.tenant_name.split(" ")[0]} 👋</h2>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.6)" }}>📍 {contract.property_name}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Renta mensual</p>
              <p style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 800, color: "#c8a96e" }}>{fmt(contract.monthly_rent)}</p>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Día {contract.payment_day} de cada mes</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {[
              { id: "inicio", label: "🏠 Inicio" },
              { id: "pagos", label: "💰 Pagos" },
              { id: "mantenimiento", label: "🔧 Mantenimiento" },
              { id: "contrato", label: "📋 Contrato" },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "8px 16px", borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: tab === t.id ? "#fff" : "rgba(255,255,255,0.1)", color: tab === t.id ? "#1a1a2e" : "rgba(255,255,255,0.7)" }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 600, margin: "0 auto", padding: "24px 20px" }}>
        {tab === "inicio" && (
          <div>
            {pagoPendiente ? (
              <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 16, border: "2px solid #fcd34d" }}>
                <p style={{ margin: "0 0 4px", fontSize: 12, color: "#92400e", fontWeight: 700, textTransform: "uppercase" }}>⚠️ Pago pendiente este mes</p>
                <p style={{ margin: "0 0 16px", fontSize: 26, fontWeight: 800, color: "#1a1a2e" }}>{fmt(pagoPendiente.amount)}</p>
                <p style={{ margin: "0 0 16px", fontSize: 13, color: "#6b7280" }}>Vence el {pagoPendiente.due_date}</p>
                <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "#374151" }}>¿Ya pagaste? Sube tu comprobante:</p>
                <label style={{ display: "flex", alignItems: "center", gap: 10, background: "#1a1a2e", color: "#c8a96e", padding: "12px 20px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14, width: "fit-content" }}>
                  {uploadingFile === pagoPendiente.id ? "Subiendo..." : "📎 Subir comprobante"}
                  <input type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={e => e.target.files[0] && uploadReceipt(pagoPendiente.id, e.target.files[0])} disabled={!!uploadingFile} />
                </label>
              </div>
            ) : (
              <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginBottom: 16, border: "2px solid #6ee7b7" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <span style={{ fontSize: 40 }}>✅</span>
                  <div>
                    <p style={{ margin: 0, fontWeight: 800, fontSize: 16, color: "#065f46" }}>¡Estás al corriente!</p>
                    <p style={{ margin: "4px 0 0", fontSize: 13, color: "#047857" }}>No tienes pagos pendientes este mes</p>
                  </div>
                </div>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div style={{ background: "#fff", borderRadius: 14, padding: 18 }}>
                <p style={{ margin: "0 0 4px", fontSize: 11, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>Pagos realizados</p>
                <p style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#065f46" }}>{totalPagado}</p>
              </div>
              <div style={{ background: "#fff", borderRadius: 14, padding: 18 }}>
                <p style={{ margin: "0 0 4px", fontSize: 11, color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>Tickets abiertos</p>
                <p style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#1e40af" }}>{tickets.filter(t => t.status !== "resuelto").length}</p>
              </div>
            </div>
            <button onClick={logout} style={{ width: "100%", background: "#f3f4f6", border: "none", borderRadius: 10, padding: "12px", cursor: "pointer", fontSize: 14, color: "#6b7280", fontWeight: 600 }}>
              Cerrar sesión
            </button>
          </div>
        )}

        {tab === "pagos" && (
          <div>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#1a1a2e" }}>Historial de pagos</h3>
            {payments.map(p => (
              <div key={p.id} style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", marginBottom: 10, border: p.status === "atrasado" ? "2px solid #fca5a5" : "1px solid #f0f0f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: "#1a1a2e" }}>{fmt(p.amount)}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>Vence {p.due_date}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                {["pendiente", "atrasado"].includes(p.status) && (
                  <label style={{ display: "flex", alignItems: "center", gap: 8, background: "#f9fafb", padding: "10px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151", border: "1px dashed #d1d5db" }}>
                    {uploadingFile === p.id ? "⏳ Subiendo..." : "📎 Subir comprobante"}
                    <input type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={e => e.target.files[0] && uploadReceipt(p.id, e.target.files[0])} disabled={!!uploadingFile} />
                  </label>
                )}
                {p.status === "en_revision" && (
                  <div style={{ background: "#dbeafe", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#1e40af", fontWeight: 600 }}>
                    🔍 Tu comprobante está en revisión
                  </div>
                )}
                {p.receipt_url && p.status === "pagado" && (
                  <a href={p.receipt_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#065f46", textDecoration: "none" }}>📄 Ver comprobante</a>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "mantenimiento" && (
          <div>
            <div style={{ background: "#fff", borderRadius: 16, padding: 22, marginBottom: 16 }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: "#1a1a2e" }}>Reportar un problema</h3>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>¿Qué ocurre? *</label>
                <Input placeholder="Ej: Fuga de agua en baño" value={ticketForm.title} onChange={e => setTicketForm({ ...ticketForm, title: e.target.value })} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Descripción</label>
                <textarea placeholder="Describe el problema..." value={ticketForm.description} onChange={e => setTicketForm({ ...ticketForm, description: e.target.value })} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", minHeight: 80, resize: "vertical", fontFamily: "inherit" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Tipo</label>
                  <select value={ticketForm.category} onChange={e => setTicketForm({ ...ticketForm, category: e.target.value })} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, background: "#fff" }}>
                    <option value="plomería">🚿 Plomería</option>
                    <option value="electricidad">⚡ Electricidad</option>
                    <option value="pintura">🎨 Pintura</option>
                    <option value="carpintería">🪚 Carpintería</option>
                    <option value="otro">🔧 Otro</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Urgencia</label>
                  <select value={ticketForm.priority} onChange={e => setTicketForm({ ...ticketForm, priority: e.target.value })} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, background: "#fff" }}>
                    <option value="baja">🟢 Baja</option>
                    <option value="media">🟡 Media</option>
                    <option value="alta">🟠 Alta</option>
                    <option value="urgente">🔴 Urgente</option>
                  </select>
                </div>
              </div>
              <button onClick={submitTicket} disabled={saving || !ticketForm.title} style={{ width: "100%", background: "#1a1a2e", color: "#fff", border: "none", borderRadius: 12, padding: "13px", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", fontSize: 15, opacity: saving ? 0.6 : 1 }}>
                {saving ? "Enviando..." : "Enviar reporte"}
              </button>
            </div>
            {tickets.length > 0 && (
              <div>
                <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#1a1a2e" }}>Mis reportes</h3>
                {tickets.map(t => (
                  <div key={t.id} style={{ background: "#fff", borderRadius: 14, padding: "14px 18px", marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{t.title}</p>
                      <StatusBadge status={t.status} />
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>{t.category} · {new Date(t.created_at).toLocaleDateString("es-MX")}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "contrato" && (
          <div style={{ background: "#fff", borderRadius: 16, padding: 24 }}>
            <h3 style={{ margin: "0 0 20px", fontSize: 15, fontWeight: 700, color: "#1a1a2e" }}>Mi contrato</h3>
            {[
              ["Propiedad", contract.property_name],
              ["Inquilino", contract.tenant_name],
              ["Inicio", contract.start_date],
              ["Fin", contract.end_date],
              ["Renta mensual", fmt(contract.monthly_rent)],
              ["Depósito", fmt(contract.deposit_amount)],
              ["Día de pago", `Día ${contract.payment_day} de cada mes`],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid #f9fafb" }}>
                <span style={{ fontSize: 14, color: "#6b7280" }}>{k}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
