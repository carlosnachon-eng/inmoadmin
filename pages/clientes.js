import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import Layout, { brand } from "../components/Layout";
import { usePermiso, SinAcceso } from "../lib/permisos";

const ETAPAS = [
  { value: "nuevo", label: "Nuevo", color: "#6b7280", bg: "#f3f4f6" },
  { value: "en_seguimiento", label: "En seguimiento", color: "#1e40af", bg: "#dbeafe" },
  { value: "caliente", label: "Caliente", color: "#991b1b", bg: "#fee2e2" },
  { value: "frio", label: "Frío", color: "#0369a1", bg: "#e0f2fe" },
  { value: "cerrado", label: "Cerrado", color: "#065f46", bg: "#d1fae5" },
  { value: "perdido", label: "Perdido", color: "#78716c", bg: "#f5f5f4" },
];

const etapaInfo = (valor) => ETAPAS.find((e) => e.value === valor) || ETAPAS[0];

const fmtFechaHora = (d) =>
  new Date(d).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// ── Modal: Nuevo cliente + nueva cita en un solo flujo ──────────────────────
// Diseñado para celular: pocos campos, pasos claros, botones grandes.
function ModalNuevaCita({ onClose, onGuardado, asesorId, propiedadPrellenada, showToast }) {
  const [paso, setPaso] = useState(1); // 1: buscar/capturar cliente, 2: datos de la cita
  const [busqueda, setBusqueda] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [coincidencias, setCoincidencias] = useState([]);
  const [clienteElegido, setClienteElegido] = useState(null);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [telefonoNuevo, setTelefonoNuevo] = useState("");
  const [correoNuevo, setCorreoNuevo] = useState("");

  const [propiedadBusqueda, setPropiedadBusqueda] = useState("");
  const [propiedadesResultado, setPropiedadesResultado] = useState([]);
  const [propiedadElegida, setPropiedadElegida] = useState(propiedadPrellenada || null);
  const [fechaHora, setFechaHora] = useState("");
  const [guardando, setGuardando] = useState(false);

  // Buscar coincidencias por teléfono o correo mientras el asesor teclea,
  // para avisar de duplicados antes de crear un cliente nuevo.
  useEffect(() => {
    const buscar = async () => {
      if (!telefonoNuevo && !correoNuevo) { setCoincidencias([]); return; }
      setBuscando(true);
      const filtros = [];
      if (telefonoNuevo) filtros.push(`telefono.eq.${telefonoNuevo}`);
      if (correoNuevo) filtros.push(`correo.eq.${correoNuevo}`);
      const { data } = await supabase
        .from("clientes")
        .select("id, nombre, telefono, correo, asesor_id, created_at, profiles:asesor_id(full_name, email)")
        .or(filtros.join(","));
      setCoincidencias(data || []);
      setBuscando(false);
    };
    const t = setTimeout(buscar, 400);
    return () => clearTimeout(t);
  }, [telefonoNuevo, correoNuevo]);

  // Búsqueda de propiedad (opcional) para ligar la cita.
  useEffect(() => {
    const buscar = async () => {
      if (!propiedadBusqueda || propiedadBusqueda.length < 3) { setPropiedadesResultado([]); return; }
      const { data } = await supabase
        .from("propiedades")
        .select("id, titulo, direccion, public_id")
        .or(`titulo.ilike.%${propiedadBusqueda}%,direccion.ilike.%${propiedadBusqueda}%`)
        .limit(6);
      setPropiedadesResultado(data || []);
    };
    const t = setTimeout(buscar, 350);
    return () => clearTimeout(t);
  }, [propiedadBusqueda]);

  const usarClienteExistente = (c) => {
    setClienteElegido(c);
    setCoincidencias([]);
    setPaso(2);
  };

  const esOtroCliente = () => {
    setCoincidencias([]);
  };

  const continuarConClienteNuevo = () => {
    if (!nombreNuevo.trim()) { showToast("Captura el nombre del cliente", false); return; }
    setPaso(2);
  };

  const guardar = async () => {
    if (!fechaHora) { showToast("Captura la fecha y hora de la cita", false); return; }
    setGuardando(true);
    try {
      let clienteId = clienteElegido?.id;

      if (!clienteId) {
        const { data: nuevoCliente, error: errorCliente } = await supabase
          .from("clientes")
          .insert({
            nombre: nombreNuevo.trim(),
            telefono: telefonoNuevo || null,
            correo: correoNuevo || null,
            asesor_id: asesorId,
          })
          .select()
          .single();
        if (errorCliente) throw errorCliente;
        clienteId = nuevoCliente.id;
      }

      const { error: errorCita } = await supabase.from("citas").insert({
        cliente_id: clienteId,
        propiedad_id: propiedadElegida?.id || null,
        asesor_id: asesorId,
        fecha_hora: fechaHora,
        estado: "agendada",
      });
      if (errorCita) throw errorCita;

      showToast("Cita agendada");
      onGuardado();
      onClose();
    } catch (e) {
      showToast("Error al guardar: " + e.message, false);
    }
    setGuardando(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 2000 }}>
      <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: 20, width: "100%", maxWidth: 480, maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: brand.gray }}>
            {paso === 1 ? "¿Quién es el cliente?" : "Datos de la cita"}
          </h2>
          <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: "pointer" }}>✕</button>
        </div>

        {paso === 1 && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Nombre</label>
              <input value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} placeholder="Nombre del cliente"
                style={{ width: "100%", padding: "14px 14px", borderRadius: 12, border: "1.5px solid #e5e7eb", fontSize: 16, boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Teléfono</label>
              <input value={telefonoNuevo} onChange={(e) => setTelefonoNuevo(e.target.value)} placeholder="222 123 4567" type="tel"
                style={{ width: "100%", padding: "14px 14px", borderRadius: 12, border: "1.5px solid #e5e7eb", fontSize: 16, boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Correo (opcional)</label>
              <input value={correoNuevo} onChange={(e) => setCorreoNuevo(e.target.value)} placeholder="correo@ejemplo.com" type="email"
                style={{ width: "100%", padding: "14px 14px", borderRadius: 12, border: "1.5px solid #e5e7eb", fontSize: 16, boxSizing: "border-box" }} />
            </div>

            {coincidencias.length > 0 && (
              <div style={{ background: "#fffbeb", border: "1.5px solid #fcd34d", borderRadius: 12, padding: 14, marginBottom: 16 }}>
                <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: "#92400e" }}>
                  Ya existe un cliente con estos datos:
                </p>
                {coincidencias.map((c) => (
                  <div key={c.id} style={{ background: "#fff", borderRadius: 10, padding: 12, marginBottom: 8 }}>
                    <p style={{ margin: "0 0 2px", fontSize: 14, fontWeight: 700 }}>{c.nombre}</p>
                    <p style={{ margin: "0 0 10px", fontSize: 12, color: "#9ca3af" }}>
                      Atendido por {c.profiles?.full_name || c.profiles?.email || "otro asesor"} · {fmtFechaHora(c.created_at)}
                    </p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => usarClienteExistente(c)} style={{ flex: 1, background: brand.red, color: "#fff", border: "none", borderRadius: 8, padding: "10px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                        Sí, es él
                      </button>
                      <button onClick={esOtroCliente} style={{ flex: 1, background: "#f3f4f6", border: "none", borderRadius: 8, padding: "10px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                        Es otro
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button onClick={continuarConClienteNuevo} disabled={buscando} style={{ width: "100%", background: brand.red, color: "#fff", border: "none", borderRadius: 14, padding: "16px", fontWeight: 800, fontSize: 16, cursor: "pointer" }}>
              Continuar
            </button>
          </div>
        )}

        {paso === 2 && (
          <div>
            <div style={{ background: "#f9fafb", borderRadius: 10, padding: 12, marginBottom: 16 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{clienteElegido?.nombre || nombreNuevo}</p>
              {(clienteElegido?.telefono || telefonoNuevo) && <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>{clienteElegido?.telefono || telefonoNuevo}</p>}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Fecha y hora de la cita</label>
              <input type="datetime-local" value={fechaHora} onChange={(e) => setFechaHora(e.target.value)}
                style={{ width: "100%", padding: "14px 14px", borderRadius: 12, border: "1.5px solid #e5e7eb", fontSize: 16, boxSizing: "border-box" }} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Propiedad (opcional)</label>
              {propiedadElegida ? (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: 12 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{propiedadElegida.titulo}</p>
                  <button onClick={() => setPropiedadElegida(null)} style={{ background: "none", border: "none", color: "#991b1b", fontWeight: 700, cursor: "pointer" }}>Quitar</button>
                </div>
              ) : (
                <div>
                  <input value={propiedadBusqueda} onChange={(e) => setPropiedadBusqueda(e.target.value)} placeholder="Buscar propiedad…"
                    style={{ width: "100%", padding: "14px 14px", borderRadius: 12, border: "1.5px solid #e5e7eb", fontSize: 16, boxSizing: "border-box" }} />
                  {propiedadesResultado.length > 0 && (
                    <div style={{ marginTop: 8, border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
                      {propiedadesResultado.map((p) => (
                        <button key={p.id} onClick={() => { setPropiedadElegida(p); setPropiedadBusqueda(""); setPropiedadesResultado([]); }}
                          style={{ display: "block", width: "100%", textAlign: "left", padding: 12, background: "#fff", border: "none", borderBottom: "1px solid #f3f4f6", fontSize: 13, cursor: "pointer" }}>
                          {p.titulo}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setPaso(1)} style={{ background: "#f3f4f6", border: "none", borderRadius: 14, padding: "16px 20px", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
                Atrás
              </button>
              <button onClick={guardar} disabled={guardando} style={{ flex: 1, background: brand.red, color: "#fff", border: "none", borderRadius: 14, padding: "16px", fontWeight: 800, fontSize: 16, cursor: guardando ? "not-allowed" : "pointer", opacity: guardando ? 0.6 : 1 }}>
                {guardando ? "Guardando…" : "Agendar cita"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Clientes() {
  const { cargando: permisoCargando, puedeVer, alcance, perfil } = usePermiso("clientes");

  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEtapa, setFiltroEtapa] = useState("");
  const [modalNuevaCita, setModalNuevaCita] = useState(false);
  const [toast, setToast] = useState(null);
  const [proximasCitas, setProximasCitas] = useState([]);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const cargarDatos = async () => {
    setLoading(true);
    let query = supabase.from("clientes").select("*").order("updated_at", { ascending: false });
    if (alcance === "propio" && perfil?.id) query = query.eq("asesor_id", perfil.id);
    const { data } = await query;
    setClientes(data || []);

    // Próximas citas (siguientes 7 días) para el recordatorio en pantalla.
    const ahora = new Date().toISOString();
    const en7dias = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    let queryCitas = supabase
      .from("citas")
      .select("id, fecha_hora, estado, clientes(nombre, telefono), propiedades(titulo)")
      .gte("fecha_hora", ahora)
      .lte("fecha_hora", en7dias)
      .eq("estado", "agendada")
      .order("fecha_hora", { ascending: true });
    if (alcance === "propio" && perfil?.id) queryCitas = queryCitas.eq("asesor_id", perfil.id);
    const { data: citasData } = await queryCitas;
    setProximasCitas(citasData || []);

    setLoading(false);
  };

  useEffect(() => {
    if (!permisoCargando && puedeVer) cargarDatos();
  }, [permisoCargando, puedeVer, alcance]);

  const logout = async () => { await supabase.auth.signOut(); window.location.href = "/"; };

  if (permisoCargando) return null;
  if (!puedeVer) return <SinAcceso />;

  const clientesFiltrados = clientes.filter((c) => {
    if (busqueda) {
      const q = busqueda.toLowerCase();
      if (!c.nombre?.toLowerCase().includes(q) && !c.telefono?.includes(q) && !c.correo?.toLowerCase().includes(q)) return false;
    }
    if (filtroEtapa && c.etapa_interes !== filtroEtapa) return false;
    return true;
  });

  return (
    <Layout view="clientes" profile={perfil} onLogout={logout}>
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000 }}>
          {toast.msg}
        </div>
      )}

      <div style={{ padding: 20, paddingBottom: 100, maxWidth: 760, margin: "0 auto" }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 800, color: brand.gray }}>Clientes</h2>

        {proximasCitas.length > 0 && (
          <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 14, padding: 14, marginBottom: 16 }}>
            <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, color: "#92400e" }}>📅 Próximas citas</p>
            {proximasCitas.slice(0, 5).map((c) => (
              <p key={c.id} style={{ margin: "0 0 4px", fontSize: 13, color: "#78350f" }}>
                {fmtFechaHora(c.fecha_hora)} — <strong>{c.clientes?.nombre}</strong>{c.propiedades?.titulo ? ` (${c.propiedades.titulo})` : ""}
              </p>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar cliente…"
            style={{ flex: 1, minWidth: 180, padding: "12px 14px", borderRadius: 12, border: "1.5px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" }}
          />
          <select value={filtroEtapa} onChange={(e) => setFiltroEtapa(e.target.value)}
            style={{ padding: "12px 10px", borderRadius: 12, border: "1.5px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
            <option value="">Todas las etapas</option>
            {ETAPAS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
        </div>

        {loading ? (
          <p style={{ color: "#9ca3af", textAlign: "center", padding: 30 }}>Cargando…</p>
        ) : clientesFiltrados.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>
            <p style={{ fontSize: 32, margin: "0 0 8px" }}>👥</p>
            <p>No tienes clientes capturados todavía.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {clientesFiltrados.map((c) => {
              const info = etapaInfo(c.etapa_interes);
              return (
                <a key={c.id} href={`/clientes/${c.id}`} style={{ textDecoration: "none" }}>
                  <div style={{ background: "#fff", borderRadius: 14, padding: 16, border: "1px solid #f0f0f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <p style={{ margin: "0 0 2px", fontSize: 15, fontWeight: 700, color: brand.gray }}>{c.nombre}</p>
                      <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>{c.telefono || c.correo || "Sin contacto"}</p>
                    </div>
                    <span style={{ background: info.bg, color: info.color, padding: "4px 12px", borderRadius: 99, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                      {info.label}
                    </span>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>

      <button onClick={() => setModalNuevaCita(true)} style={{
        position: "fixed", bottom: 24, right: 24, background: brand.red, color: "#fff", border: "none",
        borderRadius: 99, padding: "16px 24px", fontWeight: 800, fontSize: 15, cursor: "pointer",
        boxShadow: "0 8px 24px rgba(200,16,46,0.4)", zIndex: 100,
      }}>
        + Nueva cita
      </button>

      {modalNuevaCita && (
        <ModalNuevaCita
          onClose={() => setModalNuevaCita(false)}
          onGuardado={cargarDatos}
          asesorId={perfil?.id}
          showToast={showToast}
        />
      )}
    </Layout>
  );
}
