import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";
import { PageHeader, brand } from "../components/Layout";
import { usePermiso, SinAcceso } from "../lib/permisos";

const fmt = (n) => "$" + Number(n).toLocaleString("es-MX", { minimumFractionDigits: 0 });

const ESTATUS = {
  oferta:         { bg: "#dbeafe", color: "#1e40af", label: "Oferta" },
  contraoferta:   { bg: "#fef3c7", color: "#92400e", label: "Contraoferta" },
  aceptado:       { bg: "#d1fae5", color: "#065f46", label: "Aceptado" },
  cancelado:      { bg: "#fee2e2", color: "#991b1b", label: "Cancelado" },
};

export default function CartasOferta() {
  const router = useRouter();
  const { cargando: permisoCargando, puedeVer } = usePermiso("cartas");
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [cartas, setCartas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };
  const [isMobile, setIsMobile] = useState(false);
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
  }, []);

  const loadProfile = async (uid) => {
    await supabase.from("profiles").select("*").eq("id", uid).single();
    setAuthLoading(false);
    loadCartas();
  };

  const loadCartas = async () => {
    setLoading(true);
    const { data } = await supabase.from("cartas_oferta").select("*").order("created_at", { ascending: false });
    setCartas(data || []);
    setLoading(false);
  };

  const filtered = cartas.filter(c =>
    !search ||
    c.folio?.toLowerCase().includes(search.toLowerCase()) ||
    c.cliente_nombre?.toLowerCase().includes(search.toLowerCase()) ||
    c.inmueble?.toLowerCase().includes(search.toLowerCase()) ||
    c.propietarios?.toLowerCase().includes(search.toLowerCase())
  );

  if (authLoading) return <div style={{ minHeight: "100vh", background: brand.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><img src="https://www.emporioinmobiliario.com.mx/logo.png" style={{ height: 48, opacity: 0.4 }} /></div>;
  if (!session) { if (typeof window !== "undefined") window.location.href = "/"; return null; }

  if (permisoCargando) return null;
  if (!puedeVer) return <SinAcceso />;

  return (
    <div style={{ minHeight: "100vh", background: brand.bg, fontFamily: "system-ui, sans-serif" }}>
      {toast && <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000 }}>{toast.msg}</div>}

      <PageHeader title="Cartas de Oferta" icon="📄"
        actions={<button onClick={() => router.push("/cartas/nueva")} style={{ background: brand.red, color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>+ Nueva carta</button>}
      />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 14, display: "flex", gap: 8, alignItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
          <input placeholder="Buscar por folio, cliente, inmueble o propietario…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13 }} />
          <span style={{ fontSize: 12, color: "#9ca3af" }}>{filtered.length} cartas</span>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 48, color: "#9ca3af" }}>Cargando...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: "#9ca3af" }}>No hay cartas registradas.</div>
        ) : (
          <>{isMobile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filtered.map(c => {
                const est = ESTATUS[c.estatus] || ESTATUS.oferta;
                return (
                  <div key={c.id} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 700, color: brand.red, fontSize: 14 }}>{c.folio}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: est.color, background: est.bg, padding: "3px 8px", borderRadius: 99 }}>{est.label}</span>
                    </div>
                    <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: 14, color: "#1a1a2e" }}>{c.cliente_nombre}</p>
                    <p style={{ margin: "0 0 2px", fontSize: 12, color: "#6b7280" }}>{c.inmueble}</p>
                    {c.propietarios && <p style={{ margin: "0 0 6px", fontSize: 12, color: "#6b7280" }}>Propietarios: {c.propietarios}</p>}
                    <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
                      <div>
                        <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Oferta</p>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#1a1a2e" }}>{fmt(c.precio_oferta)}</p>
                      </div>
                      {c.precio_contraoferta && (
                        <div>
                          <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Contraoferta</p>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: brand.red }}>{fmt(c.precio_contraoferta)}</p>
                        </div>
                      )}
                    </div>
                    <button onClick={() => router.push(`/cartas/${c.id}`)} style={{ width: "100%", background: brand.redLight, color: brand.red, border: "none", borderRadius: 8, padding: "8px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                      Ver / Generar PDFs →
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
          <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  {["Folio", "Cliente", "Propietarios", "Inmueble", "Oferta", "Contraoferta", "Estatus", "Acciones"].map(h => (
                    <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const est = ESTATUS[c.estatus] || ESTATUS.oferta;
                  return (
                    <tr key={c.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "11px 14px", fontFamily: "monospace", fontWeight: 700, color: brand.red, fontSize: 13 }}>{c.folio}</td>
                      <td style={{ padding: "11px 14px", fontSize: 13, fontWeight: 600, color: "#1a1a2e" }}>{c.cliente_nombre}</td>
                      <td style={{ padding: "11px 14px", fontSize: 12, color: "#6b7280" }}>{c.propietarios}</td>
                      <td style={{ padding: "11px 14px", fontSize: 12, color: "#6b7280", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.inmueble}</td>
                      <td style={{ padding: "11px 14px", fontSize: 13, fontWeight: 700, color: "#1a1a2e" }}>{fmt(c.precio_oferta)}</td>
                      <td style={{ padding: "11px 14px", fontSize: 13, color: c.precio_contraoferta ? brand.red : "#d1d5db", fontWeight: c.precio_contraoferta ? 700 : 400 }}>{c.precio_contraoferta ? fmt(c.precio_contraoferta) : "—"}</td>
                      <td style={{ padding: "11px 14px" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: est.color, background: est.bg, padding: "3px 8px", borderRadius: 99 }}>{est.label}</span>
                      </td>
                      <td style={{ padding: "11px 14px" }}>
                        <button onClick={() => router.push(`/cartas/${c.id}`)} style={{ background: brand.redLight, color: brand.red, border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          Ver / Generar PDFs
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}</>
        )}
      </div>
    </div>
  );
}
