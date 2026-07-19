import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";
import { PageHeader, brand } from "../components/Layout";
import { usePermiso, SinAcceso } from "../lib/permisos";
import {
  buildPropertyChangeNews,
  buildPropertyCreatedNews,
  buildPropertyStatusNews,
  registerPropertyNews,
} from "../lib/propertyNews";
import JSZip from "jszip";

const fmt = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0 }).format(n || 0);

const STATUS_STYLE = {
  published: { bg: "#d1fae5", color: "#065f46", label: "Publicada" },
  reserved:  { bg: "#fef3c7", color: "#92400e", label: "Reservada" },
  sold:      { bg: "#fee2e2", color: "#991b1b", label: "Vendida" },
  leased:    { bg: "#fee2e2", color: "#991b1b", label: "Rentada" },
  draft:     { bg: "#f3f4f6", color: "#6b7280", label: "Borrador" },
  archived:  { bg: "#e5e7eb", color: "#4b5563", label: "Archivada" },
};

const MOTIVOS_ARCHIVO = [
  "Propietario retiró",
  "Duplicada",
  "Datos incorrectos",
  "Pausada",
  "Fuera de mercado",
  "Otro",
];

const STATUS_COMPARTIBLE = "published";

const TIPOS = ["Casa", "Departamento", "Terreno", "Local comercial", "Oficina", "Edificio", "Bodega"];

const OPCIONES_CREDITO = ["Infonavit", "Fovissste", "Bancario", "Cofinavit", "Contado", "Crédito de la constructora"];
const OPCIONES_AMUEBLADO = ["Amueblado", "Semi-amueblado", "Vacío"];
const OPCIONES_ORIENTACION = ["Norte", "Sur", "Oriente", "Poniente", "Noreste", "Noroeste", "Sureste", "Suroeste"];
const OPCIONES_PROTECCION_JURIDICA = [
  { value: "", label: "Sin definir" },
  { value: "blindaje_legal", label: "Blindaje Legal Emporio" },
  { value: "aval", label: "Aval" },
  { value: "otra_poliza", label: "Otra póliza jurídica" },
];

const OPCIONES_GRAVAMEN = [
  { value: "", label: "Sin definir" },
  { value: "libre", label: "Libre de gravamen" },
  { value: "hipoteca", label: "Con hipoteca" },
];

const PROPIEDAD_VACIA = {
  titulo: "", descripcion: "",
  operacion: "sale", precio: "", moneda: "MXN",
  tipo: "Casa", recamaras: "", banos: "", estacionamientos: "",
  m2_construccion: "", m2_terreno: "",
  direccion: "", colonia: "", ciudad: "Puebla", estado: "Puebla",
  lat: null, lng: null,
  mostrar_ubicacion_exacta: false,
  fotos: [], amenidades: [],
  video_url: "",
  status: "published",
  es_exclusiva: false,

  // Servicios y operación (uso interno del equipo, principalmente)
  mantenimiento_aplica: false, mantenimiento_monto: "",
  servicio_gas: "", servicio_agua: "", servicio_luz: "", internet_disponible: "",
  es_administrada: false, ubicacion_llave: "", cisterna_capacidad: "",

  // Crédito (venta)
  creditos_aceptados: [],

  // Gravamen / hipoteca
  status_gravamen: "", gravamen_institucion: "",

  // Otros
  fecha_disponibilidad: "", mascotas_permitidas: null,
  amueblado: "", antiguedad_anios: "", orientacion: "",
  comision_detalle: "", veridada_url: "",
  proteccion_juridica: "", proteccion_juridica_detalle: "",

  // Redes sociales (para el reporte mensual a propietarios)
  en_marketplace: false, fecha_marketplace: null,
  vistas_tiktok: "", vistas_instagram: "", vistas_facebook: "",

  notas_internas: "",
};

const SwitchToggle = ({ checked, onChange, label, sublabel }) => (
  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", marginBottom: 4 }}>
    <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, cursor: "pointer" }} />
    <span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block" }}>{label}</span>
      {sublabel && <span style={{ fontSize: 11, color: "#9ca3af" }}>{sublabel}</span>}
    </span>
  </label>
);

function MapaPin({ lat, lng, onChange }) {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [cargado, setCargado] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) { setError("Falta configurar NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"); return; }

    if (window.google?.maps) { setCargado(true); return; }

    const existente = document.getElementById("google-maps-script");
    if (existente) {
      existente.addEventListener("load", () => setCargado(true));
      return;
    }

    const script = document.createElement("script");
    script.id = "google-maps-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.onload = () => setCargado(true);
    script.onerror = () => setError("No se pudo cargar Google Maps");
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!cargado || !mapDivRef.current) return;
    const centro = { lat: lat || 19.0414, lng: lng || -98.2063 }; // default: Lomas de Angelópolis, Puebla

    const map = new window.google.maps.Map(mapDivRef.current, {
      center: centro,
      zoom: lat ? 16 : 12,
      mapTypeControl: false,
      streetViewControl: false,
    });
    mapRef.current = map;

    const marker = new window.google.maps.Marker({
      position: centro,
      map,
      draggable: true,
    });
    markerRef.current = marker;

    marker.addListener("dragend", () => {
      const pos = marker.getPosition();
      onChange(pos.lat(), pos.lng());
    });

    map.addListener("click", (e) => {
      marker.setPosition(e.latLng);
      onChange(e.latLng.lat(), e.latLng.lng());
    });
  }, [cargado]);

  if (error) {
    return <div style={{ padding: 14, background: "#fef3c7", borderRadius: 8, fontSize: 12, color: "#92400e" }}>⚠️ {error}. El mapa no está disponible, pero puedes seguir guardando la propiedad sin ubicación exacta.</div>;
  }

  return (
    <div>
      <div ref={mapDivRef} style={{ width: "100%", height: 260, borderRadius: 10, background: "#f3f4f6", marginBottom: 6 }}>
        {!cargado && <div style={{ padding: 20, textAlign: "center", color: "#9ca3af", fontSize: 12 }}>Cargando mapa…</div>}
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>
        {lat ? `📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}` : "Haz click en el mapa para poner el pin en la ubicación exacta."}
      </p>
    </div>
  );
}

const Modal = ({ title, onClose, children, wide }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
    <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: wide ? 720 : 480, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>{title}</h2>
        <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      {children}
    </div>
  </div>
);

const Campo = ({ label, children }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 4 }}>{label}</label>
    {children}
  </div>
);

const Dato = ({ label, value }) => {
  if (value === undefined || value === null || value === "" || value === false) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <p style={{ margin: "0 0 2px", fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</p>
      <p style={{ margin: 0, fontSize: 14, color: "#1a1a2e", fontWeight: 500 }}>{value === true ? "Sí" : value}</p>
    </div>
  );
};

function FichaDetalle({ p, onClose, onEditar, puedeEditar, showToast, asesores }) {
  const [generando, setGenerando] = useState(false);
  const s = STATUS_STYLE[p.status] || STATUS_STYLE.published;
  const fotos = Array.isArray(p.fotos) ? p.fotos : [];
  const amenidades = Array.isArray(p.amenidades) ? p.amenidades : [];
  const creditos = Array.isArray(p.creditos_aceptados) ? p.creditos_aceptados : [];

  const urlPublica = p.public_id ? `https://www.emporioinmobiliario.com.mx/propiedades/${p.public_id}` : "";
  const puedeCompartir = p.status === STATUS_COMPARTIBLE;

  const enviarPorWhatsApp = async () => {
    if (!puedeCompartir) { showToast("Solo las propiedades publicadas pueden enviarse", false); return; }
    if (!urlPublica) { showToast("Esta propiedad no tiene ID público, no se puede compartir la liga", false); return; }
    const mensaje = `¡Hola! Te comparto la información de *${p.titulo || "esta propiedad"}*${p.precio ? ` — ${fmt(p.precio)}` : ""}.\n\n${urlPublica}\n\nEstoy a tus órdenes para cualquier duda. 🏠`;
    window.open(`https://wa.me/?text=${encodeURIComponent(mensaje)}`, "_blank");

    // Registro en segundo plano para el futuro reporte a propietarios.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: envio } = await supabase
        .from("envios")
        .insert({ asesor_id: session?.user?.id || null, medio: "whatsapp" })
        .select()
        .single();
      if (envio) {
        await supabase.from("envios_propiedades").insert({ envio_id: envio.id, propiedad_id: p.id });
      }
    } catch (e) {
      console.error("No se pudo registrar el envío por WhatsApp:", e.message);
    }
  };

  const copiarLigaDetalle = async () => {
    if (!puedeCompartir) { showToast("Solo las propiedades publicadas pueden compartir liga", false); return; }
    if (!urlPublica) { showToast("Esta propiedad no tiene ID público, no se puede copiar la liga", false); return; }
    try {
      await navigator.clipboard.writeText(urlPublica);
      showToast("Liga copiada, pégala en Respond.io");
    } catch (e) {
      showToast("No se pudo copiar automáticamente: " + urlPublica, false);
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: envio } = await supabase
        .from("envios")
        .insert({ asesor_id: session?.user?.id || null, medio: "liga_copiada" })
        .select()
        .single();
      if (envio) {
        await supabase.from("envios_propiedades").insert({ envio_id: envio.id, propiedad_id: p.id });
      }
    } catch (e) {
      console.error("No se pudo registrar la liga copiada:", e.message);
    }
  };

  const [descargandoFotos, setDescargandoFotos] = useState(false);

  const descargarTodasLasFotos = async () => {
    const fotos = Array.isArray(p.fotos) ? p.fotos : [];
    if (fotos.length === 0) { showToast("Esta propiedad no tiene fotos", false); return; }
    setDescargandoFotos(true);
    try {
      const zip = new JSZip();
      let descargadas = 0;
      for (let i = 0; i < fotos.length; i++) {
        const url = fotos[i]?.url || fotos[i];
        if (!url) continue;
        try {
          const resp = await fetch(url);
          if (!resp.ok) continue;
          const blob = await resp.blob();
          const ext = (url.split(".").pop() || "jpg").split("?")[0].slice(0, 4);
          zip.file(`foto_${String(i + 1).padStart(2, "0")}.${ext}`, blob);
          descargadas++;
        } catch {
          // Si una foto individual falla, seguimos con las demás — mejor
          // entregar un ZIP con la mayoría que fallar todo por una sola.
        }
      }
      if (descargadas === 0) throw new Error("No se pudo descargar ninguna foto");

      const contenido = await zip.generateAsync({ type: "blob" });
      const nombreZip = `${p.public_id || "propiedad"}_fotos.zip`;
      const enlace = document.createElement("a");
      enlace.href = URL.createObjectURL(contenido);
      enlace.download = nombreZip;
      enlace.click();
      URL.revokeObjectURL(enlace.href);
      showToast(`${descargadas} foto${descargadas === 1 ? "" : "s"} descargada${descargadas === 1 ? "" : "s"}`);
    } catch (e) {
      showToast("Error al descargar fotos: " + e.message, false);
    }
    setDescargandoFotos(false);
  };

  const descargarPdf = async () => {
    if (!puedeCompartir) { showToast("Solo las propiedades publicadas pueden generar una ficha para prospectos", false); return; }
    setGenerando(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/generar-pdf-propiedad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propiedad_id: p.id, usuario_id: session?.user?.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "No se pudo generar el PDF");
      window.open(data.url, "_blank");
    } catch (e) {
      showToast("Error al generar el PDF: " + e.message, false);
    }
    setGenerando(false);
  };

  return (
    <Modal title="Detalle de la propiedad" onClose={onClose} wide>
      {/* Botones de acción */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20, paddingBottom: 16, borderBottom: "1.5px solid #f3f4f6" }}>
        <button onClick={descargarPdf} disabled={generando || !puedeCompartir} style={{ background: brand.red, color: "#fff", border: "none", borderRadius: 10, padding: "10px 16px", fontWeight: 700, fontSize: 13, cursor: generando || !puedeCompartir ? "not-allowed" : "pointer", opacity: generando || !puedeCompartir ? 0.5 : 1 }}>
          {generando ? "Generando…" : "📄 Generar PDF"}
        </button>
        <button onClick={enviarPorWhatsApp} disabled={!puedeCompartir} style={{ background: "#22c55e", color: "#fff", border: "none", borderRadius: 10, padding: "10px 16px", fontWeight: 700, fontSize: 13, cursor: puedeCompartir ? "pointer" : "not-allowed", opacity: puedeCompartir ? 1 : 0.5 }}>
          💬 Enviar liga por WhatsApp
        </button>
        <button onClick={copiarLigaDetalle} disabled={!puedeCompartir} style={{ background: "#f0fdf4", color: "#065f46", border: "none", borderRadius: 10, padding: "10px 16px", fontWeight: 700, fontSize: 13, cursor: puedeCompartir ? "pointer" : "not-allowed", opacity: puedeCompartir ? 1 : 0.5 }}>
          🔗 Copiar liga
        </button>
        <button onClick={descargarTodasLasFotos} disabled={descargandoFotos} style={{ background: "#eff6ff", color: "#1e40af", border: "none", borderRadius: 10, padding: "10px 16px", fontWeight: 700, fontSize: 13, cursor: descargandoFotos ? "not-allowed" : "pointer", opacity: descargandoFotos ? 0.6 : 1 }}>
          {descargandoFotos ? "Descargando…" : "📸 Descargar fotos"}
        </button>
        {puedeEditar && (
          <button onClick={() => { onClose(); onEditar(p); }} style={{ background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 10, padding: "10px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            ✏️ Editar
          </button>
        )}
      </div>

      {/* Encabezado */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>{p.titulo}</h3>
          <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>📍 {[p.direccion, p.colonia, p.ciudad, p.estado].filter(Boolean).join(", ")}</p>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <span style={{ background: s.bg, color: s.color, padding: "4px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>{s.label}</span>
          {p.es_exclusiva && <span style={{ background: "#1a1a2e", color: "#fff", padding: "4px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>⭐ Exclusiva</span>}
        </div>
      </div>

      <p style={{ margin: "0 0 16px", fontSize: 24, fontWeight: 900, color: brand.red }}>
        {fmt(p.precio)} <span style={{ fontSize: 13, fontWeight: 600, color: "#9ca3af" }}>{p.operacion === "sale" ? "Venta" : "Renta"}</span>
      </p>

      {/* Fotos */}
      {fotos.length > 0 && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 18, paddingBottom: 4 }}>
          {fotos.map((foto, i) => (
            <img key={i} src={foto.url || foto} alt="" style={{ height: 110, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
          ))}
        </div>
      )}

      {/* Datos generales */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 18 }}>
        <Dato label="Tipo" value={p.tipo} />
        <Dato label="Recámaras" value={p.recamaras} />
        <Dato label="Baños" value={p.banos} />
        <Dato label="Estacionamientos" value={p.estacionamientos} />
        <Dato label="m² construcción" value={p.m2_construccion} />
        <Dato label="m² terreno" value={p.m2_terreno} />
        <Dato label="Antigüedad" value={p.antiguedad_anios ? `${p.antiguedad_anios} años` : ""} />
        <Dato label="Amueblado" value={p.amueblado} />
        <Dato label="Orientación" value={p.orientacion} />
      </div>

      {p.descripcion && (
        <div style={{ marginBottom: 18 }}>
          <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase" }}>Descripción</p>
          <p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{p.descripcion}</p>
        </div>
      )}

      {amenidades.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase" }}>Amenidades</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {amenidades.map((a, i) => <span key={i} style={{ background: "#f0fdf4", color: "#065f46", padding: "4px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600 }}>✓ {a}</span>)}
          </div>
        </div>
      )}

      {creditos.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase" }}>Créditos aceptados</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {creditos.map((c, i) => <span key={i} style={{ background: "#eff6ff", color: "#1e40af", padding: "4px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{c}</span>)}
          </div>
        </div>
      )}

      <div style={{ height: 1, background: "#f3f4f6", margin: "16px 0" }} />
      <p style={{ fontSize: 12, fontWeight: 800, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 10px" }}>Información operativa (interna)</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 12 }}>
        <Dato label="¿Administrada por Emporio?" value={p.es_administrada} />
        <Dato label="Mantenimiento aplica" value={p.mantenimiento_aplica ? fmt(p.mantenimiento_monto) : ""} />
        <Dato label="Servicio de gas" value={p.servicio_gas} />
        <Dato label="Servicio de agua" value={p.servicio_agua} />
        <Dato label="Servicio de luz" value={p.servicio_luz} />
        <Dato label="Internet disponible" value={p.internet_disponible} />
        <Dato label="Ubicación de la llave" value={p.ubicacion_llave} />
        <Dato label="Capacidad de cisterna" value={p.cisterna_capacidad} />
        <Dato label="Comisión" value={p.comision_detalle} />
        <Dato label="Protección jurídica" value={OPCIONES_PROTECCION_JURIDICA.find(o => o.value === p.proteccion_juridica)?.label} />
        <Dato label="Status de gravamen" value={OPCIONES_GRAVAMEN.find(o => o.value === p.status_gravamen)?.label} />
        <Dato label="Institución del gravamen" value={p.gravamen_institucion} />
        <Dato label="Fecha de disponibilidad" value={p.fecha_disponibilidad} />
        <Dato label="Mascotas permitidas" value={p.mascotas_permitidas} />
        <Dato label="Motivo del estatus" value={p.status_motivo} />
        <Dato label="Estatus actualizado" value={p.status_actualizado_en ? new Date(p.status_actualizado_en).toLocaleString("es-MX") : ""} />
      </div>

      {p.status === "reserved" && (
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: 12, marginTop: 8 }}>
          <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 800, color: "#92400e", textTransform: "uppercase" }}>Datos internos del apartado</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
            <Dato label="Apartado por" value={p.apartado_por_nombre} />
            <Dato label="Asesor responsable" value={asesores.find(a => a.id === p.apartado_asesor_id)?.full_name || asesores.find(a => a.id === p.apartado_asesor_id)?.email || ""} />
            <Dato label="Fecha" value={p.apartado_fecha ? new Date(p.apartado_fecha).toLocaleDateString("es-MX") : ""} />
            <Dato label="Monto" value={p.apartado_monto ? fmt(p.apartado_monto) : ""} />
            <Dato label="Vigente hasta" value={p.apartado_vigencia_hasta} />
          </div>
          {p.apartado_notas && <p style={{ margin: "8px 0 0", fontSize: 12, color: "#78350f", whiteSpace: "pre-wrap" }}>{p.apartado_notas}</p>}
        </div>
      )}

      {p.notas_internas && (
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: 12, marginTop: 8 }}>
          <p style={{ margin: "0 0 2px", fontSize: 11, fontWeight: 700, color: "#92400e", textTransform: "uppercase" }}>Notas internas</p>
          <p style={{ margin: 0, fontSize: 13, color: "#78350f", whiteSpace: "pre-wrap" }}>{p.notas_internas}</p>
        </div>
      )}

      <p style={{ margin: "20px 0 0", fontSize: 10, color: "#9ca3af", textAlign: "right" }}>ID: {p.public_id}</p>
    </Modal>
  );
}

const inputStyle = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", fontFamily: "system-ui, sans-serif" };

function ModalEnvioCorreo({ propiedades, onClose, showToast }) {
  const [destinatarioNombre, setDestinatarioNombre] = useState("");
  const [destinatarioCorreo, setDestinatarioCorreo] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    if (!destinatarioCorreo || !destinatarioCorreo.includes("@")) {
      showToast("Captura un correo válido del destinatario", false);
      return;
    }
    setEnviando(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/enviar-catalogo-propiedades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propiedad_ids: propiedades.map((p) => p.id),
          usuario_id: session?.user?.id,
          destinatario_nombre: destinatarioNombre,
          destinatario_correo: destinatarioCorreo,
          mensaje,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo enviar el correo");
      showToast(`Correo enviado a ${destinatarioCorreo}`);
      onClose();
    } catch (e) {
      showToast("Error al enviar: " + e.message, false);
    }
    setEnviando(false);
  };

  return (
    <Modal title={`Enviar ${propiedades.length} propiedad${propiedades.length > 1 ? "es" : ""} por correo`} onClose={onClose}>
      <div style={{ marginBottom: 14, maxHeight: 140, overflowY: "auto", background: "#f9fafb", borderRadius: 8, padding: 10 }}>
        {propiedades.map((p) => (
          <p key={p.id} style={{ margin: "0 0 4px", fontSize: 12, color: "#374151" }}>• {p.titulo}</p>
        ))}
      </div>
      <Campo label="Nombre del prospecto">
        <input style={inputStyle} value={destinatarioNombre} onChange={(e) => setDestinatarioNombre(e.target.value)} placeholder="Ej. Juan Pérez" />
      </Campo>
      <Campo label="Correo del prospecto">
        <input style={inputStyle} type="email" value={destinatarioCorreo} onChange={(e) => setDestinatarioCorreo(e.target.value)} placeholder="juan@correo.com" />
      </Campo>
      <Campo label="Mensaje (opcional)">
        <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={mensaje} onChange={(e) => setMensaje(e.target.value)} placeholder="Hola Juan, te comparto estas opciones que pueden interesarte…" />
      </Campo>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
        <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px 20px", fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
        <button onClick={enviar} disabled={enviando} style={{ background: brand.red, color: "#fff", border: "none", borderRadius: 10, padding: "11px 20px", fontWeight: 700, cursor: enviando ? "not-allowed" : "pointer", opacity: enviando ? 0.6 : 1 }}>
          {enviando ? "Enviando…" : "Enviar correo"}
        </button>
      </div>
    </Modal>
  );
}

export default function PropiedadesAdmin() {
  const router = useRouter();
  const { cargando: permisoCargando, puedeVer, puedeEditar } = usePermiso("propiedades-admin");
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [asesores, setAsesores] = useState([]);
  const [authLoading, setAuthLoading] = useState(true);
  const [propiedades, setPropiedades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState("");
  const [filtroOperacion, setFiltroOperacion] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("operativas");
  const [modalForm, setModalForm] = useState(null); // null | "nueva" | objeto propiedad a editar
  const [form, setForm] = useState(PROPIEDAD_VACIA);
  const [saving, setSaving] = useState(false);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [modalEliminar, setModalEliminar] = useState(null);
  const [modalApartado, setModalApartado] = useState(null);
  const [modalArchivar, setModalArchivar] = useState(null);
  const [motivoArchivo, setMotivoArchivo] = useState("");
  const [motivoArchivoOtro, setMotivoArchivoOtro] = useState("");
  const [apartado, setApartado] = useState({
    apartado_por_nombre: "",
    apartado_asesor_id: "",
    apartado_fecha: "",
    apartado_monto: "",
    apartado_vigencia_hasta: "",
    apartado_notas: "",
  });
  const [modalDetalle, setModalDetalle] = useState(null);
  const [seleccionadas, setSeleccionadas] = useState([]);
  const [modalEnvioCorreo, setModalEnvioCorreo] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const propiedadAbiertaDesdeUrl = useRef(null);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const copiarLiga = async (p) => {
    if (p.status !== STATUS_COMPARTIBLE) { showToast("Solo las propiedades publicadas pueden compartir liga", false); return; }
    const url = p.public_id ? `https://www.emporioinmobiliario.com.mx/propiedades/${p.public_id}` : "";
    if (!url) { showToast("Esta propiedad no tiene ID público, no se puede copiar la liga", false); return; }
    try {
      await navigator.clipboard.writeText(url);
      showToast("Liga copiada, pégala en Respond.io");
    } catch (e) {
      showToast("No se pudo copiar automáticamente: " + url, false);
    }

    // Registro en segundo plano para el futuro reporte a propietarios.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: envio } = await supabase
        .from("envios")
        .insert({ asesor_id: session?.user?.id || null, medio: "liga_copiada" })
        .select()
        .single();
      if (envio) {
        await supabase.from("envios_propiedades").insert({ envio_id: envio.id, propiedad_id: p.id });
      }
    } catch (e) {
      console.error("No se pudo registrar la liga copiada:", e.message);
    }
  };

  const enviarSeleccionadasPorWhatsApp = async () => {
    const props = propiedades.filter((p) => seleccionadas.includes(p.id));
    if (props.length === 0) return;
    if (props.some((p) => p.status !== STATUS_COMPARTIBLE)) {
      showToast("La selección contiene propiedades no disponibles", false);
      return;
    }

    const lineas = props.map((p) => {
      const url = p.public_id ? `https://www.emporioinmobiliario.com.mx/propiedades/${p.public_id}` : "";
      return `*${p.titulo}* — ${fmt(p.precio)}\n${url}`;
    });
    const mensaje = `¡Hola! Te comparto estas ${props.length} opciones:\n\n${lineas.join("\n\n")}\n\nEstoy a tus órdenes para cualquier duda. 🏠`;
    window.open(`https://wa.me/?text=${encodeURIComponent(mensaje)}`, "_blank");

    // Registro en segundo plano, sin bloquear ni avisar al asesor — el
    // envío real ya ocurrió al abrir WhatsApp; esto solo alimenta el futuro
    // reporte a propietarios.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: envio } = await supabase
        .from("envios")
        .insert({
          asesor_id: session?.user?.id || null,
          medio: "whatsapp",
        })
        .select()
        .single();
      if (envio) {
        await supabase.from("envios_propiedades").insert(props.map((p) => ({ envio_id: envio.id, propiedad_id: p.id })));
      }
    } catch (e) {
      console.error("No se pudo registrar el envío por WhatsApp:", e.message);
    }

    setSeleccionadas([]);
  };

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

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
    const [{ data }, { data: perfiles }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).single(),
      supabase.from("profiles").select("id, full_name, email, role_id").eq("active", true),
    ]);
    setProfile(data);
    setAsesores((perfiles || []).filter(p => ["asesor", "gerente_ventas", "admin"].includes(p.role_id)));
    setAuthLoading(false);
  };

  const loadPropiedades = async () => {
    setLoading(true);
    const { data } = await supabase.from("propiedades").select("*").order("created_at", { ascending: false });
    setPropiedades(data || []);
    setLoading(false);
  };

  useEffect(() => { if (session) loadPropiedades(); }, [session]);

  useEffect(() => {
    if (!router.isReady || propiedades.length === 0) return;
    const propiedadId = Array.isArray(router.query.propiedad) ? router.query.propiedad[0] : router.query.propiedad;
    if (!propiedadId || propiedadAbiertaDesdeUrl.current === propiedadId) return;
    const propiedad = propiedades.find(p => p.id === propiedadId);
    if (!propiedad) return;
    propiedadAbiertaDesdeUrl.current = propiedadId;
    setModalDetalle(propiedad);
  }, [router.isReady, router.query.propiedad, propiedades]);

  const filtered = propiedades.filter(p => {
    const matchSearch = !search ||
      p.titulo?.toLowerCase().includes(search.toLowerCase()) ||
      p.direccion?.toLowerCase().includes(search.toLowerCase()) ||
      p.colonia?.toLowerCase().includes(search.toLowerCase()) ||
      p.public_id?.toLowerCase().includes(search.toLowerCase());
    const matchOp = !filtroOperacion || p.operacion === filtroOperacion;
    const matchStatus = filtroStatus === "operativas"
      ? p.status !== "archived"
      : !filtroStatus || p.status === filtroStatus;
    return matchSearch && matchOp && matchStatus;
  });

  const abrirNueva = () => { setForm(PROPIEDAD_VACIA); setModalForm("nueva"); };
  const abrirDetalle = (p) => setModalDetalle(p);
  const toggleSeleccion = (id) => {
    setSeleccionadas((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };
  const abrirEditar = (p) => {
    setForm({
      ...PROPIEDAD_VACIA,
      ...p,
      precio: p.precio || "",
      recamaras: p.recamaras || "",
      banos: p.banos || "",
      estacionamientos: p.estacionamientos || "",
      m2_construccion: p.m2_construccion || "",
      m2_terreno: p.m2_terreno || "",
      mantenimiento_monto: p.mantenimiento_monto || "",
      antiguedad_anios: p.antiguedad_anios || "",
      comision_detalle: p.comision_detalle || "",
      veridada_url: p.veridada_url || "",
      fecha_disponibilidad: p.fecha_disponibilidad || "",
      proteccion_juridica: p.proteccion_juridica || "",
      proteccion_juridica_detalle: p.proteccion_juridica_detalle || "",
      fotos: Array.isArray(p.fotos) ? p.fotos : [],
      amenidades: Array.isArray(p.amenidades) ? p.amenidades : [],
      creditos_aceptados: Array.isArray(p.creditos_aceptados) ? p.creditos_aceptados : [],
    });
    setModalForm(p);
  };

  const subirFotos = async (files) => {
    setSubiendoFoto(true);
    const archivos = Array.from(files);
    let subidas = 0;
    let errores = 0;

    for (const file of archivos) {
      try {
        const ext = file.name.split(".").pop();
        const carpeta = form.public_id || `nueva_${Date.now()}`;
        const fileName = `${carpeta}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
        const { error } = await supabase.storage.from("propiedades-fotos").upload(fileName, file, { upsert: true });
        if (error) throw error;
        const { data } = supabase.storage.from("propiedades-fotos").getPublicUrl(fileName);
        setForm(f => ({ ...f, fotos: [...f.fotos, { url: data.publicUrl, orden: f.fotos.length }] }));
        subidas++;
      } catch (e) {
        errores++;
      }
    }

    if (errores === 0) showToast(`${subidas} foto${subidas === 1 ? "" : "s"} agregada${subidas === 1 ? "" : "s"} ✅`);
    else showToast(`${subidas} foto${subidas === 1 ? "" : "s"} agregada${subidas === 1 ? "" : "s"}, ${errores} con error`, errores === archivos.length ? false : true);
    setSubiendoFoto(false);
  };

  const quitarFoto = (idx) => {
    setForm(f => ({ ...f, fotos: f.fotos.filter((_, i) => i !== idx) }));
  };

  const moverFoto = (idx, dir) => {
    setForm(f => {
      const nuevas = [...f.fotos];
      const j = idx + dir;
      if (j < 0 || j >= nuevas.length) return f;
      [nuevas[idx], nuevas[j]] = [nuevas[j], nuevas[idx]];
      return { ...f, fotos: nuevas.map((foto, i) => ({ ...foto, orden: i })) };
    });
  };

  const agregarAmenidad = (texto) => {
    if (!texto.trim()) return;
    setForm(f => ({ ...f, amenidades: [...f.amenidades, texto.trim()] }));
  };
  const quitarAmenidad = (idx) => {
    setForm(f => ({ ...f, amenidades: f.amenidades.filter((_, i) => i !== idx) }));
  };

  const toggleCredito = (opcion) => {
    setForm(f => ({
      ...f,
      creditos_aceptados: f.creditos_aceptados.includes(opcion)
        ? f.creditos_aceptados.filter(c => c !== opcion)
        : [...f.creditos_aceptados, opcion],
    }));
  };

  const guardarPropiedad = async () => {
    if (!form.titulo.trim()) { showToast("Falta el título de la propiedad", false); return; }
    if (!form.precio) { showToast("Falta el precio", false); return; }

    setSaving(true);
    const esNueva = modalForm === "nueva";
    const propiedadAntes = esNueva ? null : modalForm;
    const payload = {
      ...form,
      precio: Number(form.precio) || 0,
      recamaras: Number(form.recamaras) || 0,
      banos: Number(form.banos) || 0,
      estacionamientos: Number(form.estacionamientos) || 0,
      m2_construccion: Number(form.m2_construccion) || 0,
      m2_terreno: Number(form.m2_terreno) || 0,
      mantenimiento_monto: form.mantenimiento_monto ? Number(form.mantenimiento_monto) : null,
      antiguedad_anios: form.antiguedad_anios ? Number(form.antiguedad_anios) : null,
      comision_detalle: form.comision_detalle || null,
      veridada_url: form.veridada_url || null,
      fecha_disponibilidad: form.fecha_disponibilidad || null,
      proteccion_juridica_detalle: (form.proteccion_juridica === "aval" || form.proteccion_juridica === "otra_poliza") ? form.proteccion_juridica_detalle : null,
      unidad_precio: "total",
    };
    delete payload.id;
    delete payload.created_at;
    delete payload.updated_at;

    let error;
    let propiedadGuardada = null;
    if (esNueva) {
      payload.public_id = payload.public_id || `EMP-${Date.now().toString(36).toUpperCase()}`;
      payload.origen = "manual";
      payload.status_motivo = payload.status === "draft" ? "Propiedad creada como borrador" : "Propiedad creada y publicada";
      payload.status_actualizado_en = new Date().toISOString();
      payload.status_actualizado_por = profile?.id || null;
      ({ data: propiedadGuardada, error } = await supabase.from("propiedades").insert(payload).select("*").single());
    } else {
      ({ data: propiedadGuardada, error } = await supabase.from("propiedades").update(payload).eq("id", modalForm.id).select("*").single());
    }
    setSaving(false);
    if (error) { showToast("Error al guardar: " + error.message, false); return; }
    if (propiedadGuardada) {
      const noticias = esNueva
        ? [buildPropertyCreatedNews(propiedadGuardada, profile?.id)]
        : buildPropertyChangeNews(propiedadAntes, propiedadGuardada, profile?.id);
      registerPropertyNews(supabase, noticias);
    }
    showToast(modalForm === "nueva" ? "Propiedad creada ✅" : "Propiedad actualizada ✅");
    setModalForm(null);
    loadPropiedades();
  };

  const auditoriaStatus = (motivo) => ({
    status_motivo: motivo || null,
    status_actualizado_en: new Date().toISOString(),
    status_actualizado_por: profile?.id || null,
  });

  const confirmarEliminar = async () => {
    setSaving(true);
    if (profile?.role_id !== "admin") {
      setSaving(false);
      setModalEliminar(null);
      showToast("Solo Admin puede eliminar propiedades", false);
      return;
    }
    const id = modalEliminar.id;
    const [citas, visitas, contactos, envios] = await Promise.all([
      supabase.from("citas").select("id", { count: "exact", head: true }).eq("propiedad_id", id),
      supabase.from("visitas_propiedad").select("id", { count: "exact", head: true }).eq("propiedad_id", id),
      supabase.from("solicitudes_contacto_propiedad").select("id", { count: "exact", head: true }).eq("propiedad_id", id),
      supabase.from("envios_propiedades").select("propiedad_id", { count: "exact", head: true }).eq("propiedad_id", id),
    ]);
    const historial = (citas.count || 0) + (visitas.count || 0) + (contactos.count || 0) + (envios.count || 0);
    if (historial > 0) {
      setSaving(false);
      setModalEliminar(null);
      showToast(`No se puede eliminar: tiene ${historial} registro${historial === 1 ? "" : "s"} de historial. Archívala.`, false);
      return;
    }
    const { error } = await supabase.from("propiedades").delete().eq("id", id);
    setSaving(false);
    setModalEliminar(null);
    if (error) { showToast("Error al eliminar: " + error.message, false); return; }
    showToast("Propiedad eliminada definitivamente");
    loadPropiedades();
  };

  const cambiarStatus = async (p, nuevoStatus, motivo) => {
    const payload = {
      status: nuevoStatus,
      ...auditoriaStatus(motivo || `Cambio a ${STATUS_STYLE[nuevoStatus]?.label || nuevoStatus}`),
    };
    const { data: propiedadActualizada, error } = await supabase.from("propiedades").update(payload).eq("id", p.id).select("*").single();
    if (error) { showToast("Error al actualizar estatus", false); return; }
    registerPropertyNews(supabase, buildPropertyStatusNews(p, propiedadActualizada, profile?.id, motivo));
    showToast("Estatus actualizado");
    loadPropiedades();
  };

  const abrirApartado = (p) => {
    const ahora = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    setApartado({
      apartado_por_nombre: p.apartado_por_nombre || "",
      apartado_asesor_id: p.apartado_asesor_id || profile?.id || "",
      apartado_fecha: p.apartado_fecha
        ? new Date(p.apartado_fecha).toISOString().slice(0, 16)
        : `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}T${pad(ahora.getHours())}:${pad(ahora.getMinutes())}`,
      apartado_monto: p.apartado_monto || "",
      apartado_vigencia_hasta: p.apartado_vigencia_hasta || "",
      apartado_notas: p.apartado_notas || "",
    });
    setModalApartado(p);
  };

  const guardarApartado = async () => {
    if (!apartado.apartado_por_nombre.trim() || !apartado.apartado_fecha || !apartado.apartado_vigencia_hasta) {
      showToast("Captura prospecto, fecha y vigencia del apartado", false);
      return;
    }
    setSaving(true);
    const { data: propiedadActualizada, error } = await supabase.from("propiedades").update({
      status: "reserved",
      apartado_por_nombre: apartado.apartado_por_nombre.trim(),
      apartado_asesor_id: apartado.apartado_asesor_id || profile?.id || null,
      apartado_fecha: new Date(apartado.apartado_fecha).toISOString(),
      apartado_monto: Number(apartado.apartado_monto) || null,
      apartado_vigencia_hasta: apartado.apartado_vigencia_hasta,
      apartado_notas: apartado.apartado_notas || null,
      ...auditoriaStatus("Propiedad apartada / reservada"),
    }).eq("id", modalApartado.id).select("*").single();
    setSaving(false);
    if (error) { showToast("Error al apartar: " + error.message, false); return; }
    registerPropertyNews(supabase, buildPropertyStatusNews(modalApartado, propiedadActualizada, profile?.id, "Propiedad apartada / reservada"));
    setModalApartado(null);
    showToast("Propiedad reservada");
    setSeleccionadas(prev => prev.filter(id => id !== modalApartado.id));
    loadPropiedades();
  };

  const confirmarArchivo = async () => {
    const motivo = motivoArchivo === "Otro" ? motivoArchivoOtro.trim() : motivoArchivo;
    if (!motivo) { showToast("Selecciona o captura el motivo", false); return; }
    setSaving(true);
    const { data: propiedadActualizada, error } = await supabase.from("propiedades").update({
      status: "archived",
      ...auditoriaStatus(motivo),
    }).eq("id", modalArchivar.id).select("*").single();
    setSaving(false);
    if (error) { showToast("Error al archivar: " + error.message, false); return; }
    registerPropertyNews(supabase, buildPropertyStatusNews(modalArchivar, propiedadActualizada, profile?.id, motivo));
    setSeleccionadas(prev => prev.filter(id => id !== modalArchivar.id));
    setModalArchivar(null);
    setMotivoArchivo("");
    setMotivoArchivoOtro("");
    showToast("Propiedad archivada; historial conservado");
    loadPropiedades();
  };

  if (authLoading || permisoCargando) return null;
  if (!session) { if (typeof window !== "undefined") window.location.href = "/"; return null; }
  if (!puedeVer) return <SinAcceso />;

  return (
    <div style={{ minHeight: "100vh", background: brand.bg, fontFamily: "system-ui, sans-serif" }}>
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", maxWidth: 320 }}>
          {toast.msg}
        </div>
      )}

      <PageHeader
        title="Propiedades"
        icon="🏠"
        actions={
          puedeEditar ? (
            <button onClick={abrirNueva} style={{ background: brand.red, color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
              + Nueva propiedad
            </button>
          ) : (
            <span style={{ fontSize: 13, color: "#9ca3af", fontStyle: "italic" }}>Modo solo lectura</span>
          )
        }
      />

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px" }}>

        {/* Filtros */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
          <input
            placeholder="Buscar por título, dirección o ID…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200, padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13 }}
          />
          <select value={filtroOperacion} onChange={e => setFiltroOperacion(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
            <option value="">Venta y renta</option>
            <option value="sale">Solo venta</option>
            <option value="rental">Solo renta</option>
          </select>
          <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
            <option value="operativas">Operativas (sin archivadas)</option>
            <option value="">Todos los estatus</option>
            <option value="published">Publicada</option>
            <option value="reserved">Reservada</option>
            <option value="sold">Vendida</option>
            <option value="leased">Rentada</option>
            <option value="draft">Borrador</option>
            <option value="archived">Archivadas</option>
          </select>
          <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: "auto" }}>{filtered.length} propiedades</span>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 48, color: "#9ca3af" }}>Cargando propiedades…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: "#9ca3af" }}>
            {propiedades.length === 0 ? (
              <>No tienes propiedades todavía. Agrega tu primera propiedad con el botón "+ Nueva propiedad".</>
            ) : (
              <>No se encontraron propiedades con esos filtros.</>
            )}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {filtered.map(p => {
              const st = STATUS_STYLE[p.status] || STATUS_STYLE.published;
              const foto = Array.isArray(p.fotos) && p.fotos[0]?.url;
              return (
                <div key={p.id} style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", outline: seleccionadas.includes(p.id) ? `2px solid ${brand.red}` : "none" }}>
                  <div style={{ height: 150, background: "#f3f4f6", position: "relative" }}>
                    <label title={p.status === STATUS_COMPARTIBLE ? "Seleccionar para enviar" : "No disponible para envío"} style={{ position: "absolute", top: 8, left: 8, zIndex: 2, background: "#fff", borderRadius: 6, width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.25)", cursor: p.status === STATUS_COMPARTIBLE ? "pointer" : "not-allowed", opacity: p.status === STATUS_COMPARTIBLE ? 1 : 0.55 }}>
                      <input type="checkbox" disabled={p.status !== STATUS_COMPARTIBLE} checked={seleccionadas.includes(p.id)} onChange={() => toggleSeleccion(p.id)} style={{ width: 16, height: 16, cursor: p.status === STATUS_COMPARTIBLE ? "pointer" : "not-allowed" }} />
                    </label>
                    {foto ? (
                      <img src={foto} alt={p.titulo} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>🏠</div>
                    )}
                    <span style={{ position: "absolute", top: 8, left: 38, background: p.operacion === "sale" ? "#1a1a2e" : brand.red, color: "#fff", padding: "3px 10px", borderRadius: 99, fontSize: 10, fontWeight: 800 }}>
                      {p.operacion === "sale" ? "VENTA" : "RENTA"}
                    </span>
                    <span style={{ position: "absolute", top: 8, right: 8, background: st.bg, color: st.color, padding: "3px 10px", borderRadius: 99, fontSize: 10, fontWeight: 700 }}>
                      {st.label}
                    </span>
                  </div>
                  <div style={{ padding: 14 }}>
                    <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700, color: "#1a1a2e", lineHeight: 1.3 }}>{p.titulo}</p>
                    <p style={{ margin: "0 0 8px", fontSize: 12, color: "#6b7280" }}>📍 {[p.colonia, p.ciudad].filter(Boolean).join(", ")}</p>
                    <p style={{ margin: "0 0 10px", fontSize: 18, fontWeight: 900, color: brand.red }}>{fmt(p.precio)}</p>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12, fontSize: 11, color: "#374151" }}>
                      {p.recamaras > 0 && <span>🛏 {p.recamaras}</span>}
                      {p.banos > 0 && <span>🚿 {p.banos}</span>}
                      {p.m2_construccion > 0 && <span>📐 {p.m2_construccion} m²</span>}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => abrirDetalle(p)} style={{ flex: 1, background: "#eff6ff", border: "none", borderRadius: 8, padding: "8px", fontWeight: 700, fontSize: 12, cursor: "pointer", color: "#1e40af" }}>
                        👁️ Ver detalle
                      </button>
                      <button onClick={() => copiarLiga(p)} disabled={p.status !== STATUS_COMPARTIBLE} title={p.status === STATUS_COMPARTIBLE ? "Copiar liga para pegar en Respond.io" : "Solo las publicadas se pueden compartir"} style={{ background: "#f0fdf4", border: "none", borderRadius: 8, padding: "8px 10px", fontWeight: 700, fontSize: 12, cursor: p.status === STATUS_COMPARTIBLE ? "pointer" : "not-allowed", color: "#065f46", opacity: p.status === STATUS_COMPARTIBLE ? 1 : 0.45 }}>
                        🔗
                      </button>
                      {puedeEditar && (
                        <button onClick={() => abrirEditar(p)} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "8px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer", color: "#374151" }}>
                          ✏️ Editar
                        </button>
                      )}
                    </div>
                    {puedeEditar && (
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", paddingTop: 9, marginTop: 9, borderTop: "1px solid #f3f4f6" }}>
                        {p.status !== "published" && <button onClick={() => cambiarStatus(p, "published", "Propiedad publicada")} style={{ background: "#d1fae5", color: "#065f46", border: "none", borderRadius: 7, padding: "6px 8px", fontSize: 10, fontWeight: 800, cursor: "pointer" }}>Publicar</button>}
                        {p.status !== "reserved" && <button onClick={() => abrirApartado(p)} style={{ background: "#fef3c7", color: "#92400e", border: "none", borderRadius: 7, padding: "6px 8px", fontSize: 10, fontWeight: 800, cursor: "pointer" }}>Apartar</button>}
                        {p.status !== "leased" && <button onClick={() => cambiarStatus(p, "leased", "Operación cerrada: propiedad rentada")} style={{ background: "#fee2e2", color: "#991b1b", border: "none", borderRadius: 7, padding: "6px 8px", fontSize: 10, fontWeight: 800, cursor: "pointer" }}>Rentada</button>}
                        {p.status !== "sold" && <button onClick={() => cambiarStatus(p, "sold", "Operación cerrada: propiedad vendida")} style={{ background: "#fee2e2", color: "#991b1b", border: "none", borderRadius: 7, padding: "6px 8px", fontSize: 10, fontWeight: 800, cursor: "pointer" }}>Vendida</button>}
                        {p.status !== "archived" && <button onClick={() => { setModalArchivar(p); setMotivoArchivo(""); setMotivoArchivoOtro(""); }} style={{ background: "#e5e7eb", color: "#4b5563", border: "none", borderRadius: 7, padding: "6px 8px", fontSize: 10, fontWeight: 800, cursor: "pointer" }}>Archivar</button>}
                        {profile?.role_id === "admin" && <button onClick={() => setModalEliminar(p)} style={{ background: "#fff", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 7, padding: "5px 8px", fontSize: 10, fontWeight: 800, cursor: "pointer" }}>Eliminar</button>}
                      </div>
                    )}
                    <p style={{ margin: "8px 0 0", fontSize: 10, color: "#9ca3af" }}>ID: {p.public_id}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {seleccionadas.length > 0 && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 500, display: "flex", gap: 8, alignItems: "center", background: "#1a1a2e", borderRadius: 99, padding: "10px 10px 10px 18px", boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
          <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{seleccionadas.length} propiedad{seleccionadas.length > 1 ? "es" : ""} seleccionada{seleccionadas.length > 1 ? "s" : ""}</span>
          <button onClick={() => setModalEnvioCorreo(true)} style={{ background: brand.red, color: "#fff", border: "none", borderRadius: 99, padding: "9px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            ✉️ Enviar por correo
          </button>
          <button onClick={enviarSeleccionadasPorWhatsApp} style={{ background: "#22c55e", color: "#fff", border: "none", borderRadius: 99, padding: "9px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            💬 Enviar ligas por WhatsApp
          </button>
          <button onClick={() => setSeleccionadas([])} style={{ background: "transparent", color: "#9ca3af", border: "none", borderRadius: 99, padding: "9px 12px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
            Cancelar
          </button>
        </div>
      )}

      {modalDetalle && (
        <FichaDetalle
          p={modalDetalle}
          onClose={() => setModalDetalle(null)}
          onEditar={abrirEditar}
          puedeEditar={puedeEditar}
          showToast={showToast}
          asesores={asesores}
        />
      )}

      {modalEnvioCorreo && (
        <ModalEnvioCorreo
          propiedades={propiedades.filter((p) => seleccionadas.includes(p.id))}
          onClose={() => { setModalEnvioCorreo(false); setSeleccionadas([]); }}
          showToast={showToast}
        />
      )}

      {modalArchivar && (
        <Modal title="Archivar propiedad" onClose={() => setModalArchivar(null)}>
          <p style={{ fontSize: 14, color: "#374151", lineHeight: 1.6 }}>
            “{modalArchivar.titulo}” dejará de tratarse como disponible. Se conservarán la propiedad y todo su historial.
          </p>
          <Campo label="Motivo">
            <select style={inputStyle} value={motivoArchivo} onChange={e => setMotivoArchivo(e.target.value)}>
              <option value="">Selecciona un motivo</option>
              {MOTIVOS_ARCHIVO.map(motivo => <option key={motivo} value={motivo}>{motivo}</option>)}
            </select>
          </Campo>
          {motivoArchivo === "Otro" && <Campo label="Especifica el motivo"><input style={inputStyle} value={motivoArchivoOtro} onChange={e => setMotivoArchivoOtro(e.target.value)} /></Campo>}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button onClick={() => setModalArchivar(null)} style={{ flex: 1, background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px", fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
            <button onClick={confirmarArchivo} disabled={saving} style={{ flex: 1, background: "#4b5563", color: "#fff", border: "none", borderRadius: 10, padding: "11px", fontWeight: 700, cursor: "pointer" }}>
              {saving ? "Archivando…" : "Sí, archivar"}
            </button>
          </div>
        </Modal>
      )}

      {modalApartado && (
        <Modal title="Apartar / reservar propiedad" onClose={() => setModalApartado(null)}>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "#6b7280" }}>Estos datos son internos y no se mostrarán en reportes al propietario.</p>
          <Campo label="Prospecto *"><input style={inputStyle} value={apartado.apartado_por_nombre} onChange={e => setApartado(a => ({ ...a, apartado_por_nombre: e.target.value }))} /></Campo>
          <Campo label="Asesor responsable">
            <select style={inputStyle} value={apartado.apartado_asesor_id} onChange={e => setApartado(a => ({ ...a, apartado_asesor_id: e.target.value }))}>
              <option value="">Sin asignar</option>
              {asesores.map(asesor => <option key={asesor.id} value={asesor.id}>{asesor.full_name || asesor.email}</option>)}
            </select>
          </Campo>
          <Campo label="Fecha del apartado *"><input type="datetime-local" style={inputStyle} value={apartado.apartado_fecha} onChange={e => setApartado(a => ({ ...a, apartado_fecha: e.target.value }))} /></Campo>
          <Campo label="Monto"><input type="number" min="0" style={inputStyle} value={apartado.apartado_monto} onChange={e => setApartado(a => ({ ...a, apartado_monto: e.target.value }))} /></Campo>
          <Campo label="Vigencia hasta *"><input type="date" style={inputStyle} value={apartado.apartado_vigencia_hasta} onChange={e => setApartado(a => ({ ...a, apartado_vigencia_hasta: e.target.value }))} /></Campo>
          <Campo label="Notas internas"><textarea style={{ ...inputStyle, minHeight: 80 }} value={apartado.apartado_notas} onChange={e => setApartado(a => ({ ...a, apartado_notas: e.target.value }))} /></Campo>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button onClick={() => setModalApartado(null)} style={{ flex: 1, background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px", fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
            <button onClick={guardarApartado} disabled={saving} style={{ flex: 1, background: "#92400e", color: "#fff", border: "none", borderRadius: 10, padding: "11px", fontWeight: 700, cursor: "pointer" }}>{saving ? "Guardando…" : "Confirmar apartado"}</button>
          </div>
        </Modal>
      )}

      {modalEliminar && (
        <Modal title="Eliminar propiedad definitivamente" onClose={() => setModalEliminar(null)}>
          <p style={{ fontSize: 14, color: "#991b1b", lineHeight: 1.6 }}>
            Esta acción es únicamente para errores de captura. Se bloqueará si “{modalEliminar.titulo}” tiene citas, visitas, contactos o envíos registrados.
          </p>
          <p style={{ fontSize: 13, color: "#6b7280" }}>Si tiene historial, usa <strong>Archivar</strong> para conservarlo.</p>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button onClick={() => setModalEliminar(null)} style={{ flex: 1, background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px", fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
            <button onClick={confirmarEliminar} disabled={saving} style={{ flex: 1, background: "#b91c1c", color: "#fff", border: "none", borderRadius: 10, padding: "11px", fontWeight: 700, cursor: "pointer" }}>{saving ? "Validando…" : "Eliminar definitivamente"}</button>
          </div>
        </Modal>
      )}

      {modalForm && (
        <Modal title={puedeEditar ? (modalForm === "nueva" ? "Nueva propiedad" : "Editar propiedad") : "Detalle de la propiedad (solo lectura)"} onClose={() => setModalForm(null)} wide>
          <fieldset disabled={!puedeEditar} style={{ border: "none", margin: 0, padding: 0 }}>

          <Campo label="Título *">
            <input style={inputStyle} value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Casa en privada, Lomas de Angelópolis" />
          </Campo>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Campo label="Operación">
              <select style={inputStyle} value={form.operacion} onChange={e => setForm(f => ({ ...f, operacion: e.target.value }))}>
                <option value="sale">Venta</option>
                <option value="rental">Renta</option>
              </select>
            </Campo>
            <Campo label="Tipo de propiedad">
              <select style={inputStyle} value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Campo>
          </div>

          <Campo label="Precio total *">
            <input type="number" style={inputStyle} value={form.precio} onChange={e => setForm(f => ({ ...f, precio: e.target.value }))} placeholder="2500000" />
          </Campo>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
            <Campo label="Recámaras">
              <input type="number" style={inputStyle} value={form.recamaras} onChange={e => setForm(f => ({ ...f, recamaras: e.target.value }))} />
            </Campo>
            <Campo label="Baños">
              <input type="number" step="0.5" style={inputStyle} value={form.banos} onChange={e => setForm(f => ({ ...f, banos: e.target.value }))} />
            </Campo>
            <Campo label="Estac.">
              <input type="number" style={inputStyle} value={form.estacionamientos} onChange={e => setForm(f => ({ ...f, estacionamientos: e.target.value }))} />
            </Campo>
            <Campo label="m² constr.">
              <input type="number" style={inputStyle} value={form.m2_construccion} onChange={e => setForm(f => ({ ...f, m2_construccion: e.target.value }))} />
            </Campo>
          </div>

          <Campo label="m² terreno (opcional)">
            <input type="number" style={inputStyle} value={form.m2_terreno} onChange={e => setForm(f => ({ ...f, m2_terreno: e.target.value }))} />
          </Campo>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Campo label="Dirección / Calle">
              <input style={inputStyle} value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))} />
            </Campo>
            <Campo label="Colonia / Fraccionamiento">
              <input style={inputStyle} value={form.colonia} onChange={e => setForm(f => ({ ...f, colonia: e.target.value }))} />
            </Campo>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Campo label="Ciudad">
              <input style={inputStyle} value={form.ciudad} onChange={e => setForm(f => ({ ...f, ciudad: e.target.value }))} />
            </Campo>
            <Campo label="Estado">
              <input style={inputStyle} value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))} />
            </Campo>
          </div>

          <Campo label="Ubicación exacta (para el equipo y para citas)">
            <MapaPin lat={form.lat} lng={form.lng} onChange={(lat, lng) => setForm(f => ({ ...f, lat, lng }))} />
          </Campo>
          <div style={{ marginBottom: 14 }}>
            <SwitchToggle
              checked={form.mostrar_ubicacion_exacta}
              onChange={v => setForm(f => ({ ...f, mostrar_ubicacion_exacta: v }))}
              label="Mostrar esta ubicación exacta al público en el sitio web"
              sublabel="Si lo apagas, en el sitio solo se muestra la zona/colonia aproximada, no el pin exacto."
            />
          </div>

          <Campo label="Descripción">
            <textarea style={{ ...inputStyle, minHeight: 90, resize: "vertical" }} value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
          </Campo>

          <Campo label="Link de video (TikTok / YouTube / Reel)">
            <input style={inputStyle} value={form.video_url} onChange={e => setForm(f => ({ ...f, video_url: e.target.value }))} placeholder="https://www.tiktok.com/@emporioinmobiliario/video/..." />
          </Campo>

          {modalForm === "nueva" ? (
            <Campo label="Estatus inicial">
              <select style={inputStyle} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="published">Publicada</option>
                <option value="draft">Borrador (todavía incompleta)</option>
              </select>
            </Campo>
          ) : (
            <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 9, padding: 12, marginBottom: 14 }}>
              <p style={{ margin: "0 0 3px", fontSize: 12, fontWeight: 800, color: "#374151" }}>Estatus: {STATUS_STYLE[form.status]?.label || form.status}</p>
              <p style={{ margin: 0, fontSize: 11, color: "#6b7280" }}>Para cambiarlo usa las acciones de la tarjeta: Publicar, Apartar, Rentada, Vendida o Archivar.</p>
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <SwitchToggle
              checked={form.es_exclusiva}
              onChange={v => setForm(f => ({ ...f, es_exclusiva: v }))}
              label="Propiedad exclusiva"
              sublabel="Marca esta opción si Emporio tiene la exclusiva de venta/renta de este inmueble."
            />
          </div>

          <div style={{ height: 1, background: "#e5e7eb", margin: "20px 0" }} />
          <p style={{ fontSize: 13, fontWeight: 800, color: "#1a1a2e", margin: "0 0 12px" }}>📱 Redes sociales (para el reporte a propietarios)</p>

          <div style={{ marginBottom: 14 }}>
            <SwitchToggle
              checked={form.en_marketplace}
              onChange={v => setForm(f => ({ ...f, en_marketplace: v, fecha_marketplace: v ? (f.fecha_marketplace || new Date().toISOString()) : f.fecha_marketplace }))}
              label="Publicada en Facebook Marketplace"
              sublabel="Se registra la fecha automáticamente la primera vez que se marca."
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Campo label="Vistas en TikTok">
              <input style={inputStyle} type="number" min="0" value={form.vistas_tiktok} onChange={e => setForm(f => ({ ...f, vistas_tiktok: e.target.value }))} placeholder="0" />
            </Campo>
            <Campo label="Vistas en Instagram">
              <input style={inputStyle} type="number" min="0" value={form.vistas_instagram} onChange={e => setForm(f => ({ ...f, vistas_instagram: e.target.value }))} placeholder="0" />
            </Campo>
            <Campo label="Vistas en Facebook">
              <input style={inputStyle} type="number" min="0" value={form.vistas_facebook} onChange={e => setForm(f => ({ ...f, vistas_facebook: e.target.value }))} placeholder="0" />
            </Campo>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af" }}>Actualiza estos números cuando quieras — no es necesario capturarlos a diario.</p>

          <div style={{ height: 1, background: "#e5e7eb", margin: "20px 0" }} />
          <p style={{ fontSize: 13, fontWeight: 800, color: "#1a1a2e", margin: "0 0 12px" }}>🔧 Servicios y datos de operación</p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Campo label="Gas">
              <input style={inputStyle} value={form.servicio_gas} onChange={e => setForm(f => ({ ...f, servicio_gas: e.target.value }))} placeholder="Estacionario / Natural" />
            </Campo>
            <Campo label="Agua">
              <input style={inputStyle} value={form.servicio_agua} onChange={e => setForm(f => ({ ...f, servicio_agua: e.target.value }))} placeholder="Medidor propio / Incluida" />
            </Campo>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Campo label="Luz">
              <input style={inputStyle} value={form.servicio_luz} onChange={e => setForm(f => ({ ...f, servicio_luz: e.target.value }))} placeholder="Medidor propio / Compartido" />
            </Campo>
            <Campo label="Internet disponible">
              <input style={inputStyle} value={form.internet_disponible} onChange={e => setForm(f => ({ ...f, internet_disponible: e.target.value }))} placeholder="Totalplay, Izzi…" />
            </Campo>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Campo label="Capacidad de cisterna (opcional)">
              <input style={inputStyle} value={form.cisterna_capacidad} onChange={e => setForm(f => ({ ...f, cisterna_capacidad: e.target.value }))} placeholder="10,000 litros" />
            </Campo>
            <Campo label="Ubicación de la llave (interno)">
              <input style={inputStyle} value={form.ubicacion_llave} onChange={e => setForm(f => ({ ...f, ubicacion_llave: e.target.value }))} placeholder="Con el portero / Oficina Emporio" />
            </Campo>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
            <SwitchToggle
              checked={form.mantenimiento_aplica}
              onChange={v => setForm(f => ({ ...f, mantenimiento_aplica: v }))}
              label="Aplica cuota de mantenimiento"
            />
            {form.mantenimiento_aplica && (
              <input type="number" style={{ ...inputStyle, width: 140 }} value={form.mantenimiento_monto} onChange={e => setForm(f => ({ ...f, mantenimiento_monto: e.target.value }))} placeholder="$ monto" />
            )}
          </div>

          <div style={{ marginBottom: 14 }}>
            <SwitchToggle
              checked={form.es_administrada}
              onChange={v => setForm(f => ({ ...f, es_administrada: v }))}
              label="Es un inmueble en administración de Emporio"
            />
          </div>

          <div style={{ height: 1, background: "#e5e7eb", margin: "20px 0" }} />
          <p style={{ fontSize: 13, fontWeight: 800, color: "#1a1a2e", margin: "0 0 12px" }}>🏷️ Otros datos</p>

          <Campo label="Status de gravamen / hipoteca">
            <select style={inputStyle} value={form.status_gravamen} onChange={e => setForm(f => ({ ...f, status_gravamen: e.target.value }))}>
              {OPCIONES_GRAVAMEN.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Campo>

          {form.status_gravamen === "hipoteca" && (
            <Campo label="¿Con qué institución o persona?">
              <input style={inputStyle} value={form.gravamen_institucion} onChange={e => setForm(f => ({ ...f, gravamen_institucion: e.target.value }))} placeholder="Ej. BBVA, Infonavit, persona física…" />
            </Campo>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <Campo label="Amueblado">
              <select style={inputStyle} value={form.amueblado} onChange={e => setForm(f => ({ ...f, amueblado: e.target.value }))}>
                <option value="">Sin especificar</option>
                {OPCIONES_AMUEBLADO.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </Campo>
            <Campo label="Orientación">
              <select style={inputStyle} value={form.orientacion} onChange={e => setForm(f => ({ ...f, orientacion: e.target.value }))}>
                <option value="">Sin especificar</option>
                {OPCIONES_ORIENTACION.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </Campo>
            <Campo label="Antigüedad (años)">
              <input type="number" style={inputStyle} value={form.antiguedad_anios} onChange={e => setForm(f => ({ ...f, antiguedad_anios: e.target.value }))} />
            </Campo>
          </div>

          {form.operacion === "rental" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Campo label="Mascotas permitidas">
                  <select style={inputStyle} value={form.mascotas_permitidas === null ? "" : String(form.mascotas_permitidas)} onChange={e => setForm(f => ({ ...f, mascotas_permitidas: e.target.value === "" ? null : e.target.value === "true" }))}>
                    <option value="">Sin especificar</option>
                    <option value="true">Sí</option>
                    <option value="false">No</option>
                  </select>
                </Campo>
                <Campo label="Disponible a partir de">
                  <input type="date" style={inputStyle} value={form.fecha_disponibilidad} onChange={e => setForm(f => ({ ...f, fecha_disponibilidad: e.target.value }))} />
                </Campo>
              </div>

              <Campo label="Protección jurídica del contrato">
                <select style={inputStyle} value={form.proteccion_juridica} onChange={e => setForm(f => ({ ...f, proteccion_juridica: e.target.value }))}>
                  {OPCIONES_PROTECCION_JURIDICA.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af" }}>
                  Lo normal es Blindaje Legal Emporio (la paga el inquilino). Usa Aval u Otra póliza solo cuando el propietario lo pidió así.
                </p>
              </Campo>

              {(form.proteccion_juridica === "aval" || form.proteccion_juridica === "otra_poliza") && (
                <Campo label={form.proteccion_juridica === "aval" ? "Detalle del aval (nombre, parentesco, etc.)" : "Detalle de la póliza (compañía, número, etc.)"}>
                  <input style={inputStyle} value={form.proteccion_juridica_detalle} onChange={e => setForm(f => ({ ...f, proteccion_juridica_detalle: e.target.value }))} />
                </Campo>
              )}
            </>
          )}

          {form.operacion === "sale" && (
            <>
              <Campo label="Tipo de crédito que acepta">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {OPCIONES_CREDITO.map(opcion => (
                    <label key={opcion} style={{ display: "flex", alignItems: "center", gap: 6, background: form.creditos_aceptados.includes(opcion) ? brand.redLight : "#f9fafb", border: `1px solid ${form.creditos_aceptados.includes(opcion) ? brand.red : "#e5e7eb"}`, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, color: form.creditos_aceptados.includes(opcion) ? brand.red : "#6b7280", cursor: "pointer" }}>
                      <input type="checkbox" checked={form.creditos_aceptados.includes(opcion)} onChange={() => toggleCredito(opcion)} style={{ margin: 0 }} />
                      {opcion}
                    </label>
                  ))}
                </div>
              </Campo>

              <Campo label="Link de sello Veridada (si esta propiedad está verificada)">
                <input style={inputStyle} value={form.veridada_url} onChange={e => setForm(f => ({ ...f, veridada_url: e.target.value }))} placeholder="https://veridada.mx/sello/..." />
                <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af" }}>Si lo llenas, en el sitio aparecerá un sello de "Propiedad verificada" con este link.</p>
              </Campo>
            </>
          )}

          <Campo label="Comisión pactada (interno, nunca se muestra al público)">
            <input style={inputStyle} value={form.comision_detalle} onChange={e => setForm(f => ({ ...f, comision_detalle: e.target.value }))} placeholder={form.operacion === "rental" ? "Ej. 1 mes de renta" : "Ej. 5% sobre el total"} />
          </Campo>

          {/* Fotos */}
          <Campo label={`Fotos (${form.fotos.length})`}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              {form.fotos.map((foto, idx) => (
                <div key={idx} style={{ position: "relative", width: 84, height: 64 }}>
                  <img src={foto.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8, border: "1px solid #e5e7eb" }} />
                  <button onClick={() => quitarFoto(idx)} style={{ position: "absolute", top: -6, right: -6, background: "#991b1b", color: "#fff", border: "none", borderRadius: "50%", width: 20, height: 20, fontSize: 11, cursor: "pointer", lineHeight: 1 }}>✕</button>
                  <div style={{ position: "absolute", bottom: -6, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 2 }}>
                    <button onClick={() => moverFoto(idx, -1)} disabled={idx === 0} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 4, fontSize: 9, width: 16, height: 16, cursor: idx === 0 ? "default" : "pointer", opacity: idx === 0 ? 0.4 : 1 }}>←</button>
                    <button onClick={() => moverFoto(idx, 1)} disabled={idx === form.fotos.length - 1} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 4, fontSize: 9, width: 16, height: 16, cursor: idx === form.fotos.length - 1 ? "default" : "pointer", opacity: idx === form.fotos.length - 1 ? 0.4 : 1 }}>→</button>
                  </div>
                </div>
              ))}
            </div>
            <label style={{ display: "inline-block", background: subiendoFoto ? "#f3f4f6" : brand.redLight, color: brand.red, padding: "8px 16px", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: subiendoFoto ? "default" : "pointer" }}>
              {subiendoFoto ? "Subiendo…" : "+ Agregar fotos"}
              <input type="file" accept="image/*" multiple disabled={subiendoFoto} onChange={e => e.target.files.length > 0 && subirFotos(e.target.files)} style={{ display: "none" }} />
            </label>
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "#9ca3af" }}>La primera foto es la que se usa como portada en el listado. Puedes seleccionar varias a la vez.</p>
          </Campo>

          {/* Amenidades */}
          <Campo label="Amenidades">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {form.amenidades.map((a, idx) => (
                <span key={idx} style={{ background: "#f0fdf4", color: "#065f46", padding: "4px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                  {a}
                  <button onClick={() => quitarAmenidad(idx)} style={{ background: "none", border: "none", color: "#065f46", cursor: "pointer", fontSize: 11, padding: 0 }}>✕</button>
                </span>
              ))}
            </div>
            <input
              style={inputStyle}
              placeholder="Escribe una amenidad y presiona Enter (ej. Alberca)"
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  agregarAmenidad(e.target.value);
                  e.target.value = "";
                }
              }}
            />
          </Campo>

          <Campo label="Notas internas (no se muestran en el sitio)">
            <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={form.notas_internas || ""} onChange={e => setForm(f => ({ ...f, notas_internas: e.target.value }))} placeholder="Ej. propietario pide discreción, llaves con el portero, etc." />
          </Campo>

          </fieldset>

          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button onClick={() => setModalForm(null)} style={{ flex: 1, background: "#f3f4f6", border: "none", borderRadius: 10, padding: "11px", fontWeight: 700, cursor: "pointer" }}>
              {puedeEditar ? "Cancelar" : "Cerrar"}
            </button>
            {puedeEditar && (
              <button onClick={guardarPropiedad} disabled={saving} style={{ flex: 1, background: brand.red, color: "#fff", border: "none", borderRadius: 10, padding: "11px", fontWeight: 700, cursor: "pointer" }}>
                {saving ? "Guardando…" : "Guardar propiedad"}
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
