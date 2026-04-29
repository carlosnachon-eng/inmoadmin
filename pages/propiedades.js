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

  const handleOperacion = (op) => {
    setOperacion(op); setPage(1);
    fetchProperties({ operacion: op, page: 1 });
  };
  const handleFiltros = () => { setPage(1); fetchProperties({ page: 1 }); };
  const handleLimpiar = () => {
    setTipo(""); setPrecioMin(""); setPrecioMax(""); setRecamaras(""); setPage(1);
    fetchProperties({ tipo: "", precioMin: "", precioMax: "", recamaras: "", page: 1 });
  };
  const handlePage = (p) => {
    setPage(p); fetchProperties({ page: p }); window.scrollTo(0, 0);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", fontFamily: "system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#1a1a2e", padding: "24px 32px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <p style={{ margin: 0, fontSize: 11, color: "#c8a96e", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Emporio Inmobiliario</p>
            <h1 style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 800, color: "#fff" }}>
              {operacion === "rental" ? "🏠 Propiedades en Renta" : "🏡 Propiedades en Venta"}
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
              {pagination.total ? `${pagination.total} propiedades encontradas` : ""}
            </p>
          </div>
          <a href="https://emporioinmobiliario.com.mx" style={{ color: "#c8a96e", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
            ← Volver al sitio
          </a>
        </div>

        {/* Toggle */}
        <div style={{ maxWidth: 1100, margin: "20px auto 0", display: "flex", gap: 8 }}>
          {[{ label: "🏠 Renta", value: "rental" }, { label: "🏡 Venta", value: "sale" }].map(op => (
            <button key={op.value} onClick={() => handleOperacion(op.value)} style={{
              padding: "8px 24px", borderRadius: 8, border: "none", cursor: "pointer",
              fontWeight: 700, fontSize: 14,
              background: operacion === op.value ? "#c8a96e" : "rgba(255,255,255,0.1)",
              color: operacion === op.value ? "#1a1a2e" : "rgba(255,255,255,0.7)"
            }}>
              {op.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>

        {/* Filtros */}
        <div style={{ background: "#fff", borderRadius: 14, padding: "16px 20px", marginBottom: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" }}>Tipo</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, background: "#fff" }}>
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
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" }}>Precio mín</label>
            <input type="number" placeholder="0" value={precioMin} onChange={e => setPrecioMin(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, width: 120 }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" }}>Precio máx</label>
            <input type="number" placeholder="Sin límite" value={precioMax} onChange={e => setPrecioMax(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, width: 120 }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" }}>Recámaras</label>
            <select value={recamaras} onChange={e => setRecamaras(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, background: "#fff" }}>
              <option value="">Cualquiera</option>
              <option value="1">1+</option>
              <option value="2">2+</option>
              <option value="3">3+</option>
              <option value="4">4+</option>
            </select>
          </div>
          <button onClick={handleFiltros} style={{ padding: "9px 20px", background: "#1a1a2e", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
            🔍 Buscar
          </button>
          {(tipo || precioMin || precioMax || recamaras) && (
            <button onClick={handleLimpiar} style={{ padding: "9px 16px", background: "#f3f4f6", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, color: "#6b7280" }}>
              ✕ Limpiar
            </button>
          )}
        </div>

        {/* Lista */}
        {loading && (
          <div style={{ textAlign: "center", padding: 60 }}>
            <p style={{ color: "#6b7280", fontSize: 16 }}>Cargando propiedades...</p>
          </div>
        )}

        {!loading && properties.length === 0 && (
          <div style={{ background: "#fff", borderRadius: 14, padding: 60, textAlign: "center" }}>
            <p style={{ fontSize: 40, margin: "0 0 12px" }}>🔍</p>
            <p style={{ color: "#6b7280", fontSize: 16 }}>No encontramos propiedades con esos filtros</p>
          </div>
        )}

        {!loading && properties.map(p => {
          const op = p.operations?.[0];
          const precio = op?.amount || 0;
          const imgUrl = p.title_image_thumb || p.title_image_full;

          // Agente: EasyBroker lo devuelve en agent o user
          const agente = p.agent?.name || p.user?.name || null;
          const agenteInicial = agente ? agente.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() : null;

          // Badge de operación (dato confiable del listado)
          const tipoOp = op?.type === "sale" ? "EN VENTA" : "EN RENTA";
          const opBadgeBg = op?.type === "sale" ? "#c8a96e" : "#1a1a2e";
          const opBadgeColor = op?.type === "sale" ? "#1a1a2e" : "#c8a96e";

          return (
            <a key={p.public_id} href={`/propiedad/${p.public_id}`} style={{ textDecoration: "none" }}>
              <div
                style={{ background: "#fff", borderRadius: 16, overflow: "hidden", marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", display: "flex", cursor: "pointer", transition: "box-shadow 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.15)"}
                onMouseLeave={e => e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.08)"}
              >
                {/* Imagen */}
                <div style={{ width: 280, minWidth: 280, height: 200, overflow: "hidden", flexShrink: 0, background: "#e5e7eb", position: "relative" }}>
                  {imgUrl
                    ? <img src={imgUrl} alt={p.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>🏠</div>
                  }
                  {/* Badge operación sobre imagen */}
                  <div style={{ position: "absolute", top: 10, left: 10 }}>
                    <span style={{ display: "inline-block", background: opBadgeBg, color: opBadgeColor, padding: "4px 10px", borderRadius: 99, fontSize: 11, fontWeight: 800, letterSpacing: "0.06em" }}>
                      {tipoOp}
                    </span>
                  </div>
                </div>

                {/* Contenido */}
                <div style={{ padding: "20px 24px", flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1a1a2e", lineHeight: 1.3, maxWidth: "70%" }}>{p.title}</h3>
                      <div style={{ textAlign: "right" }}>
                        <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#c8a96e" }}>{fmt(precio)}</p>
                        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>{op?.currency} / {op?.unit === "total" ? "total" : "mes"}</p>
                      </div>
                    </div>
                    <p style={{ margin: "0 0 12px", fontSize: 13, color: "#6b7280" }}>📍 {typeof p.location === "string" ? p.location : ""}</p>
                  </div>

                  <div>
                    <div style={{ display: "flex", gap: 12, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
                      {p.property_type && <span style={{ fontSize: 12, background: "#f3f4f6", color: "#374151", padding: "3px 10px", borderRadius: 99, fontWeight: 600 }}>{p.property_type}</span>}
                      {p.bedrooms > 0 && <span style={{ fontSize: 13, color: "#374151" }}>🛏 {p.bedrooms}</span>}
                      {p.bathrooms > 0 && <span style={{ fontSize: 13, color: "#374151" }}>🚿 {p.bathrooms}</span>}
                      {p.parking_spaces > 0 && <span style={{ fontSize: 13, color: "#374151" }}>🚗 {p.parking_spaces}</span>}
                      {p.construction_size > 0 && <span style={{ fontSize: 13, color: "#374151" }}>📐 {p.construction_size} m²</span>}
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      {/* Agente asignado */}
                      {agente ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#1a1a2e", color: "#c8a96e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>
                            {agenteInicial}
                          </div>
                          <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>{agente}</span>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: "#9ca3af" }}>ID: {p.public_id}</span>
                      )}
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#c8a96e" }}>Ver detalle →</span>
                    </div>
                  </div>
                </div>
              </div>
            </a>
          );
        })}

        {/* Paginación */}
        {pagination.total > 10 && (
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 24 }}>
            {page > 1 && <button onClick={() => handlePage(page - 1)} style={{ padding: "10px 20px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>← Anterior</button>}
            <span style={{ padding: "10px 20px", background: "#1a1a2e", color: "#c8a96e", borderRadius: 8, fontWeight: 700 }}>Página {page} de {Math.ceil(pagination.total / 10)}</span>
            {pagination.next_page && <button onClick={() => handlePage(page + 1)} style={{ padding: "10px 20px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Siguiente →</button>}
          </div>
        )}
      </div>

      {/* WhatsApp flotante */}
      <a href="https://wa.me/522222573237" target="_blank" rel="noreferrer" style={{ position: "fixed", bottom: 24, right: 24, background: "#25d366", color: "#fff", width: 56, height: 56, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, boxShadow: "0 4px 12px rgba(0,0,0,0.2)", textDecoration: "none", zIndex: 100 }}>
        💬
      </a>
    </div>
  );
}
