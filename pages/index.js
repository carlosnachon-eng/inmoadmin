import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import Layout, { brand, nav } from "../components/Layout";
import { useModulosPermitidos } from "../lib/permisos";

const Field = ({ label, hint, children }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}>{label}</label>
    {hint && <p style={{ margin: "0 0 4px", fontSize: 11, color: "#9ca3af" }}>{hint}</p>}
    {children}
  </div>
);

const Input = (props) => (
  <input {...props} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", ...props.style }} />
);

const LoginScreen = ({ onLogin }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const handleLogin = async () => {
    setLoading(true); setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError("Email o contraseña incorrectos");
    else onLogin();
  };
  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 40, width: "100%", maxWidth: 400, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", border: "1px solid #e5e7eb" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio Inmobiliario" style={{ height: 64, objectFit: "contain", marginBottom: 12 }} />
          <p style={{ margin: 0, fontSize: 13, color: brand.grayLight, fontWeight: 500 }}>Sistema de Gestión Interno</p>
        </div>
        {error && <div style={{ background: "#fee2e2", color: "#991b1b", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 14, fontWeight: 600 }}>{error}</div>}
        <Field label="Email"><Input type="email" placeholder="tu@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} /></Field>
        <Field label="Contraseña"><Input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} /></Field>
        <button onClick={handleLogin} disabled={loading || !email || !password} style={{ width: "100%", background: brand.red, color: "#fff", border: "none", borderRadius: 10, padding: "14px", fontWeight: 800, cursor: loading ? "not-allowed" : "pointer", fontSize: 16, marginTop: 8, opacity: loading ? 0.7 : 1 }}>
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </div>
    </div>
  );
};

export default function Home() {
  const [session, setSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const { cargando: permisosCargando, modulosPermitidos, esAdmin, perfil } = useModulosPermitidos();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setCheckingSession(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  const logout = async () => { await supabase.auth.signOut(); setSession(null); };

  if (checkingSession || (session && permisosCargando)) {
    return (
      <div style={{ minHeight: "100vh", background: "#f4f5f7", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 60, opacity: 0.5 }} />
      </div>
    );
  }

  if (!session) return <LoginScreen onLogin={() => {}} />;

  const navConModulo = nav.filter(n => n.modulo);
  const navAccesible = esAdmin ? navConModulo : navConModulo.filter(n => modulosPermitidos.includes(n.modulo));
  const nombre = perfil?.email?.split("@")[0] || "";
  const horaDelDia = new Date().getHours();
  const saludo = horaDelDia < 12 ? "Buenos días" : horaDelDia < 19 ? "Buenas tardes" : "Buenas noches";

  return (
    <Layout
      view="bienvenida"
      profile={perfil}
      onLogout={logout}
      modulosPermitidos={modulosPermitidos}
      esAdmin={esAdmin}
      permisosCargando={permisosCargando}
    >
      <div style={{ padding: 28, maxWidth: 980, margin: "0 auto" }}>
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 800, color: brand.gray }}>
            {saludo}{nombre ? `, ${nombre}` : ""}
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: brand.grayLight }}>
            {new Date().toLocaleDateString("es-MX", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>

        {navAccesible.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: 14, padding: 40, textAlign: "center", border: "1px solid #f0f0f0" }}>
            <p style={{ fontSize: 32, margin: "0 0 8px" }}>🔒</p>
            <p style={{ color: "#9ca3af", fontSize: 14 }}>
              Tu cuenta todavía no tiene módulos asignados. Contacta a Carlos para que te dé acceso.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 }}>
            {navAccesible.map(n => (
              <a key={n.id} href={n.link} style={{ textDecoration: "none" }}>
                <div style={{
                  background: "#fff", borderRadius: 14, padding: "22px 18px",
                  border: "1px solid #f0f0f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                  textAlign: "center", transition: "transform 0.15s, box-shadow 0.15s", cursor: "pointer",
                }}>
                  <span style={{ fontSize: 30 }}>{n.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: brand.gray }}>{n.label}</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
