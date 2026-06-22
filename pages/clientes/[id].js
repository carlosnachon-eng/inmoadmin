import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../lib/supabase";
import Layout, { brand } from "../../components/Layout";
import { usePermiso, SinAcceso } from "../../lib/permisos";

const ETAPAS = [
  { value: "nuevo", label: "Nuevo", color: "#6b7280", bg: "#f3f4f6" },
  { value: "en_seguimiento", label: "En seguimiento", color: "#1e40af", bg: "#dbeafe" },
  { value: "caliente", label: "Caliente", color: "#991b1b", bg: "#fee2e2" },
  { value: "frio", label: "Frío", color: "#0369a1", bg: "#e0f2fe" },
  { value: "cerrado", label: "Cerrado", color: "#065f46", bg: "#d1fae5" },
  { value: "perdido", label: "Perdido", color: "#78716c", bg: "#f5f5f4" },
];

const ESTADOS_CITA = {
  agendada: { label: "Agendada", color: "#92400e", bg: "#fef3c7" },
  efectiva: { label: "Efectiva", color: "#1e40af", bg: "#dbeafe" },
  calificada: { label: "Calificada", color: "#065f46", bg: "#d1fae5" },
  cancelada: { label: "Cancelada", color: "#991b1b", bg: "#fee2e2" },
  no_show: { label: "No se presentó", color: "#78716c", bg: "#f5f5f4" },
};

const fmtFecha = (d) => new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
const fmtFechaHora = (d) => new Date(d).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const fmt = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0 }).format(n || 0);

// ── Modal: elegir propiedades y enviarlas a este cliente ───────────────────
function ModalEnviarPropiedades({ cliente, onClose, showToast, asesorId }) {
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [seleccionadas, setSeleccionadas] = useState([]);
  const [medio, setMedio] = useState(null); // 'correo' | 'whatsapp'
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const buscar = async () => {
      if (!busqueda || busqueda.length < 3) { setResultados([]); return; }
      const { data } = await supabase
        .from("propiedades")
        .select("id, titulo, precio, public_id, operacion")
        .or(`titulo.ilike.%${busqueda}%,direccion.ilike.%${busqueda}%`)
        .limit(8);
      setResultados(data || []);
    };
    const t = setTimeout(buscar, 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  const toggleSeleccion = (p) => {
    setSeleccionadas((prev) => prev.find((x) => x.id === p.id) ? prev.filter((x) => x.id !== p.id) : [...prev, p]);
  };

  const enviarPorCorreo = async () => {
    if (!cliente.correo) { showToast("Este cliente no tiene correo registrado", false); return; }
    setEnviando(true);
    try {
      const res = await fetch("/api/enviar-catalogo-propiedades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propiedad_ids: seleccionadas.map((p) => p.id),
          usuario_id: asesorId,
          destinatario_nombre: cliente.nombre,
          destinatario_correo: cliente.correo,
          cliente_id: cliente.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo enviar el correo");
      showToast(`Correo enviado a ${cliente.correo}`);
      onClose();
    } catch (e) {
      showToast("Error al enviar: " + e.message, false);
    }
    setEnviando(false);
  };

  const enviarPorWhatsApp = async () => {
    if (!cliente.telefono) { showToast("Este cliente no tiene teléfono registrado", false); return; }
    const lineas = seleccionadas.map((p) => {
      const url = p.public_id ? `https://www.emporioinmobiliario.com.mx/propiedades/${p.public_id}` : "";
      return `*${p.titulo}* — ${fmt(p.precio)}\n${url}`;
    });
    const mensaje = `¡Hola ${cliente.nombre}! Te comparto estas opciones:\n\n${lineas.join("\n\n")}\n\nEstoy a tus órdenes para cualquier duda. 🏠`;
    window.open(`https://wa.me/?text=${encodeURIComponent(mensaje)}`, "_blank");

    try {
      const { data: envio } = await supabase.from("envios").insert({ asesor_id: asesorId, medio: "whatsapp", destinatario_nombre: cliente.nombre }).select().single();
      if (envio) await supabase.from("envios_propiedades").insert(seleccionadas.map((p) => ({ envio_id: envio.id, propiedad_id: p.id })));
      await supabase.from("seguimientos_cliente").insert({
        cliente_id: cliente.id,
        asesor_id: asesorId,
        nota: `Se envió por WhatsApp: ${seleccionadas.map((p) => p.titulo).join(", ")}`,
        tipo: "envio_whatsapp",
      });
    } catch (e) { /* el envío real ya ocurrió; no bloqueamos por un fallo de registro */ }

    showToast("Liga(s) lista(s) para enviar por WhatsApp");
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 2000 }}>
      <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: 20, width: "100%", maxWidth: 480, maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: brand.gray }}>Enviar propiedades a {cliente.nombre}</h2>
          <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: "pointer" }}>✕</button>
        </div>

        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar propiedad por título o dirección…"
          style={{ width: "100%", padding: "14px 14px", borderRadius: 12, border: "1.5px solid #e5e7eb", fontSize: 16, boxSizing: "border-box", marginBottom: 10 }}
        />

        {resultados.length > 0 && (
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
            {resultados.map((p) => {
              const elegida = seleccionadas.find((x) => x.id === p.id);
              return (
                <button key={p.id} onClick={() => toggleSeleccion(p)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", textAlign: "left", padding: 12, background: elegida ? "#fff5f5" : "#fff", border: "none", borderBottom: "1px solid #f3f4f6", fontSize: 13, cursor: "pointer" }}>
                  <span>{p.titulo}</span>
                  {elegida && <span style={{ color: brand.red, fontWeight: 800 }}>✓</span>}
                </button>
              );
            })}
          </div>
        )}

        {seleccionadas.length > 0 && (
          <div style={{ background: "#f9fafb", borderRadius: 10, padding: 12, marginBottom: 16 }}>
            <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700, color: "#6b7280" }}>{seleccionadas.length} seleccionada{seleccionadas.length > 1 ? "s" : ""}</p>
            {seleccionadas.map((p) => (
              <p key={p.id} style={{ margin: "0 0 2px", fontSize: 12 }}>• {p.titulo}</p>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={enviarPorWhatsApp} disabled={seleccionadas.length === 0} style={{ flex: 1, background: "#22c55e", color: "#fff", border: "none", borderRadius: 14, padding: "14px", fontWeight: 800, fontSize: 14, cursor: seleccionadas.length === 0 ? "not-allowed" : "pointer", opacity: seleccionadas.length === 0 ? 0.5 : 1 }}>
            💬 WhatsApp
          </button>
          <button onClick={enviarPorCorreo} disabled={seleccionadas.length === 0 || enviando} style={{ flex: 1, background: brand.red, color: "#fff", border: "none", borderRadius: 14, padding: "14px", fontWeight: 800, fontSize: 14, cursor: (seleccionadas.length === 0 || enviando) ? "not-allowed" : "pointer", opacity: (seleccionadas.length === 0 || enviando) ? 0.5 : 1 }}>
            {enviando ? "Enviando…" : "✉️ Correo"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FichaCliente() {
  const router = useRouter();
  const { id } = router.query;
  const { cargando: permisoCargando, puedeVer, perfil } = usePermiso("clientes");

  const [cliente, setCliente] = useState(null);
  const [seguimientos, setSeguimientos] = useState([]);
  const [citas, setCitas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [nuevaNota, setNuevaNota] = useState("");
  const [guardandoNota, setGuardandoNota] = useState(false);
  const [modalEnviar, setModalEnviar] = useState(false);
  const [citaEditando, setCitaEditando] = useState(null);
  const [edFechaHora, setEdFechaHora] = useState("");
  const [edPropiedadBusqueda, setEdPropiedadBusqueda] = useState("");
  const [edPropiedadesResultado, setEdPropiedadesResultado] = useState([]);
  const [edPropiedadElegida, setEdPropiedadElegida] = useState(null);
  const [guardandoCita, setGuardandoCita] = useState(false);
  const [confirmarBorrarCita, setConfirmarBorrarCita] = useState(null);
  const [toast, setToast] = useState(null);
  const [editando, setEditando] = useState(false);
  const [edNombre, setEdNombre] = useState("");
  const [edTelefono, setEdTelefono] = useState("");
  const [edCorreo, setEdCorreo] = useState("");
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);
  const [borrando, setBorrando] = useState(false);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const cargarDatos = async () => {
    if (!id) return;
    setLoading(true);
    const [clienteRes, seguimientosRes, citasRes] = await Promise.all([
      supabase.from("clientes").select("*").eq("id", id).single(),
      supabase.from("seguimientos_cliente").select("*, profiles:asesor_id(full_name, email)").eq("cliente_id", id).order("created_at", { ascending: false }),
      supabase.from("citas").select("*, propiedades(titulo)").eq("cliente_id", id).order("fecha_hora", { ascending: false }),
    ]);
    setCliente(clienteRes.data);
    setSeguimientos(seguimientosRes.data || []);
    setCitas(citasRes.data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (!permisoCargando && puedeVer && id) cargarDatos();
  }, [permisoCargando, puedeVer, id]);

  const logout = async () => { await supabase.auth.signOut(); window.location.href = "/"; };

  const cambiarEtapa = async (etapa) => {
    await supabase.from("clientes").update({ etapa_interes: etapa }).eq("id", id);
    setCliente((c) => ({ ...c, etapa_interes: etapa }));
    showToast("Etapa actualizada");
  };

  const abrirEdicion = () => {
    setEdNombre(cliente.nombre || "");
    setEdTelefono(cliente.telefono || "");
    setEdCorreo(cliente.correo || "");
    setEditando(true);
  };

  const guardarEdicion = async () => {
    if (!edNombre.trim()) { showToast("El nombre no puede quedar vacío", false); return; }
    setGuardandoEdicion(true);
    const { error } = await supabase
      .from("clientes")
      .update({ nombre: edNombre.trim(), telefono: edTelefono.trim() || null, correo: edCorreo.trim() || null })
      .eq("id", id);
    setGuardandoEdicion(false);
    if (error) { showToast("Error al guardar: " + error.message, false); return; }
    setCliente((c) => ({ ...c, nombre: edNombre.trim(), telefono: edTelefono.trim() || null, correo: edCorreo.trim() || null }));
    setEditando(false);
    showToast("Datos actualizados");
  };

  const borrarCliente = async () => {
    setBorrando(true);
    // Las citas y seguimientos quedan huérfanos si no se borran primero
    // (no hay "on delete cascade" en citas hacia clientes, deliberadamente,
    // para no perder el historial de citas sin querer); las borramos en
    // orden antes de borrar el cliente.
    await supabase.from("citas").delete().eq("cliente_id", id);
    await supabase.from("seguimientos_cliente").delete().eq("cliente_id", id);
    const { error } = await supabase.from("clientes").delete().eq("id", id);
    setBorrando(false);
    if (error) { showToast("Error al borrar: " + error.message, false); return; }
    router.push("/clientes");
  };

  const cambiarEstadoCita = async (citaId, estado) => {
    await supabase.from("citas").update({ estado }).eq("id", citaId);
    setCitas((prev) => prev.map((c) => c.id === citaId ? { ...c, estado } : c));
  };

  // Convierte un timestamp ISO a formato datetime-local (sin zona) para
  // precargar el input de edición con la fecha/hora actual de la cita.
  const aDatetimeLocal = (iso) => {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const abrirEdicionCita = (cita) => {
    setCitaEditando(cita);
    setEdFechaHora(aDatetimeLocal(cita.fecha_hora));
    setEdPropiedadElegida(cita.propiedades ? { id: cita.propiedad_id, titulo: cita.propiedades.titulo } : null);
    setEdPropiedadBusqueda("");
    setEdPropiedadesResultado([]);
  };

  useEffect(() => {
    const buscar = async () => {
      if (!edPropiedadBusqueda || edPropiedadBusqueda.length < 3) { setEdPropiedadesResultado([]); return; }
      const { data } = await supabase
        .from("propiedades")
        .select("id, titulo")
        .or(`titulo.ilike.%${edPropiedadBusqueda}%,direccion.ilike.%${edPropiedadBusqueda}%`)
        .limit(6);
      setEdPropiedadesResultado(data || []);
    };
    const t = setTimeout(buscar, 350);
    return () => clearTimeout(t);
  }, [edPropiedadBusqueda]);

  const guardarEdicionCita = async () => {
    if (!edFechaHora) { showToast("Captura la fecha y hora", false); return; }
    setGuardandoCita(true);
    const { error } = await supabase
      .from("citas")
      .update({ fecha_hora: new Date(edFechaHora).toISOString(), propiedad_id: edPropiedadElegida?.id || null })
      .eq("id", citaEditando.id);
    setGuardandoCita(false);
    if (error) { showToast("Error al guardar: " + error.message, false); return; }
    setCitaEditando(null);
    showToast("Cita actualizada");
    cargarDatos();
  };

  const borrarCita = async (citaId) => {
    const { error } = await supabase.from("citas").delete().eq("id", citaId);
    setConfirmarBorrarCita(null);
    if (error) { showToast("Error al borrar la cita: " + error.message, false); return; }
    setCitas((prev) => prev.filter((c) => c.id !== citaId));
    showToast("Cita borrada");
  };

  const agregarSeguimiento = async () => {
    if (!nuevaNota.trim()) return;
    setGuardandoNota(true);
    const { error } = await supabase.from("seguimientos_cliente").insert({
      cliente_id: id,
      asesor_id: perfil?.id,
      nota: nuevaNota.trim(),
      tipo: "manual",
    });
    if (!error) {
      setNuevaNota("");
      cargarDatos();
    } else {
      showToast("Error al guardar la nota: " + error.message, false);
    }
    setGuardandoNota(false);
  };

  if (permisoCargando || loading) return null;
  if (!puedeVer) return <SinAcceso />;
  if (!cliente) return (
    <Layout view="clientes" profile={perfil} onLogout={logout}>
      <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Cliente no encontrado.</div>
    </Layout>
  );

  const etapaActual = ETAPAS.find((e) => e.value === cliente.etapa_interes) || ETAPAS[0];

  return (
    <Layout view="clientes" profile={perfil} onLogout={logout}>
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000 }}>
          {toast.msg}
        </div>
      )}

      <div style={{ padding: 20, paddingBottom: 100, maxWidth: 700, margin: "0 auto" }}>
        <a href="/clientes" style={{ fontSize: 13, color: "#9ca3af", textDecoration: "none" }}>← Volver a clientes</a>

        <div style={{ background: "#fff", borderRadius: 16, padding: 20, marginTop: 12, marginBottom: 16, border: "1px solid #f0f0f0" }}>
          {editando ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 10 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>Nombre</label>
                <input value={edNombre} onChange={(e) => setEdNombre(e.target.value)}
                  style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 15, boxSizing: "border-box" }} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>Teléfono</label>
                <input value={edTelefono} onChange={(e) => setEdTelefono(e.target.value)} type="tel"
                  style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 15, boxSizing: "border-box" }} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>Correo</label>
                <input value={edCorreo} onChange={(e) => setEdCorreo(e.target.value)} type="email"
                  style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 15, boxSizing: "border-box" }} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setEditando(false)} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                  Cancelar
                </button>
                <button onClick={guardarEdicion} disabled={guardandoEdicion} style={{ flex: 1, background: brand.red, color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 700, fontSize: 13, cursor: guardandoEdicion ? "not-allowed" : "pointer", opacity: guardandoEdicion ? 0.6 : 1 }}>
                  {guardandoEdicion ? "Guardando…" : "Guardar"}
                </button>
              </div>
              <button onClick={() => setConfirmarBorrar(true)} style={{ width: "100%", background: "none", border: "none", color: "#991b1b", fontSize: 12, fontWeight: 600, cursor: "pointer", marginTop: 12, textDecoration: "underline" }}>
                🗑️ Borrar este cliente
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 800, color: brand.gray }}>{cliente.nombre}</h2>
                <p style={{ margin: 0, fontSize: 13, color: "#9ca3af" }}>{cliente.telefono || "Sin teléfono"} {cliente.correo ? `· ${cliente.correo}` : ""}</p>
              </div>
              <button onClick={abrirEdicion} title="Editar datos" style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "8px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", color: "#374151", flexShrink: 0 }}>
                ✏️ Editar
              </button>
            </div>
          )}

          <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase" }}>Etapa de interés</p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {ETAPAS.map((e) => (
              <button key={e.value} onClick={() => cambiarEtapa(e.value)} style={{
                background: e.value === cliente.etapa_interes ? e.color : e.bg,
                color: e.value === cliente.etapa_interes ? "#fff" : e.color,
                border: "none", borderRadius: 99, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}>
                {e.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          <button onClick={() => setModalEnviar(true)} style={{ flex: 1, background: brand.red, color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
            📤 Enviar propiedades
          </button>
        </div>

        {/* Citas */}
        <div style={{ background: "#fff", borderRadius: 16, padding: 18, marginBottom: 16, border: "1px solid #f0f0f0" }}>
          <p style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 800, color: brand.gray }}>Citas</p>
          {citas.length === 0 ? (
            <p style={{ color: "#9ca3af", fontSize: 13 }}>Sin citas registradas.</p>
          ) : citas.map((c) => {
            const info = ESTADOS_CITA[c.estado] || ESTADOS_CITA.agendada;
            return (
              <div key={c.id} style={{ padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{fmtFechaHora(c.fecha_hora)}</p>
                  <span style={{ background: info.bg, color: info.color, padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>{info.label}</span>
                </div>
                {c.propiedades?.titulo && <p style={{ margin: "0 0 8px", fontSize: 12, color: "#6b7280" }}>{c.propiedades.titulo}</p>}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {["agendada", "efectiva", "calificada", "no_show", "cancelada"].map((estado) => (
                    <button key={estado} onClick={() => cambiarEstadoCita(c.id, estado)} disabled={c.estado === estado} style={{
                      background: c.estado === estado ? "#e5e7eb" : "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 600,
                      cursor: c.estado === estado ? "default" : "pointer", color: c.estado === estado ? "#9ca3af" : "#374151",
                    }}>
                      {ESTADOS_CITA[estado].label}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <button onClick={() => abrirEdicionCita(c)} style={{ background: "none", border: "none", color: "#1e40af", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>
                    ✏️ Editar fecha/propiedad
                  </button>
                  <button onClick={() => setConfirmarBorrarCita(c.id)} style={{ background: "none", border: "none", color: "#991b1b", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>
                    🗑️ Borrar
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bitácora de seguimientos */}
        <div style={{ background: "#fff", borderRadius: 16, padding: 18, border: "1px solid #f0f0f0" }}>
          <p style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 800, color: brand.gray }}>Seguimiento</p>

          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input
              value={nuevaNota}
              onChange={(e) => setNuevaNota(e.target.value)}
              placeholder="Agregar nota rápida…"
              onKeyDown={(e) => e.key === "Enter" && agregarSeguimiento()}
              style={{ flex: 1, padding: "12px 14px", borderRadius: 12, border: "1.5px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" }}
            />
            <button onClick={agregarSeguimiento} disabled={guardandoNota || !nuevaNota.trim()} style={{ background: brand.red, color: "#fff", border: "none", borderRadius: 12, padding: "0 18px", fontWeight: 700, cursor: "pointer" }}>
              Guardar
            </button>
          </div>

          {seguimientos.length === 0 ? (
            <p style={{ color: "#9ca3af", fontSize: 13 }}>Sin seguimientos registrados todavía.</p>
          ) : seguimientos.map((s) => (
            <div key={s.id} style={{ padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
              <p style={{ margin: "0 0 2px", fontSize: 13, color: "#374151" }}>{s.nota}</p>
              <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>
                {s.profiles?.full_name || s.profiles?.email || "—"} · {fmtFecha(s.created_at)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {modalEnviar && (
        <ModalEnviarPropiedades
          cliente={cliente}
          onClose={() => { setModalEnviar(false); cargarDatos(); }}
          showToast={showToast}
          asesorId={perfil?.id}
        />
      )}

      {citaEditando && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 2500 }}>
          <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: 20, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: brand.gray }}>Editar cita</h2>
              <button onClick={() => setCitaEditando(null)} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: "pointer" }}>✕</button>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Fecha y hora</label>
              <input type="datetime-local" value={edFechaHora} onChange={(e) => setEdFechaHora(e.target.value)}
                style={{ width: "100%", padding: "14px 14px", borderRadius: 12, border: "1.5px solid #e5e7eb", fontSize: 16, boxSizing: "border-box" }} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Propiedad (opcional)</label>
              {edPropiedadElegida ? (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: 12 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{edPropiedadElegida.titulo}</p>
                  <button onClick={() => setEdPropiedadElegida(null)} style={{ background: "none", border: "none", color: "#991b1b", fontWeight: 700, cursor: "pointer" }}>Quitar</button>
                </div>
              ) : (
                <div>
                  <input value={edPropiedadBusqueda} onChange={(e) => setEdPropiedadBusqueda(e.target.value)} placeholder="Buscar propiedad…"
                    style={{ width: "100%", padding: "14px 14px", borderRadius: 12, border: "1.5px solid #e5e7eb", fontSize: 16, boxSizing: "border-box" }} />
                  {edPropiedadesResultado.length > 0 && (
                    <div style={{ marginTop: 8, border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
                      {edPropiedadesResultado.map((p) => (
                        <button key={p.id} onClick={() => { setEdPropiedadElegida(p); setEdPropiedadBusqueda(""); setEdPropiedadesResultado([]); }}
                          style={{ display: "block", width: "100%", textAlign: "left", padding: 12, background: "#fff", border: "none", borderBottom: "1px solid #f3f4f6", fontSize: 13, cursor: "pointer" }}>
                          {p.titulo}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <button onClick={guardarEdicionCita} disabled={guardandoCita} style={{ width: "100%", background: brand.red, color: "#fff", border: "none", borderRadius: 14, padding: "16px", fontWeight: 800, fontSize: 16, cursor: guardandoCita ? "not-allowed" : "pointer", opacity: guardandoCita ? 0.6 : 1 }}>
              {guardandoCita ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </div>
      )}

      {confirmarBorrarCita && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2600, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 380 }}>
            <p style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: brand.gray }}>¿Borrar esta cita?</p>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#6b7280" }}>Esta acción no se puede deshacer.</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmarBorrarCita(null)} style={{ flex: 1, background: "#f3f4f6", border: "none", borderRadius: 10, padding: "12px", fontWeight: 700, cursor: "pointer" }}>
                Cancelar
              </button>
              <button onClick={() => borrarCita(confirmarBorrarCita)} style={{ flex: 1, background: "#991b1b", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontWeight: 700, cursor: "pointer" }}>
                Sí, borrar
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmarBorrar && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2500, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 380 }}>
            <p style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: brand.gray }}>¿Borrar a {cliente.nombre}?</p>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#6b7280" }}>
              Esto también borrará todas sus citas y notas de seguimiento. Esta acción no se puede deshacer.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmarBorrar(false)} style={{ flex: 1, background: "#f3f4f6", border: "none", borderRadius: 10, padding: "12px", fontWeight: 700, cursor: "pointer" }}>
                Cancelar
              </button>
              <button onClick={borrarCliente} disabled={borrando} style={{ flex: 1, background: "#991b1b", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontWeight: 700, cursor: borrando ? "not-allowed" : "pointer", opacity: borrando ? 0.6 : 1 }}>
                {borrando ? "Borrando…" : "Sí, borrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
