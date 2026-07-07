import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";
import { PageHeader, brand, Btn } from "../components/Layout";
import { usePermiso, SinAcceso } from "../lib/permisos";
import { ESTADOS_INSPECCION, TIPOS_INMUEBLE, fmtFecha } from "../lib/inspecciones";

const card = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, boxShadow: "0 8px 24px rgba(15,23,42,.06)" };
const input = { width: "100%", padding: "11px 12px", border: "1px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box", background: "#fff" };

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 800, color: "#6b7280", textTransform: "uppercase", letterSpacing: .6, marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 1000 }}>
      <div style={{ ...card, width: "100%", maxWidth: 620, padding: 24, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ margin: 0, color: "#111827", fontSize: 20 }}>{title}</h2>
          <button onClick={onClose} style={{ border: "none", background: "#f3f4f6", borderRadius: 10, padding: "8px 11px", cursor: "pointer" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Inspecciones() {
  const router = useRouter();
  const { cargando: permisoCargando, puedeVer, puedeEditar, perfil } = usePermiso("inspecciones");
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [inspecciones, setInspecciones] = useState([]);
  const [properties, setProperties] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [plantillas, setPlantillas] = useState([]);
  const [filtro, setFiltro] = useState("");
  const [search, setSearch] = useState("");
  const [showNueva, setShowNueva] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    inmueble_id: "",
    contrato_id: "",
    tipo_inmueble: "casa",
    fecha: new Date().toISOString().slice(0, 10),
    hora: new Date().toTimeString().slice(0, 5),
    recibido_por: "",
    entregado_por: "",
  });

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) loadData(); }, [session]);

  async function loadData() {
    setLoading(true);
    const [i, p, c, t] = await Promise.all([
      supabase.from("inspecciones").select("*, properties:inmueble_id(id,name,owner_email), contracts:contrato_id(id,tenant_name,property_name,status)").order("created_at", { ascending: false }),
      supabase.from("properties").select("id,name,owner_email,rent_amount,status").order("name"),
      supabase.from("contracts").select("id,tenant_name,property_name,status,end_date").order("created_at", { ascending: false }),
      supabase.from("plantillas_inspeccion").select("*").eq("activo", true).order("tipo_inmueble"),
    ]);
    if (i.error) showToast(`Error cargando inspecciones: ${i.error.message}`, false);
    setInspecciones(i.data || []);
    setProperties(p.data || []);
    setContracts(c.data || []);
    setPlantillas(t.data || []);
    setLoading(false);
  }

  function onSelectContrato(id) {
    const contrato = contracts.find((c) => c.id === id);
    const prop = properties.find((p) => p.name === contrato?.property_name);
    setForm((f) => ({
      ...f,
      contrato_id: id,
      inmueble_id: prop?.id || f.inmueble_id,
      recibido_por: f.recibido_por || "Emporio Inmobiliario",
      entregado_por: f.entregado_por || contrato?.tenant_name || "",
    }));
  }

  async function crearInspeccion() {
    const plantilla = plantillas.find((p) => p.tipo_inmueble === form.tipo_inmueble && p.activo);
    if (!plantilla) {
      showToast("No hay plantilla activa para ese tipo de inmueble. Crea o activa una plantilla primero.", false);
      return;
    }
    setSaving(true);
    const payload = {
      ...form,
      contrato_id: form.contrato_id || null,
      inmueble_id: form.inmueble_id || null,
      plantilla_id: plantilla.id,
      tipo_inspeccion: "entrega_recepcion",
      estatus: "borrador",
      hora: `${form.hora}:00`,
      created_by: session.user.id,
      updated_by: session.user.id,
    };
    const { data, error } = await supabase.from("inspecciones").insert(payload).select("id").single();
    setSaving(false);
    if (error) {
      showToast(error.message, false);
      return;
    }
    router.push(`/inspecciones/${data.id}`);
  }

  if (authLoading || permisoCargando) return <div style={{ padding: 40, fontFamily: "system-ui" }}>Cargando...</div>;
  if (!session) { if (typeof window !== "undefined") window.location.href = "/"; return null; }
  if (!puedeVer) return <SinAcceso />;

  const filtradas = inspecciones.filter((i) => {
    const texto = `${i.properties?.name || ""} ${i.contracts?.property_name || ""} ${i.contracts?.tenant_name || ""} ${i.recibido_por || ""} ${i.entregado_por || ""}`.toLowerCase();
    return (!filtro || i.estatus === filtro) && (!search || texto.includes(search.toLowerCase()));
  });

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", fontFamily: "system-ui, sans-serif" }}>
      <PageHeader
        title="Inspecciones"
        icon="🔎"
        actions={(
          <>
            {perfil?.role_id === "admin" && <Btn variant="secondary" onClick={() => router.push("/inspecciones/plantillas")}>Plantillas</Btn>}
            {puedeEditar && <Btn onClick={() => setShowNueva(true)}>+ Nueva inspección</Btn>}
          </>
        )}
      />

      {toast && (
        <div style={{ position: "fixed", right: 18, top: 18, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 16px", borderRadius: 12, zIndex: 1200, fontWeight: 800 }}>
          {toast.msg}
        </div>
      )}

      <main style={{ maxWidth: 1180, margin: "0 auto", padding: 24 }}>
        <section style={{ ...card, padding: 18, marginBottom: 18, display: "grid", gridTemplateColumns: "minmax(220px,1fr) 220px", gap: 12 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por inmueble, contrato, inquilino o responsable..." style={input} />
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={input}>
            <option value="">Todos los estatus</option>
            {Object.entries(ESTADOS_INSPECCION).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
          </select>
        </section>

        <div style={{ display: "grid", gap: 12 }}>
          {loading && <p style={{ color: "#6b7280" }}>Cargando inspecciones...</p>}
          {!loading && filtradas.map((i) => {
            const st = ESTADOS_INSPECCION[i.estatus] || ESTADOS_INSPECCION.borrador;
            return (
              <button key={i.id} onClick={() => router.push(`/inspecciones/${i.id}`)} style={{ ...card, padding: 18, borderLeft: `5px solid ${st.color}`, textAlign: "left", cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <div>
                    <p style={{ margin: "0 0 5px", fontSize: 12, color: "#9ca3af", textTransform: "uppercase", fontWeight: 900 }}>Entrega-recepción · {fmtFecha(i.fecha)}</p>
                    <h3 style={{ margin: 0, color: "#111827", fontSize: 18 }}>{i.properties?.name || i.contracts?.property_name || "Inmueble sin nombre"}</h3>
                    <p style={{ margin: "5px 0 0", color: "#6b7280", fontSize: 13 }}>
                      Entrega: {i.entregado_por || "—"} · Recibe: {i.recibido_por || "—"}
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ background: st.bg, color: st.color, padding: "6px 10px", borderRadius: 99, fontSize: 12, fontWeight: 900 }}>{st.label}</span>
                    <p style={{ margin: "8px 0 0", color: "#9ca3af", fontSize: 12 }}>{i.pdf_url ? "PDF generado" : "Sin PDF"}</p>
                  </div>
                </div>
              </button>
            );
          })}
          {!loading && filtradas.length === 0 && (
            <div style={{ ...card, padding: 32, textAlign: "center", color: "#9ca3af" }}>
              No hay inspecciones con esos filtros.
            </div>
          )}
        </div>
      </main>

      {showNueva && (
        <Modal title="Nueva inspección de entrega-recepción" onClose={() => setShowNueva(false)}>
          <Field label="Contrato relacionado (opcional)">
            <select value={form.contrato_id} onChange={(e) => onSelectContrato(e.target.value)} style={input}>
              <option value="">Sin contrato / seleccionar manualmente</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.property_name} · {c.tenant_name} · {c.status}</option>)}
            </select>
          </Field>
          <Field label="Inmueble administrado">
            <select value={form.inmueble_id} onChange={(e) => setForm({ ...form, inmueble_id: e.target.value })} style={input}>
              <option value="">Selecciona inmueble</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.owner_email || "sin propietario"}</option>)}
            </select>
          </Field>
          <Field label="Tipo de inmueble">
            <select value={form.tipo_inmueble} onChange={(e) => setForm({ ...form, tipo_inmueble: e.target.value })} style={input}>
              {TIPOS_INMUEBLE.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Fecha"><input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} style={input} /></Field>
            <Field label="Hora"><input type="time" value={form.hora} onChange={(e) => setForm({ ...form, hora: e.target.value })} style={input} /></Field>
          </div>
          <Field label="Entregado por">
            <input value={form.entregado_por} onChange={(e) => setForm({ ...form, entregado_por: e.target.value })} placeholder="Inquilino, ocupante o representante" style={input} />
          </Field>
          <Field label="Recibido por">
            <input value={form.recibido_por} onChange={(e) => setForm({ ...form, recibido_por: e.target.value })} placeholder="Representante de Emporio" style={input} />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
            <Btn variant="secondary" onClick={() => setShowNueva(false)}>Cancelar</Btn>
            <Btn disabled={saving} onClick={crearInspeccion}>{saving ? "Creando..." : "Crear inspección"}</Btn>
          </div>
        </Modal>
      )}

      <style jsx>{`
        @media (max-width: 720px) {
          main { padding: 14px !important; }
          section { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
