import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { brand } from "../../components/Layout";
import { isEligibleInternalProfile, validateNewPassword } from "../../lib/authRecovery.mjs";

export default function ResetPassword() {
  const [ready, setReady] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    const validateSession = async (session, recoveryEvent = false) => {
      const recoveryHint = recoveryEvent || window.location.hash.includes("type=recovery") || new URLSearchParams(window.location.search).get("type") === "recovery";
      if (!session?.user?.id || !recoveryHint) {
        if (mounted) { setEligible(false); setReady(true); }
        return;
      }
      const { data: profile } = await supabase.from("profiles").select("id, role_id, active").eq("id", session.user.id).maybeSingle();
      if (mounted) { setEligible(isEligibleInternalProfile(profile)); setReady(true); }
    };
    supabase.auth.getSession().then(({ data }) => validateSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") validateSession(session, true);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  const updatePassword = async () => {
    const validationError = validateNewPassword(password, confirmation);
    if (validationError) { setMessage(validationError); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMessage("No fue posible actualizar la contraseña. Solicita un enlace nuevo e inténtalo nuevamente.");
      setSaving(false);
      return;
    }
    await supabase.auth.signOut({ scope: "global" });
    setMessage("Contraseña actualizada. Ya puedes iniciar sesión con tu correo y la nueva contraseña.");
    setSaving(false);
  };

  return <main style={{ minHeight: "100vh", background: "#f4f5f7", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "system-ui, sans-serif" }}>
    <section style={{ width: "100%", maxWidth: 420, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 36, boxShadow: "0 4px 24px rgba(0,0,0,.08)" }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 23, color: "#1a1a2e" }}>Restablecer contraseña</h1>
      {!ready ? <p>Validando enlace...</p> : !eligible ? <p style={{ color: "#991b1b", lineHeight: 1.5 }}>Este enlace no es válido para una cuenta interna activa. Solicita un enlace nuevo o contacta al administrador.</p> : <>
        <p style={{ color: "#6b7280", fontSize: 13, lineHeight: 1.5 }}>Elige una contraseña de al menos 10 caracteres. Tu usuario, UUID, perfil, rol e historial no cambiarán.</p>
        <label style={{ display: "block", fontWeight: 700, fontSize: 13, margin: "18px 0 5px" }}>Nueva contraseña</label>
        <input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: 11, border: "1px solid #d1d5db", borderRadius: 8 }} />
        <label style={{ display: "block", fontWeight: 700, fontSize: 13, margin: "14px 0 5px" }}>Confirmar contraseña</label>
        <input type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: 11, border: "1px solid #d1d5db", borderRadius: 8 }} />
        <button onClick={updatePassword} disabled={saving || !password || !confirmation} style={{ width: "100%", marginTop: 18, padding: 13, border: 0, borderRadius: 9, background: brand.red, color: "white", fontWeight: 800 }}>{saving ? "Actualizando..." : "Guardar nueva contraseña"}</button>
      </>}
      {message && <p role="status" style={{ marginTop: 16, fontSize: 13, fontWeight: 700, lineHeight: 1.5 }}>{message}</p>}
      <a href="/" style={{ display: "block", marginTop: 20, textAlign: "center", color: brand.red, fontWeight: 700, fontSize: 13 }}>Volver al inicio de sesión</a>
    </section>
  </main>;
}
