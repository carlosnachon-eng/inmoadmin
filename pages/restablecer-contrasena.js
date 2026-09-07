import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function RestablecerContrasena() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session || null);
      setReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY" || nextSession) setSession(nextSession);
      setReady(true);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const guardar = async (event) => {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError("No fue posible actualizar la contraseña. Solicita un enlace nuevo.");
      setLoading(false);
      return;
    }
    await supabase.auth.signOut();
    setPassword("");
    setConfirmation("");
    setCompleted(true);
    setLoading(false);
  };

  return (
    <main style={{ minHeight: "100vh", background: "#f4f5f7", display: "grid", placeItems: "center", padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <section style={{ width: "100%", maxWidth: 430, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 20, padding: 36, boxShadow: "0 8px 30px rgba(0,0,0,.08)" }}>
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio Inmobiliario" style={{ height: 62, objectFit: "contain" }} />
          <h1 style={{ margin: "18px 0 8px", color: "#1f2937", fontSize: 25 }}>Establece tu contraseña</h1>
          <p style={{ margin: 0, color: "#6b7280", fontSize: 14, lineHeight: 1.5 }}>Crea una contraseña personal para ingresar a Inmoadmin.</p>
        </div>

        {!ready ? (
          <p style={{ textAlign: "center", color: "#6b7280" }}>Validando enlace seguro…</p>
        ) : completed ? (
          <div style={{ textAlign: "center" }}>
            <p style={{ background: "#ecfdf5", color: "#065f46", borderRadius: 10, padding: 14, fontWeight: 700 }}>Contraseña establecida correctamente.</p>
            <a href="/" style={{ display: "block", marginTop: 16, padding: 13, borderRadius: 10, background: "#b91c1c", color: "#fff", textDecoration: "none", fontWeight: 800 }}>Ingresar a Inmoadmin</a>
          </div>
        ) : !session ? (
          <div style={{ textAlign: "center" }}>
            <p style={{ background: "#fef2f2", color: "#991b1b", borderRadius: 10, padding: 14 }}>El enlace es inválido o expiró. Solicita un enlace nuevo.</p>
            <a href="/" style={{ color: "#b91c1c", fontWeight: 700 }}>Volver al inicio</a>
          </div>
        ) : (
          <form onSubmit={guardar}>
            <label style={{ display: "block", color: "#374151", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Nueva contraseña</label>
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #d1d5db", borderRadius: 9, padding: "12px 13px", fontSize: 15, marginBottom: 15 }} />
            <label style={{ display: "block", color: "#374151", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Confirmar contraseña</label>
            <input type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required minLength={8} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #d1d5db", borderRadius: 9, padding: "12px 13px", fontSize: 15 }} />
            {error && <p style={{ background: "#fef2f2", color: "#991b1b", borderRadius: 9, padding: 11, fontSize: 13 }}>{error}</p>}
            <button type="submit" disabled={loading} style={{ width: "100%", marginTop: 18, border: 0, borderRadius: 10, padding: 13, background: "#b91c1c", color: "#fff", fontSize: 15, fontWeight: 800, cursor: loading ? "wait" : "pointer", opacity: loading ? .7 : 1 }}>
              {loading ? "Guardando…" : "Guardar contraseña"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
