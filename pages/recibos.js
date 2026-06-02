import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";
import { PageHeader, brand } from "../components/Layout";

const fmt = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0 }).format(n || 0);

const ESTATUS_STYLE = {
  activo:     { bg: "#d1fae5", color: "#065f46", label: "Activo" },
  vencido:    { bg: "#fef3c7", color: "#92400e", label: "Vencido" },
  cancelado:  { bg: "#fee2e2", color: "#991b1b", label: "Cancelado" },
  concretado: { bg: "#dbeafe", color: "#1e40af", label: "Concretado" },
};

const Modal = ({ title, onClose, children }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
    <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>{title}</h2>
        <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      {children}
    </div>
  </div>
);

export default function Recibos() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [recibos, setRecibos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroEstatus, setFiltroEstatus] = useState("activo");
  const [modalCancelar, setModalCancelar] = useState(null);
  const [motivoCancelacion, setMotivoCancelacion] = useState("");
  const [saving, setSaving] = useState(false);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) loadProfile(s.user.id);
      else { setProfile(null); setAuthLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadProfile = async (uid) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).single();
    setProfile(data); setAuthLoading(false);
  };

  const loadRecibos = async () => {
    setLoading(true);
    const { data } = await supabase.from("recibos_apartado").select("*").order("created_at", { ascending: false });
    setRecibos(data || []);
    setLoading(false);
  };

  useEffect(() => { if (session) loadRecibos(); }, [session]);

  const filtered = recibos.filter(r => {
    const matchSearch = !search ||
      r.folio?.toLowerCase().includes(search.toLowerCase()) ||
      r.cliente_nombre?.toLowerCase().includes(search.toLowerCase()) ||
      r.inmueble?.toLowerCase().includes(search.toLowerCase());
    const matchTipo = !filtroTipo || r.tipo === filtroTipo;
    const matchEstatus = !filtroEstatus || r.estatus === filtroEstatus;
    return matchSearch && matchTipo && matchEstatus;
  });

  const cambiarEstatus = async (recibo, nuevoEstatus) => {
    if (nuevoEstatus === "cancelado") {
      setModalCancelar(recibo);
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("recibos_apartado").update({ estatus: nuevoEstatus }).eq("id", recibo.id);
    setSaving(false);
    if (error) { showToast("Error al actualizar", false); return; }
    // Log
    await supabase.from("recibos_log").insert({ recibo_id: recibo.id, accion: nuevoEstatus, usuario_id: session.user.id });
    showToast("Estatus actualizado");
    loadRecibos();
  };

  const confirmarCancelacion = async () => {
    if (!motivoCancelacion.trim()) { showToast("Escribe el motivo de cancelación", false); return; }
    setSaving(true);
    const { error } = await supabase.from("recibos_apartado").update({
      estatus: "cancelado",
      motivo_cancelacion: motivoCancelacion,
      cancelado_por: session.user.id,
      cancelado_at: new Date().toISOString(),
    }).eq("id", modalCancelar.id);
    if (!error) {
      await supabase.from("recibos_log").insert({ recibo_id: modalCancelar.id, accion: "cancelado", usuario_id: session.user.id });
      // Notificación a Carlos vía API
      await fetch("/api/notificar-cancelacion-recibo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folio: modalCancelar.folio,
          cliente: modalCancelar.cliente_nombre,
          inmueble: modalCancelar.inmueble,
          monto: modalCancelar.monto,
          motivo: motivoCancelacion,
          cancelado_por: profile?.email,
        }),
      });
    }
    setSaving(false);
    setModalCancelar(null);
    setMotivoCancelacion("");
    if (error) { showToast("Error al cancelar", false); return; }
    showToast("Recibo cancelado");
    loadRecibos();
  };

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: brand.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, opacity: 0.4 }} />
    </div>
  );
  if (!session) { if (typeof window !== "undefined") window.location.href = "/"; return null; }

  return (
    <div style={{ minHeight: "100vh", background: brand.bg, fontFamily: "system-ui, sans-serif" }}>
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", maxWidth: 320 }}>
          {toast.msg}
        </div>
      )}

      <PageHeader
        title="Recibos de Apartado"
        icon="🧾"
        actions={
          <button onClick={() => router.push("/recibos/nuevo")} style={{ background: brand.red, color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
            + Nuevo recibo
          </button>
        }
      />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>

        {/* Filtros */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
          <input
            placeholder="Buscar por folio, cliente o inmueble…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200, padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13 }}
          />
          <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
            <option value="">Todos los tipos</option>
            <option value="compraventa">Compraventa</option>
            <option value="arrendamiento">Arrendamiento</option>
          </select>
          <select value={filtroEstatus} onChange={e => setFiltroEstatus(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
            <option value="">Todos los estatus</option>
            <option value="activo">Activo</option>
            <option value="vencido">Vencido</option>
            <option value="cancelado">Cancelado</option>
            <option value="concretado">Concretado</option>
          </select>
          <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: "auto" }}>{filtered.length} recibos</span>
        </div>

        {/* Tabla */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 48, color: "#9ca3af" }}>Cargando recibos…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: "#9ca3af" }}>No se encontraron recibos.</div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  {["Folio", "Tipo", "Cliente", "Inmueble", "Monto", "Recibió", "Estatus", "PDF", "Acciones"].map(h => (
                    <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const est = ESTATUS_STYLE[r.estatus] || ESTATUS_STYLE.activo;
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "11px 14px", fontFamily: "monospace", fontWeight: 700, color: brand.red, fontSize: 13 }}>{r.folio}</td>
                      <td style={{ padding: "11px 14px" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: r.tipo === "compraventa" ? "#b91c3c" : "#1e40af", background: r.tipo === "compraventa" ? "#fce8ed" : "#dbeafe", padding: "2px 8px", borderRadius: 99 }}>
                          {r.tipo === "compraventa" ? "Venta" : "Renta"}
                        </span>
                      </td>
                      <td style={{ padding: "11px 14px", fontSize: 13, color: "#1a1a2e", fontWeight: 600 }}>{r.cliente_nombre}</td>
                      <td style={{ padding: "11px 14px", fontSize: 12, color: "#6b7280", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.inmueble}</td>
                      <td style={{ padding: "11px 14px", fontWeight: 700, fontSize: 13, color: "#1a1a2e" }}>{fmt(r.monto)}</td>
                      <td style={{ padding: "11px 14px", fontSize: 12, color: "#6b7280" }}>{r.recibido_por || "—"}</td>
                      <td style={{ padding: "11px 14px" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: est.color, background: est.bg, padding: "3px 8px", borderRadius: 99 }}>{est.label}</span>
                      </td>
                      <td style={{ padding: "11px 14px" }}>
                        {r.pdf_url
                          ? <a href={r.pdf_url} target="_blank" rel="noreferrer" style={{ color: brand.red, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>Ver PDF</a>
                          : <span style={{ color: "#d1d5db", fontSize: 12 }}>—</span>
                        }
                      </td>
                      <td style={{ padding: "11px 14px" }}>
                        {r.estatus === "activo" && (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => cambiarEstatus(r, "concretado")} style={{ background: "#d1fae5", color: "#065f46", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>✓ Concretado</button>
                            <button onClick={() => cambiarEstatus(r, "cancelado")} style={{ background: "#fee2e2", color: "#991b1b", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>✕ Cancelar</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal cancelación */}
      {modalCancelar && (
        <Modal title={`Cancelar ${modalCancelar.folio}`} onClose={() => { setModalCancelar(null); setMotivoCancelacion(""); }}>
          <p style={{ fontSize: 14, color: "#6b7280", marginTop: 0 }}>
            Cliente: <strong>{modalCancelar.cliente_nombre}</strong><br />
            Monto: <strong>{fmt(modalCancelar.monto)}</strong>
          </p>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Motivo de cancelación *</label>
            <textarea
              value={motivoCancelacion}
              onChange={e => setMotivoCancelacion(e.target.value)}
              placeholder="Ej: El comprador desistió, crédito no aprobado, vencimiento de plazo…"
              rows={3}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", resize: "vertical" }}
            />
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => { setModalCancelar(null); setMotivoCancelacion(""); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>Cancelar</button>
            <button onClick={confirmarCancelacion} disabled={saving || !motivoCancelacion.trim()} style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", fontSize: 14, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Guardando…" : "Confirmar cancelación"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
