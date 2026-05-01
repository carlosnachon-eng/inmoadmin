import { useState, useEffect, useCallback } from "react";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

const STATUS_BADGE = {
  published: { label: "Publicado",  bg: "#dcfce7", color: "#166534", dot: "#22c55e" },
  reserved:  { label: "Reservado",  bg: "#fef9c3", color: "#854d0e", dot: "#eab308" },
  leased:    { label: "Rentado",    bg: "#fee2e2", color: "#991b1b", dot: "#ef4444" },
  sold:      { label: "Vendido",    bg: "#fee2e2", color: "#991b1b", dot: "#ef4444" },
  draft:     { label: "Borrador",   bg: "#f3f4f6", color: "#6b7280", dot: "#9ca3af" },
};

function StatusBadge({ status }) {
  const s = STATUS_BADGE[status] || STATUS_BADGE.published;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: s.bg, color: s.color, padding: "4px 12px", borderRadius: 99, fontSize: 12, fontWeight: 700 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.dot }} />
      {s.label}
    </span>
  );
}

function Lightbox({ fotos, index, onClose, onPrev, onNext }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onPrev, onNext]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <button onClick={onClose} style={{ position: "absolute", top: 20, right: 24, background: "rgba(255,255,255,0.12)", border: "none", color: "#fff", fontSize: 22, width: 44, height: 44, borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>✕</button>
      <div style={{ position: "absolute", top: 24, left: "50%", transform: "translateX(-50%)", background: "rgba(255,255,255,0.12)", color: "#fff", padding: "4px 16px", borderRadius: 99, fontSize: 13, fontWeight: 600 }}>
        {index + 1} / {fotos.length}
      </div>
      {fotos.length > 1 && (
        <button onClick={e => { e.stopPropagation(); onPrev(); }} style={{ position: "absolute", left: 20, background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 26, width: 52, height: 52, borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
      )}
      <img src={fotos[index]?.url || ""} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth: "85vw", maxHeight: "85vh", objectFit: "contain", borderRadius: 8, boxShadow: "0 8px 40px rgba(0,0,0,0.6)" }} />
      {fotos.length > 1 && (
        <button onClick={e => { e.stopPropagation(); onNext(); }} style={{ position: "absolute", right: 20, background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 26, width: 52, height: 52, borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
      )}
      {fotos.length > 1 && (
        <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6, maxWidth: "90vw", overflowX: "auto", padding: "4px 8px" }}>
          {fotos.map((f, i) => (
            <div key={i} onClick={e => e.stopPropagation()} style={{ width: 52, height: 38, borderRadius: 6, overflow: "hidden", flexShrink: 0, cursor: "pointer", border: i === index ? "2px solid #C8102E" : "2px solid rgba(255,255,255,0.2)", opacity: i === index ? 1 : 0.55, transition: "opacity 0.15s, border 0.15s" }}>
              <img src={f.url || ""} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Galeria({ fotos, titulo }) {
  const [actual, setActual] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const prev = useCallback(() => setActual(i => (i - 1 + fotos.length) % fotos.length), [fotos.length]);
  const next = useCallback(() => setActual(i => (i + 1) % fotos.length), [fotos.length]);
  const imagenPrincipal = fotos[actual]?.url || "";

  return (
    <>
      {lightbox && <Lightbox fotos={fotos} index={actual} onClose={() => setLightbox(false)} onPrev={prev} onNext={next} />}

      <div style={{ borderRadius: 20, overflow: "hidden", marginBottom: 10, background: "#f3f4f6", height: 260, position: "relative", cursor: fotos.length > 0 ? "zoom-in" : "default", width: "100%" }}>
        {imagenPrincipal ? (
          <img src={imagenPrincipal} alt={titulo || ""} onClick={() => fotos.length > 0 && setLightbox(true)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 60 }}>🏠</div>
        )}
        {fotos.length > 1 && (
          <>
            <button onClick={e => { e.stopPropagation(); prev(); }} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.9)", border: "none", color: "#1a1a2e", fontSize: 22, width: 40, height: 40, borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>‹</button>
            <button onClick={e => { e.stopPropagation(); next(); }} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.9)", border: "none", color: "#1a1a2e", fontSize: 22, width: 40, height: 40, borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>›</button>
          </>
        )}
        {fotos.length > 1 && (
          <div style={{ position: "absolute", bottom: 12, right: 14, background: "rgba(0,0,0,0.5)", color: "#fff", padding: "3px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
            {actual + 1} / {fotos.length}
          </div>
        )}
        {fotos.length > 0 && (
          <button onClick={() => setLightbox(true)} style={{ position: "absolute", bottom: 12, left: 14, background: "rgba(255,255,255,0.9)", border: "none", color: "#1a1a2e", padding: "4px 12px", borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
            ⛶ Ampliar
          </button>
        )}
      </div>

      {fotos.length > 1 && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 20, paddingBottom: 4 }}>
          {fotos.map((foto, i) => (
            <div key={i} onClick={() => setActual(i)} style={{ width: 84, height: 62, borderRadius: 10, overflow: "hidden", flexShrink: 0, cursor: "pointer", border: actual === i ? "2px solid #C8102E" : "2px solid transparent", opacity: actual === i ? 1 : 0.6, transition: "opacity 0.15s, border 0.15s" }}>
              <img src={foto.url || ""} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function PropiedadDetalle({ propiedad }) {
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [contacto, setContacto] = useState({ nombre: "", telefono: "", email: "", mensaje: "" });

  if (!propiedad) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Montserrat', sans-serif", background: "#fafafa" }}>
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: 48 }}>🔍</p>
        <h2 style={{ color: "#1a1a2e" }}>Propiedad no encontrada</h2>
        <a href="/propiedades" style={{ color: "#C8102E", fontWeight: 700 }}>← Ver todas las propiedades</a>
      </div>
    </div>
  );

  const op = propiedad.operations?.[0];
  const precio = op?.amount || 0;
  const fotos = Array.isArray(propiedad.property_images) ? propiedad.property_images : [];
  const amenidades = Array.isArray(propiedad.amenities) ? propiedad.amenities : [];
  const status = propiedad.status || "published";
  const agente = propiedad.agent?.name || propiedad.user?.name || null;
  const agenteEmail = propiedad.agent?.email || propiedad.user?.email || null;
  const agenteInicial = agente ? agente.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() : null;

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
    <div style={{ minHeight: "100vh", background: "#fafafa", fontFamily: "'Montserrat', 'system-ui', sans-serif", overflowX: "hidden", maxWidth: "100vw" }}>
      <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
        <a href="https://emporioinmobiliario.com.mx" style={{ textDecoration: "none", display: "flex", alignItems: "center" }}>
          <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio Inmobiliario" style={{ height: 40, width: "auto", objectFit: "contain" }} />
        </a>
        <a href="/propiedades" style={{ color: "#C8102E", fontSize: 13, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>← Volver</a>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        * { box-sizing: border-box; }
        html, body { overflow-x: hidden !important; max-width: 100vw !important; }
        .det-grid { display: grid; grid-template-columns: minmax(0,1fr) 340px; gap: 24px; align-items: start; }
        .det-contacto { position: sticky; top: 20px; }
        @media (max-width: 768px) {
          .det-grid { grid-template-columns: 1fr !important; }
          .det-contacto { position: static !important; order: -1; }
          .det-pad { padding: 16px !important; }
          .det-titulo { font-size: 17px !important; }
          .det-precio { font-size: 22px !important; }
          * { max-width: 100% !important; overflow-wrap: break-word !important; word-break: break-word !important; }
          img, iframe { width: 100% !important; height: auto !important; }
        }
      `}} />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px", overflowX: "hidden", width: "100%" }}>
        <div className="det-grid">

          {/* Columna izquierda */}
          <div>
            <Galeria fotos={fotos} titulo={propiedad.title} />

            {/* Info principal */}
            <div style={{ background: "#fff", borderRadius: 20, padding: "24px 28px", marginBottom: 16, border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>

              {/* Título + badge + precio */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div style={{ flex: 1, marginRight: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                    <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#1a1a2e", lineHeight: 1.3, wordBreak: "break-word" }}>{propiedad.title || ""}</h1>
                    <StatusBadge status={status} />
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>📍 {typeof propiedad.location === "string" ? propiedad.location : ""}</p>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <p style={{ margin: 0, fontSize: 28, fontWeight: 900, color: "#C8102E" }}>{fmt(precio)}</p>
                  <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{op?.currency || "MXN"} / {op?.unit === "total" ? "total" : "mes"}</p>
                </div>
              </div>

              {/* Agente */}
              {agente && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", borderTop: "1px solid #f3f4f6", marginBottom: 4 }}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#C8102E", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
                    {agenteInicial}
                  </div>
                  <div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1a1a2e" }}>{agente}</p>
                    {agenteEmail && <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{agenteEmail}</p>}
                  </div>
                  <span style={{ marginLeft: "auto", fontSize: 11, background: "#fff0f2", color: "#C8102E", padding: "3px 10px", borderRadius: 99, fontWeight: 600 }}>Agente asignado</span>
                </div>
              )}

              {/* Características */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "14px 0", borderTop: "1px solid #f3f4f6", borderBottom: "1px solid #f3f4f6", marginBottom: 20 }}>
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
                  <p style={{ margin: 0, fontSize: 14, color: "#374151", lineHeight: 1.8, whiteSpace: "pre-line", wordBreak: "break-word", overflowWrap: "break-word" }}>
                    {typeof propiedad.description === "string" ? propiedad.description : ""}
                  </p>
                </div>
              )}

              {/* Mapa */}
              {(() => {
                const lat = propiedad.location?.latitude;
                const lng = propiedad.location?.longitude;
                const direccion = [propiedad.location?.street, propiedad.location?.city_area, propiedad.location?.city, propiedad.location?.region].filter(Boolean).join(", ");
                if (lat && lng && propiedad.location?.show_exact_location) {
                  return (
                    <div style={{ marginTop: 24 }}>
                      <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#1a1a2e" }}>📍 Ubicación</h3>
                      <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #f0f0f0" }}>
                        <iframe width="100%" height="260" frameBorder="0" scrolling="no" style={{ display: "block" }}
                          src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng-0.005},${lat-0.005},${lng+0.005},${lat+0.005}&layer=mapnik&marker=${lat},${lng}`}
                        />
                      </div>
                      <a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer"
                        style={{ fontSize: 12, color: "#6b7280", display: "block", marginTop: 6, textAlign: "right" }}>
                        Ver en Google Maps →
                      </a>
                    </div>
                  );
                } else if (direccion) {
                  return (
                    <div style={{ marginTop: 24 }}>
                      <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#1a1a2e" }}>📍 Zona</h3>
                      <div style={{ background: "#f8f8fa", borderRadius: 12, padding: "14px 16px", border: "1px solid #f0f0f0" }}>
                        <p style={{ margin: 0, fontSize: 14, color: "#374151" }}>📍 {direccion}</p>
                        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion + ", Puebla, México")}`}
                          target="_blank" rel="noreferrer"
                          style={{ fontSize: 12, color: "#C8102E", fontWeight: 600, display: "inline-block", marginTop: 8 }}>
                          Ver en Google Maps →
                        </a>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            {/* Amenidades */}
            {amenidades.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 20, padding: "24px 28px", border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: "#1a1a2e" }}>Amenidades</h3>
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
            <div className="det-contacto" style={{ background: "#fff", borderRadius: 20, padding: "24px", border: "1px solid #f0f0f0", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
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
                      <input type={f.type} placeholder={f.placeholder} value={contacto[f.key]} onChange={e => setContacto(c => ({ ...c, [f.key]: e.target.value }))}
                        style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", fontFamily: "'Montserrat', sans-serif" }} />
                    </div>
                  ))}
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 4 }}>Mensaje</label>
                    <textarea placeholder={`Hola, me interesa la propiedad ${propiedad.public_id || ""}...`} value={contacto.mensaje} onChange={e => setContacto(c => ({ ...c, mensaje: e.target.value }))}
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", minHeight: 80, resize: "vertical", fontFamily: "'Montserrat', sans-serif" }} />
                  </div>
                  <button onClick={handleContacto} disabled={enviando || !contacto.nombre || !contacto.telefono}
                    style={{ width: "100%", background: "#C8102E", color: "#fff", border: "none", borderRadius: 10, padding: "13px", fontWeight: 800, fontSize: 15, cursor: enviando ? "not-allowed" : "pointer", opacity: enviando ? 0.7 : 1, marginBottom: 12, fontFamily: "'Montserrat', sans-serif" }}>
                    {enviando ? "Enviando..." : "📩 Enviar mensaje"}
                  </button>
                  <a href={`https://wa.me/522222573237?text=Hola, me interesa la propiedad ${propiedad.public_id || ""} - ${propiedad.title || ""}`} target="_blank" rel="noreferrer"
                    style={{ display: "block", width: "100%", background: "#25d366", color: "#fff", border: "none", borderRadius: 10, padding: "13px", fontWeight: 800, fontSize: 15, cursor: "pointer", textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}>
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

      <a href="https://wa.me/522222573237" target="_blank" rel="noreferrer" style={{ position: "fixed", bottom: 24, right: 24, background: "#25d366", color: "#fff", width: 56, height: 56, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", textDecoration: "none", zIndex: 100 }}>
        💬
      </a>
    </div>
  );
}

export async function getServerSideProps({ params }) {
  try {
    const res = await fetch(`https://api.easybroker.com/v1/properties/${params.id}`, {
      headers: { "X-Authorization": process.env.EASYBROKER_API_KEY, "accept": "application/json" },
    });
    const data = await res.json();
    if (!data || data.error) return { props: { propiedad: null } };
    return { props: { propiedad: data } };
  } catch (e) {
    return { props: { propiedad: null } };
  }
}
