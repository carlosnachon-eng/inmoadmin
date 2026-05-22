import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { createClient } from "@supabase/supabase-js";
import Head from "next/head";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function DocsPublico() {
  const router = useRouter();
  const { folio } = router.query;

  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [autenticado, setAutenticado] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [sol, setSol] = useState(null);
  const [docs, setDocs] = useState({ ident: "", comp: "", buro: "" });
  const [abriendo, setAbriendo] = useState("");

  const pinCorrecto = folio ? folio.slice(-4).toUpperCase() : "";

  const handleVerificarPin = () => {
    if (!pin) { setError("Ingresa el PIN"); return; }
    if (pin.toUpperCase() !== pinCorrecto) {
      setError("PIN incorrecto. Revisa la portada del dictamen.");
      return;
    }
    setError("");
    setAutenticado(true);
  };

  useEffect(() => {
    if (!autenticado || !folio) return;
    setCargando(true);
    supabase
      .rpc("buscar_solicitud_por_folio", { p_folio: folio.toLowerCase() })
      .then(async ({ data }) => {
        const s = data?.[0];
        if (s) await procesarSolicitud(s);
        setCargando(false);
      });
  }, [autenticado, folio]);

  const procesarSolicitud = async (s) => {
    setSol(s);
    const getUrl = async (path) => {
      if (!path) return "";
      if (path.startsWith("data:")) return path;
      const { data } = await supabase.storage.from("poliza-docs").createSignedUrl(path, 3600);
      return data?.signedUrl || "";
    };
    const [ident, comp, buro] = await Promise.all([
      getUrl(s.doc_identificacion || s.doc_identificacion_b64),
      getUrl(s.doc_comprobante_ingresos || s.doc_comprobante_ingresos_b64),
      getUrl(s.doc_buro_mexico),
    ]);
    setDocs({ ident, comp, buro });
  };

  const handleVerDoc = async (url, label) => {
    if (!url) return;
    setAbriendo(label);
    if (url.startsWith("data:")) {
      const [meta, b64] = url.split(",");
      const mime = meta.match(/:(.*?);/)[1];
      const bytes = atob(b64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const blob = new Blob([arr], { type: mime });
      window.open(URL.createObjectURL(blob), "_blank");
    } else {
      window.open(url, "_blank");
    }
    setAbriendo("");
  };

  const nombre = sol?.nombre_completo || sol?.razon_social || sol?.nombre_representante || "—";

  return (
    <>
      <Head>
        <title>Documentos del Dictamen — Emporio Inmobiliario</title>
        <meta name="robots" content="noindex,nofollow" />
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&display=swap" rel="stylesheet" />
      </Head>

      <div style={{ minHeight: "100vh", background: "#f5f5f5", fontFamily: "'Montserrat', system-ui, sans-serif", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <div style={{ background: "#fff", borderBottom: "3px solid #b91c3c", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/emporio-logo.png" alt="Emporio Inmobiliario" style={{ height: 36, objectFit: "contain" }}
              onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='block'; }}
            />
            <span style={{ display:'none', fontWeight:900, fontSize:14, color:'#b91c3c', letterSpacing:'0.05em' }}>EMPORIO INMOBILIARIO</span>
          </div>
          {folio && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Folio</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: "#b91c3c", letterSpacing: "0.05em" }}>{folio}</div>
            </div>
          )}
        </div>

        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 16px" }}>

          {/* PIN */}
          {!autenticado && (
            <div style={{ background: "#fff", borderRadius: 16, padding: "40px 32px", maxWidth: 400, width: "100%", boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
              <div style={{ textAlign: "center", marginBottom: 28 }}>
                <div style={{ width: 56, height: 56, background: "#fff0f3", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 28 }}>🔒</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#111827", marginBottom: 6 }}>Acceso a documentos</div>
                <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
                  Ingresa el PIN de 4 caracteres que aparece en la última página del dictamen para acceder a los documentos.
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <input
                  type="text"
                  value={pin}
                  onChange={e => { setPin(e.target.value.toUpperCase()); setError(""); }}
                  onKeyDown={e => e.key === "Enter" && handleVerificarPin()}
                  maxLength={4}
                  placeholder="Ej. A14B"
                  style={{
                    width: "100%", padding: "14px 16px", fontSize: 20, fontWeight: 800,
                    letterSpacing: "0.3em", textAlign: "center", border: `2px solid ${error ? "#fca5a5" : "#e5e7eb"}`,
                    borderRadius: 10, outline: "none", boxSizing: "border-box",
                    color: "#111827", background: error ? "#fff5f5" : "#fff",
                  }}
                />
                {error && <div style={{ color: "#b91c3c", fontSize: 11, marginTop: 6, textAlign: "center", fontWeight: 600 }}>{error}</div>}
              </div>

              <button
                onClick={handleVerificarPin}
                style={{
                  width: "100%", padding: "14px", background: "#b91c3c", color: "#fff",
                  border: "none", borderRadius: 10, fontSize: 13, fontWeight: 800,
                  cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.08em",
                }}
              >
                Acceder
              </button>

              <div style={{ marginTop: 20, padding: "12px 16px", background: "#f9fafb", borderRadius: 8, fontSize: 11, color: "#6b7280", textAlign: "center" }}>
                El PIN se encuentra en la última página del dictamen, bajo el apartado "PIN de acceso".
              </div>
            </div>
          )}

          {/* Cargando */}
          {autenticado && cargando && (
            <div style={{ textAlign: "center", color: "#6b7280", fontSize: 13 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
              Cargando documentos...
            </div>
          )}

          {/* Documentos */}
          {autenticado && !cargando && sol && (
            <div style={{ maxWidth: 560, width: "100%" }}>
              <div style={{ background: "#fff", borderRadius: 16, padding: "24px 28px", marginBottom: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
                <div style={{ fontSize: 10, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Solicitante</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#111827" }}>{nombre.toUpperCase()}</div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>Folio {folio} · Documentos del dictamen de arrendamiento</div>
              </div>

              {[
                { label: "Identificación oficial", sub: "INE / Pasaporte / Cédula", url: docs.ident, icon: "🪪" },
                { label: "Comprobante de ingresos", sub: "Nómina / Estados de cuenta / CFDI", url: docs.comp, icon: "💼" },
                { label: "Reporte Buró México", sub: "Antecedentes crediticios y legales", url: docs.buro, icon: "📋" },
              ].map(({ label, sub, url, icon }) => (
                <div key={label} style={{
                  background: "#fff", borderRadius: 12, padding: "16px 20px", marginBottom: 10,
                  boxShadow: "0 1px 6px rgba(0,0,0,0.05)", display: "flex", alignItems: "center", gap: 14,
                  border: `1px solid ${url ? "#6ee7b7" : "#e5e7eb"}`,
                }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                    background: url ? "#f0fdf4" : "#f9fafb",
                    border: `1px solid ${url ? "#6ee7b7" : "#e5e7eb"}`,
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
                  }}>{icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{label}</div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{sub}</div>
                  </div>
                  {url ? (
                    <button
                      onClick={() => handleVerDoc(url, label)}
                      disabled={abriendo === label}
                      style={{
                        background: "#b91c3c", color: "#fff", border: "none",
                        borderRadius: 8, padding: "8px 16px", fontSize: 11, fontWeight: 700,
                        cursor: "pointer", whiteSpace: "nowrap",
                      }}
                    >
                      {abriendo === label ? "Abriendo..." : "Ver documento"}
                    </button>
                  ) : (
                    <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600 }}>No disponible</div>
                  )}
                </div>
              ))}

              <div style={{ marginTop: 20, padding: "14px 18px", background: "#f9fafb", borderRadius: 10, fontSize: 10, color: "#9ca3af", textAlign: "center" }}>
                Emporio Inmobiliario · 222 257 3237 · ventas@emporioinmobiliario.mx<br />
                Este enlace es de uso exclusivo del propietario del inmueble. No comparta el PIN con terceros.
              </div>
            </div>
          )}

          {autenticado && !cargando && !sol && (
            <div style={{ textAlign: "center", color: "#6b7280", fontSize: 13 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>❌</div>
              No se encontraron documentos para este folio.
            </div>
          )}

        </div>
      </div>
    </>
  );
}
