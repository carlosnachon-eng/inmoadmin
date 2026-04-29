import { useState } from "react";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

export default function PropiedadDetalle({ propiedad }) {
  const [fotoActual, setFotoActual] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [contacto, setContacto] = useState({ nombre: "", telefono: "", email: "", mensaje: "" });

  if (!propiedad) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: 48 }}>🔍</p>
        <h2>Propiedad no encontrada</h2>
        <a href="/propiedades" style={{ color: "#c8a96e" }}>← Ver todas las propiedades</a>
      </div>
    </div>
  );

  const op = propiedad.operations?.[0];
  const precio = op?.amount || 0;
  const fotos = Array.isArray(propiedad.property_images) ? propiedad.property_images : [];
  const amenidades = Array.isArray(propiedad.amenities) ? propiedad.amenities : [];
  const imagenPrincipal = fotos[fotoActual]?.url || propiedad.title_image_full || "";

  const handleContacto = async () => {
    setEnviando(true);
    try {
      await fetch("/api/contacto-propiedad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...contacto, propiedad_id: propiedad.public_id, propiedad_titulo: propiedad.title }),
      });
      setEnviado(true);
    } catch (e) { console.error(e); }
    setEnviando(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", fontFamily: "system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#1a1a2e", padding: "16px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p style={{ margin: 0, fontSize: 11, color: "#c8a96e", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Emporio Inmobiliario</p>
        <a href="/propiedades" style={{ color: "#c8a96e", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>← Volver a propiedades</a>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24 }}>

          {/* Columna izquierda */}
          <div>
            {/* Foto principal */}
            <div style={{ borderRadius: 16, overflow: "hidden", marginBottom: 12, background: "#e5e7eb", height: 420 }}>
              {imagenPrincipal ? (
                <img src={imagenPrincipal} alt={propiedad.title || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 60 }}>🏠</div>
              )}
            </div>

            {/* Miniaturas */}
            {fotos.length > 1 && (
              <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 20, paddingBottom: 4 }}>
                {fotos.slice(0, 10).map((foto, i) => (
                  <div key={i} onClick={() => setFotoActual(i)} style={{ width: 80, height: 60, borderRadius: 8, overflow: "hidden", flexShrink: 0, cursor: "pointer", border: fotoActual === i ? "2px solid #c8a96e" : "2px solid transparent" }}>
                    <img src={foto.url || ""} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                ))}
              </div>
            )}

            {/* Info principal */}
            <div style={{ background: "#fff", borderRadius: 16, padding: "24px 28px", marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div style={{ flex: 1, marginRight: 16 }}>
                  <h1 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 800, color: "#1a1a2e", lineHeight: 1.3 }}>{propiedad.title || ""}</h1>
                  <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>📍 {typeof propiedad.location === "string" ? propiedad.location : ""}</p>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <p style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#c8a96e" }}>{fmt(precio)}</p>
                  <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{op?.currency || "MXN"} / {op?.unit === "total" ? "total" : "mes"}</p>
                </div>
              </div>

              {/* Características */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "16px 0", borderTop: "1px solid #f3f4f6", borderBottom: "1px solid #f3f4f6", marginBottom: 20 }}>
                {propiedad.property_type && <span style={{ background: "#f3f4f6", color: "#374151", padding: "6px 14px", borderRadius: 99, fontSize: 13, fontWeight: 600 }}>{propiedad.property_type}</span>}
                {propiedad.bedrooms > 0 && <span style={{ background: "#f3f4f6", color: "#374151", padding: "6px 14px", borderRadius: 99, fontSize: 13 }}>🛏 {propiedad.bedrooms} rec</span>}
                {propiedad.bathrooms > 0 && <span style={{ background: "#f3f4f6", color: "#374151", padding: "6px 14px", borderRadius: 99, fontSize: 13 }}>🚿 {propiedad.bathrooms} baños</span>}
                {propiedad.parking_spaces > 0 && <span style={{ background: "#f3f4f6", color: "#374151", padding: "6px 14px", borderRadius: 99, fontSize: 13 }}>🚗 {propiedad.parking_spaces} est</span>}
                {propiedad.construction_size > 0 && <span style={{ background: "#f3f4f6", color: "#374151", padding: "6px 14px", borderRadius: 99, fontSize: 13 }}>📐 {propiedad.construction_size} m²</span>}
                {propiedad.lot_size > 0 && <span style={{ background: "#f3f4f6", color: "#374151", padding: "6px 14px", borderRadius: 99, fontSize: 13 }}>🌳 {propiedad.lot_size} m² terreno</span>}
              </div>

              {propiedad.description && (
                <div>
                  <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#1a1a2e" }}>Descripción</h3>
                  <p style={{ margin: 0, fontSize: 14, color: "#374151", lineHeight: 1.7, whiteSpace: "pre-line" }}>
                    {typeof propiedad.description === "string" ? propiedad.description : ""}
                  </p>
                </div>
              )}
            </div>

            {/* Amenidades */}
            {amenidades.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 16, padding: "24px 28px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Amenidades</h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {amenidades.map((a, i) => (
                    <span key={i} style={{ background: "#f0fdf4", color: "#065f46", padding: "4px 12px", borderRadius: 99, fontSize: 13, fontWeight: 600 }}>
                      ✓ {typeof a === "string" ? a : a.name || ""}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Columna derecha — Contacto */}
          <div>
            <div style={{ background: "#fff", borderRadius: 16, padding: "24px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", position: "sticky", top: 20 }}>
              <h3 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 800, color: "#1a1a2e" }}>¿Te interesa esta propiedad?</h3>
              <p style={{ margin: "0 0 20px", fontSize: 13, color: "#6b7280" }}>Déjanos tus datos y te contactamos</p>

              {enviado ? (
                <div style={{ background: "#f0fdf4", borderRadius: 12, padding: 24, textAlign: "center" }}>
                  <p style={{ fontSize: 40, margin: "0 0 8px" }}>✅</p>
                  <p style={{ margin: 0, fontWeight: 700, color: "#065f46" }}>¡Recibimos tu mensaje!</p>
                  <p style={{ margin: "8px 0 0", fontSize: 13, color: "#6b7280" }}>Te contactaremos muy pronto</p>
                </div>
              ) : (
                <>
                  {[
                    { label: "Nombre completo", key: "nombre", type: "text", placeholder: "Tu nombre" },
                    { label: "Teléfono", key: "telefono", type: "tel", placeholder: "2221234567" },
                    { label: "Email", key: "email", type: "email", placeholder: "tu@email.com" },
                  ].map(f => (
                    <div key={f.key} style={{ marginBottom: 14 }}>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 4 }}>{f.label}</label>
                      <input type={f.type} placeholder={f.placeholder} value={contacto[f.key]} onChange={e => setContacto(c => ({ ...c, [f.key]: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" }} />
                    </div>
                  ))}
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 4 }}>Mensaje</label>
                    <textarea placeholder={`Hola, me interesa la propiedad ${propiedad.public_id || ""}...`} value={contacto.mensaje} onChange={e => setContacto(c => ({ ...c, mensaje: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", minHeight: 80, resize: "vertical" }} />
                  </div>
                  <button onClick={handleContacto} disabled={enviando || !contacto.nombre || !contacto.telefono} style={{ width: "100%", background: "#c8a96e", color: "#fff", border: "none", borderRadius: 10, padding: "13px", fontWeight: 800, fontSize: 15, cursor: enviando ? "not-allowed" : "pointer", opacity: enviando ? 0.7 : 1, marginBottom: 12 }}>
                    {enviando ? "Enviando..." : "📩 Enviar mensaje"}
                  </button>
                  <a href={`https://wa.me/522222573237?text=Hola, me interesa la propiedad ${propiedad.public_id || ""} - ${propiedad.title || ""}`} target="_blank" rel="noreferrer" style={{ display: "block", width: "100%", background: "#25d366", color: "#fff", border: "none", borderRadius: 10, padding: "13px", fontWeight: 800, fontSize: 15, cursor: "pointer", textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}>
                    💬 WhatsApp
                  </a>
                </>
              )}

              <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #f3f4f6", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>ID: {propiedad.public_id || ""}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export async function getServerSideProps({ params }) {
  try {
    const res = await fetch(`https://api.easybroker.com/v1/properties/${params.id}`, {
      headers: {
        "X-Authorization": process.env.EASYBROKER_API_KEY,
        "accept": "application/json",
      },
    });
    const data = await res.json();
    if (!data || data.error) return { props: { propiedad: null } };
    return { props: { propiedad: data } };
  } catch (e) {
    return { props: { propiedad: null } };
  }
}
