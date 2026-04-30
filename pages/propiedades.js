import { useState, useEffect } from "react";

const fmt = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 0
}).format(n || 0);

export default function Propiedades() {
  const [properties, setProperties] = useState([]);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [operacion, setOperacion] = useState("rental");
  const [tipo, setTipo] = useState("");
  const [precioMin, setPrecioMin] = useState("");
  const [precioMax, setPrecioMax] = useState("");
  const [recamaras, setRecamaras] = useState("");

  const fetchProperties = async (params = {}) => {
    setLoading(true);
    try {
      const p = {
        page: params.page ?? page,
        operacion: params.operacion ?? operacion,
        tipo: params.tipo ?? tipo,
        precioMin: params.precioMin ?? precioMin,
        precioMax: params.precioMax ?? precioMax,
        recamaras: params.recamaras ?? recamaras,
      };
      const query = new URLSearchParams();
      query.append("page", p.page);
      query.append("operacion", p.operacion);
      if (p.tipo) query.append("tipo", p.tipo);
      if (p.precioMin) query.append("precioMin", p.precioMin);
      if (p.precioMax) query.append("precioMax", p.precioMax);
      if (p.recamaras) query.append("recamaras", p.recamaras);

      const res = await fetch(`/api/propiedades-eb?${query.toString()}`);
      const data = await res.json();
      setProperties(data.content || []);
      setPagination(data.pagination || {});
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchProperties(); }, []);

  const handleOperacion = (op) => { setOperacion(op); setPage(1); fetchProperties({ operacion: op, page: 1 }); };
  const handleFiltros = () => { setPage(1); fetchProperties({ page: 1 }); };
  const handleLimpiar = () => {
    setTipo(""); setPrecioMin(""); setPrecioMax(""); setRecamaras(""); setPage(1);
    fetchProperties({ tipo: "", precioMin: "", precioMax: "", recamaras: "", page: 1 });
  };
  const handlePage = (p) => { setPage(p); fetchProperties({ page: p }); window.scrollTo(0, 0); };

  return (
    <div style={{ minHeight: "100vh", background: "#fafafa", fontFamily: "'Montserrat', 'system-ui', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", padding: "20px 32px", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <a href="https://emporioinmobiliario.com.mx">
                <img src="https://www.emporioinmobiliario.com.mx/wp-content/uploads/2022/03/emporio-1-768x434.png" alt="Emporio" style={{ height: 40, width: "auto" }} />
              </a>
              <div style={{ width: 1, height: 32, background: "#e5e7eb" }} />
              <div>
                <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#1a1a2e" }}>
                  {operacion === "rental" ? "🏠 Propiedades en Renta" : "🏡 Propiedades en Venta"}
                </h1>
                {pagination.total ? (
                  <p style={{ margin: 0, fontSize: 13, color: "#9ca3af", marginTop: 2 }}>{pagination.total} propiedades encontradas</p>
                ) : null}
              </div>
            </div>
            <a href="https://emporioinmobiliario.com.mx" style={{ color: "#C8102E", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
              ← Volver al sitio
            </a>
          </div>

          {/* Toggle */}
          <div style={{ display: "flex", gap: 8 }}>
            {[{ label: "🏠 Renta", value: "rental" }, { label: "🏡 Venta", value: "sale" }].map(op => (
              <button key={op.value} onClick={() => handleOperacion(op.value)} style={{
                padding: "9px 28px", borderRadius: 8, cursor: "pointer",
                fontWeight: 700, fontSize: 14, fontFamily: "'Montserrat', sans-serif",
                border: "2px solid",
                borderColor: operacion === op.value ? "#C8102E" : "#e5e7eb",
                background: operacion === op.value ? "#C8102E" : "#fff",
                color: operacion === op.value ? "#fff" : "#6b7280",
                transition: "all 0.15s",
              }}>
                {op.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>

        {/* Filtros */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "20px 24px", marginBottom: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #f0f0f0", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#9ca3af", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Tipo</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)} style={{ padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, background: "#fff", fontFamily: "'Montserrat', sans-serif", color: "#374151" }}>
              <option value="">Todos</option>
              <option value="Departamento">Departamento</option>
              <option value="Casa">Casa</option>
              <option value="Casa en condominio">Casa en condominio</option>
              <option value="Local comercial">Local comercial</option>
              <option value="Oficina">Oficina</option>
              <option value="Terreno">Terreno</option>
              <option value="Bodega">Bodega</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#9ca3af", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Precio mín</label>
            <input type="number" placeholder="0" value={precioMin} onChange={e => setPrecioMin(e.target.value)} style={{ padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, width: 120, fontFamily: "'Montserrat', sans-serif" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#9ca3af", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Precio máx</label>
            <input type="number" placeholder="Sin límite" value={precioMax} onChange={e => setPrecioMax(e.target.value)} style={{ padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, width: 120, fontFamily: "'Montserrat', sans-serif" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#9ca3af", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Recámaras</label>
            <select value={recamaras} onChange={e => setRecamaras(e.target.value)} style={{ padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, background: "#fff", fontFamily: "'Montserrat', sans-serif", color: "#374151" }}>
              <option value="">Cualquiera</option>
              <option value="1">1+</option>
              <option value="2">2+</option>
              <option value="3">3+</option>
              <option value="4">4+</option>
            </select>
          </div>
          <button onClick={handleFiltros} style={{ padding: "10px 24px", background: "#C8102E", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 14, fontFamily: "'Montserrat', sans-serif" }}>
            🔍 Buscar
          </button>
          {(tipo || precioMin || precioMax || recamaras) && (
            <button onClick={handleLimpiar} style={{ padding: "10px 16px", background: "#f3f4f6", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, color: "#6b7280", fontFamily: "'Montserrat', sans-serif" }}>
              ✕ Limpiar
            </button>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: "center", padding: 80 }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🏠</div>
            <p style={{ color: "#9ca3af", fontSize: 16, fontWeight: 500 }}>Cargando propiedades...</p>
          </div>
        )}

        {/* Sin resultados */}
        {!loading && properties.length === 0 && (
          <div style={{ background: "#fff", borderRadius: 16, padding: 60, textAlign: "center", border: "1px solid #f0f0f0" }}>
            <p style={{ fontSize: 48, margin: "0 0 12px" }}>🔍</p>
            <p style={{ color: "#6b7280", fontSize: 16, fontWeight: 500 }}>No encontramos propiedades con esos filtros</p>
            <button onClick={handleLimpiar} style={{ marginTop: 16, padding: "10px 24px", background: "#C8102E", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontFamily: "'Montserrat', sans-serif" }}>
              Ver todas las propiedades
            </button>
          </div>
        )}

        {/* Lista */}
        {!loading && properties.map(p => {
          const op = p.operations?.[0];
          const precio = op?.amount || 0;
          const imgUrl = p.title_image_thumb || p.title_image_full;
          const agente = p.agent?.name || p.user?.name || null;
          const agenteInicial = agente ? agente.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() : null;
          const tipoOp = op?.type === "sale" ? "EN VENTA" : "EN RENTA";
          const esVenta = op?.type === "sale";

          return (
            <a key={p.public_id} href={`/propiedad/${p.public_id}`} style={{ textDecoration: "none" }}>
              <div
                style={{ background: "#fff", borderRadius: 20, overflow: "hidden", marginBottom: 16, border: "1px solid #f0f0f0", display: "flex", cursor: "pointer", transition: "transform 0.2s, box-shadow 0.2s" }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 32px rgba(0,0,0,0.1)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
              >
                {/* Imagen */}
                <div style={{ width: 280, minWidth: 280, height: 200, overflow: "hidden", flexShrink: 0, background: "#f3f4f6", position: "relative" }}>
                  {imgUrl
                    ? <img src={imgUrl} alt={p.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>🏠</div>
                  }
                  <div style={{ position: "absolute", top: 10, left: 10 }}>
                    <span style={{ display: "inline-block", background: esVenta ? "#1a1a2e" : "#C8102E", color: "#fff", padding: "4px 12px", borderRadius: 99, fontSize: 11, fontWeight: 800, letterSpacing: "0.06em" }}>
                      {tipoOp}
                    </span>
                  </div>
                </div>

                {/* Contenido */}
                <div style={{ padding: "20px 28px", flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1a1a2e", lineHeight: 1.3, maxWidth: "65%" }}>{p.title}</h3>
                      <div style={{ textAlign: "right" }}>
                        <p style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#C8102E" }}>{fmt(precio)}</p>
                        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{op?.currency} / {op?.unit === "total" ? "total" : "mes"}</p>
                      </div>
                    </div>
                    <p style={{ margin: "0 0 14px", fontSize: 13, color: "#6b7280" }}>📍 {typeof p.location === "string" ? p.location : ""}</p>
                  </div>

                  <div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
                      {p.property_type && <span style={{ fontSize: 12, background: "#f3f4f6", color: "#374151", padding: "4px 12px", borderRadius: 99, fontWeight: 600 }}>{p.property_type}</span>}
                      {p.bedrooms > 0 && <span style={{ fontSize: 13, color: "#374151" }}>🛏 {p.bedrooms}</span>}
                      {p.bathrooms > 0 && <span style={{ fontSize: 13, color: "#374151" }}>🚿 {p.bathrooms}</span>}
                      {p.parking_spaces > 0 && <span style={{ fontSize: 13, color: "#374151" }}>🚗 {p.parking_spaces}</span>}
                      {p.construction_size > 0 && <span style={{ fontSize: 13, color: "#374151" }}>📐 {p.construction_size} m²</span>}
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      {agente ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#C8102E", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800 }}>
                            {agenteInicial}
                          </div>
                          <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>{agente}</span>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: "#9ca3af" }}>ID: {p.public_id}</span>
                      )}
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#C8102E" }}>Ver detalle →</span>
                    </div>
                  </div>
                </div>
              </div>
            </a>
          );
        })}

        {/* Paginación */}
        {pagination.total > 10 && (
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 32, marginBottom: 16 }}>
            {page > 1 && (
              <button onClick={() => handlePage(page - 1)} style={{ padding: "10px 24px", background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontFamily: "'Montserrat', sans-serif", color: "#374151" }}>
                ← Anterior
              </button>
            )}
            <span style={{ padding: "10px 24px", background: "#C8102E", color: "#fff", borderRadius: 10, fontWeight: 700, fontFamily: "'Montserrat', sans-serif" }}>
              Página {page} de {Math.ceil(pagination.total / 10)}
            </span>
            {pagination.next_page && (
              <button onClick={() => handlePage(page + 1)} style={{ padding: "10px 24px", background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontFamily: "'Montserrat', sans-serif", color: "#374151" }}>
                Siguiente →
              </button>
            )}
          </div>
        )}
      </div>

      {/* WhatsApp flotante */}
      <a href="https://wa.me/522222573237" target="_blank" rel="noreferrer" style={{ position: "fixed", bottom: 24, right: 24, background: "#25d366", color: "#fff", width: 56, height: 56, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", textDecoration: "none", zIndex: 100 }}>
        💬
      </a>
    </div>
  );
}
