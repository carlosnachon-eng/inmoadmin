import { useEffect, useState } from "react";
import { useRouter } from "next/router";

const fmt = (n) => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2 });

export default function AceptarCartaOferta() {
  const router = useRouter();
  const { id, token } = router.query;
  const [loading, setLoading] = useState(true);
  const [carta, setCarta] = useState(null);
  const [error, setError] = useState("");
  const [aceptadoPor, setAceptadoPor] = useState("");
  const [correo, setCorreo] = useState("");
  const [telefono, setTelefono] = useState("");
  const [notas, setNotas] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id || !token) return;
    const load = async () => {
      setLoading(true);
      const res = await fetch(`/api/cartas/aceptacion?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No pudimos abrir esta oferta.");
      } else {
        setCarta(data.carta);
        setAceptadoPor(data.carta?.propietarios || "");
      }
      setLoading(false);
    };
    load();
  }, [id, token]);

  const aceptar = async () => {
    if (!confirmado) {
      setError("Confirma que aceptas la oferta para continuar.");
      return;
    }
    if (!correo.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim())) {
      setError("Captura un correo válido para registrar la aceptación.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch("/api/cartas/aceptacion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, token, aceptado_por: aceptadoPor, correo, telefono, notas }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "No pudimos registrar la aceptación.");
      return;
    }
    setCarta(c => ({ ...c, estatus: "aceptado" }));
  };

  const input = { width: "100%", padding: "11px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" };

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8f8f8" }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 46, opacity: 0.45 }} />
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", fontFamily: "system-ui, sans-serif", padding: "24px 16px" }}>
      <div style={{ maxWidth: 620, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio Inmobiliario" style={{ height: 44, objectFit: "contain" }} />
        </div>

        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 24, boxShadow: "0 8px 30px rgba(0,0,0,0.08)" }}>
          {error && !carta ? (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <h1 style={{ margin: "0 0 8px", fontSize: 22, color: "#1a1a2e" }}>Link no disponible</h1>
              <p style={{ margin: 0, color: "#6b7280" }}>{error}</p>
            </div>
          ) : carta?.estatus === "aceptado" ? (
            <div style={{ textAlign: "center", padding: "18px 0" }}>
              <div style={{ width: 62, height: 62, borderRadius: "50%", background: "#d1fae5", color: "#065f46", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 28, fontWeight: 800 }}>✓</div>
              <h1 style={{ margin: "0 0 8px", fontSize: 23, color: "#1a1a2e" }}>Oferta aceptada</h1>
              <p style={{ margin: 0, color: "#6b7280", lineHeight: 1.5 }}>Gracias. Emporio Inmobiliario recibió su aceptación y continuará con el proceso.</p>
            </div>
          ) : (
            <>
              <p style={{ margin: "0 0 5px", color: "#b91c3c", fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>Aceptación de oferta</p>
              <h1 style={{ margin: "0 0 12px", fontSize: 24, color: "#1a1a2e" }}>{carta.folio}</h1>
              <p style={{ margin: "0 0 18px", color: "#6b7280", lineHeight: 1.5 }}>Revise los datos de la oferta. Al confirmar, quedará registrada su aceptación.</p>

              <div style={{ background: "#fff0f3", border: "1px solid #f9c8d3", borderRadius: 12, padding: 16, marginBottom: 18 }}>
                <p style={{ margin: "0 0 4px", fontSize: 12, color: "#9f1239", fontWeight: 800 }}>Precio aceptado</p>
                <p style={{ margin: 0, fontSize: 30, color: "#b91c3c", fontWeight: 900 }}>{fmt(carta.precio_aceptar)}</p>
              </div>

              {[
                ["Propietario(s)", carta.propietarios],
                ["Comprador/ofertante", carta.cliente_nombre],
                ["Inmueble", carta.inmueble],
                ["Apartado", fmt(carta.apartado)],
                ["Enganche", carta.enganche ? fmt(carta.enganche) : "Por acordar"],
                ["Saldo", carta.saldo ? fmt(carta.saldo) : "Por acordar"],
                ["Forma de pago", carta.forma_pago || "—"],
              ].map(([label, value]) => (
                <div key={label} style={{ borderTop: "1px solid #f3f4f6", padding: "10px 0" }}>
                  <p style={{ margin: "0 0 2px", color: "#9ca3af", fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>{label}</p>
                  <p style={{ margin: 0, color: "#374151", fontSize: 14, lineHeight: 1.45 }}>{value}</p>
                </div>
              ))}

              <div style={{ marginTop: 16 }}>
                <label style={{ display: "block", marginBottom: 5, color: "#374151", fontSize: 12, fontWeight: 800 }}>Nombre de quien acepta</label>
                <input value={aceptadoPor} onChange={e => setAceptadoPor(e.target.value)} style={input} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                <div>
                  <label style={{ display: "block", marginBottom: 5, color: "#374151", fontSize: 12, fontWeight: 800 }}>Correo electrónico</label>
                  <input type="email" value={correo} onChange={e => setCorreo(e.target.value)} style={input} placeholder="correo@ejemplo.com" />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: 5, color: "#374151", fontSize: 12, fontWeight: 800 }}>Teléfono</label>
                  <input type="tel" value={telefono} onChange={e => setTelefono(e.target.value)} style={input} placeholder="10 dígitos" />
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <label style={{ display: "block", marginBottom: 5, color: "#374151", fontSize: 12, fontWeight: 800 }}>Comentarios opcionales</label>
                <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={3} style={{ ...input, resize: "vertical", fontFamily: "inherit" }} placeholder="Puede agregar alguna observación si lo desea." />
              </div>

              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, margin: "18px 0", color: "#374151", fontSize: 13, lineHeight: 1.5 }}>
                <input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)} style={{ marginTop: 3, width: 17, height: 17, accentColor: "#b91c3c" }} />
                Confirmo que acepto la oferta presentada sobre el inmueble y autorizo a Emporio Inmobiliario a continuar el proceso con el cliente.
              </label>

              {error && <p style={{ color: "#b91c3c", fontSize: 13, fontWeight: 700 }}>{error}</p>}

              <button onClick={aceptar} disabled={saving || !confirmado || !aceptadoPor.trim() || !correo.trim()} style={{ width: "100%", background: saving || !confirmado || !aceptadoPor.trim() || !correo.trim() ? "#9ca3af" : "#b91c3c", color: "#fff", border: "none", borderRadius: 10, padding: "13px 18px", fontSize: 15, fontWeight: 900, cursor: saving ? "not-allowed" : "pointer" }}>
                {saving ? "Registrando..." : "Acepto la oferta"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
