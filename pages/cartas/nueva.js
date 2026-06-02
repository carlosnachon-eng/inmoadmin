import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../lib/supabase";
import { PageHeader, brand } from "../../components/Layout";

export default function NuevaCarta() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({
    cliente_nombre: "", cliente_tel: "",
    propietarios: "",
    inmueble: "",
    precio_lista: "", precio_oferta: "",
    apartado: "10000", enganche: "", saldo: "",
    forma_pago: "Recursos propios (100%)",
    vigencia_hrs: "24",
    notas: "",
  });

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) supabase.from("profiles").select("*").eq("id", session.user.id).single().then(() => setAuthLoading(false));
      else setAuthLoading(false);
    });
  }, []);

  // Auto-calcular saldo cuando cambia oferta o enganche
  useEffect(() => {
    const oferta = parseFloat(form.precio_oferta) || 0;
    const apartado = parseFloat(form.apartado) || 0;
    const enganche = parseFloat(form.enganche) || 0;
    if (oferta && enganche) {
      set("saldo", String(oferta - enganche));
    }
  }, [form.precio_oferta, form.enganche]);

  const handleSubmit = async () => {
    if (!form.cliente_nombre || !form.inmueble || !form.precio_oferta || !form.propietarios) {
      showToast("Completa los campos obligatorios", false); return;
    }
    setLoading(true);
    try {
      // Generar folio CO-2026-001
      const { data: folioData } = await supabase.rpc("generar_folio", { p_tipo: "carta_oferta" });
      const folio = folioData;

      const { data: carta, error } = await supabase.from("cartas_oferta").insert({
        folio,
        cliente_nombre: form.cliente_nombre,
        cliente_tel: form.cliente_tel || null,
        propietarios: form.propietarios,
        inmueble: form.inmueble,
        precio_lista: parseFloat(form.precio_lista) || null,
        precio_oferta: parseFloat(form.precio_oferta),
        apartado: parseFloat(form.apartado) || 10000,
        enganche: parseFloat(form.enganche) || null,
        saldo: parseFloat(form.saldo) || null,
        forma_pago: form.forma_pago,
        vigencia_hrs: parseInt(form.vigencia_hrs) || 24,
        notas: form.notas || null,
        estatus: "oferta",
        created_by: session.user.id,
      }).select().single();

      if (error) throw error;
      router.push(`/cartas/${carta.id}`);
    } catch (e) {
      showToast(e.message || "Error al guardar", false);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) return <div style={{ minHeight: "100vh", background: brand.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><img src="https://www.emporioinmobiliario.com.mx/logo.png" style={{ height: 48, opacity: 0.4 }} /></div>;
  if (!session) { if (typeof window !== "undefined") window.location.href = "/"; return null; }

  const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" };
  const lbl = { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 };
  const sec = { fontSize: 13, fontWeight: 700, color: brand.gray, borderBottom: `1px solid ${brand.border}`, paddingBottom: 8, marginBottom: 14, marginTop: 4 };
  const row2 = { display: "flex", gap: 12, marginBottom: 14 };

  return (
    <div style={{ minHeight: "100vh", background: brand.bg, fontFamily: "system-ui, sans-serif" }}>
      {toast && <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000 }}>{toast.msg}</div>}
      <PageHeader title="Nueva Carta de Oferta" icon="📄" />
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "24px 20px" }}>
        <div style={{ background: "#fff", borderRadius: 14, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>

          <p style={sec}>Datos del ofertante (comprador)</p>
          <div style={row2}>
            <div style={{ flex: 2 }}>
              <label style={lbl}>Nombre completo *</label>
              <input style={inp} value={form.cliente_nombre} onChange={e => set("cliente_nombre", e.target.value)} placeholder="Nombre del comprador" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Teléfono</label>
              <input style={inp} value={form.cliente_tel} onChange={e => set("cliente_tel", e.target.value)} placeholder="222 000 0000" />
            </div>
          </div>

          <p style={sec}>Propietarios</p>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Nombre(s) del propietario(s) *</label>
            <input style={inp} value={form.propietarios} onChange={e => set("propietarios", e.target.value)} placeholder="Ej: Lorena e Israel García" />
          </div>

          <p style={sec}>Inmueble</p>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Dirección completa *</label>
            <textarea style={{ ...inp, resize: "vertical" }} rows={2} value={form.inmueble} onChange={e => set("inmueble", e.target.value)} placeholder="Calle, número, colonia, ciudad, CP" />
          </div>
          <div style={row2}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Precio de lista</label>
              <input style={inp} type="number" value={form.precio_lista} onChange={e => set("precio_lista", e.target.value)} placeholder="3200000" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Precio ofertado *</label>
              <input style={inp} type="number" value={form.precio_oferta} onChange={e => set("precio_oferta", e.target.value)} placeholder="2950000" />
            </div>
          </div>

          <p style={sec}>Condiciones de pago</p>
          <div style={row2}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Apartado</label>
              <input style={inp} type="number" value={form.apartado} onChange={e => set("apartado", e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Enganche</label>
              <input style={inp} type="number" value={form.enganche} onChange={e => set("enganche", e.target.value)} placeholder="147500" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Saldo restante</label>
              <input style={inp} type="number" value={form.saldo} onChange={e => set("saldo", e.target.value)} placeholder="Auto-calculado" />
            </div>
          </div>
          <div style={row2}>
            <div style={{ flex: 2 }}>
              <label style={lbl}>Forma de pago</label>
              <input style={inp} value={form.forma_pago} onChange={e => set("forma_pago", e.target.value)} 
                placeholder="Ej: Recursos propios 100% / 60% crédito + 40% propio" list="formas-pago" />
              <datalist id="formas-pago">
                <option value="Recursos propios (100%)" />
                <option value="Crédito bancario (100%)" />
                <option value="Crédito Infonavit (100%)" />
                <option value="60% crédito bancario + 40% recursos propios" />
                <option value="50% Infonavit + 50% recursos propios" />
                <option value="70% crédito bancario + 30% recursos propios" />
              </datalist>
            </div>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Vigencia de la oferta (hrs)</label>
              <input style={inp} type="number" value={form.vigencia_hrs} onChange={e => set("vigencia_hrs", e.target.value)} />
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={lbl}>Notas internas</label>
            <textarea style={{ ...inp, resize: "vertical" }} rows={2} value={form.notas} onChange={e => set("notas", e.target.value)} placeholder="Observaciones del equipo" />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => router.push("/cartas")} style={{ flex: 1, background: "#f9fafb", color: brand.gray, border: `1px solid ${brand.border}`, borderRadius: 10, padding: 12, fontWeight: 700, cursor: "pointer", fontSize: 14 }}>Cancelar</button>
            <button onClick={handleSubmit} disabled={loading || !form.cliente_nombre || !form.inmueble || !form.precio_oferta || !form.propietarios}
              style={{ flex: 2, background: loading ? "#9ca3af" : brand.red, color: "#fff", border: "none", borderRadius: 10, padding: 12, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontSize: 14 }}>
              {loading ? "Guardando..." : "✓ Guardar y generar cartas"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
