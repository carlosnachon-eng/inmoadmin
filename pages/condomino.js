import { useEffect, useMemo, useState } from "react";
import ControlledCondominoPortal from "../components/condomino/ControlledCondominoPortal";
import LegacyCondominoPortal from "../components/condomino/LegacyCondominoPortal";
import { supabase } from "../lib/supabase";

const centered = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  background: "#f8f8f8",
  color: "#6b7280",
  fontFamily: "system-ui,sans-serif",
  padding: 20,
};

function MixedExperienceSelector({ value, onChange }) {
  return <div style={{ position: "fixed", zIndex: 3000, right: 16, top: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 8, boxShadow: "0 4px 18px rgba(0,0,0,.12)" }}>
    <label htmlFor="portal-experience" style={{ display: "block", marginBottom: 4, color: "#6b7280", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>Experiencia</label>
    <select id="portal-experience" value={value} onChange={(event) => onChange(event.target.value)} style={{ border: "1px solid #d1d5db", borderRadius: 7, padding: "7px 9px", fontWeight: 700 }}>
      <option value="CONTROLLED">Portal controlado</option>
      <option value="LEGACY">Portal legacy</option>
    </select>
  </div>;
}

export default function CondominoPortalRouter() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeError, setScopeError] = useState(false);
  const [units, setUnits] = useState([]);
  const [experience, setExperience] = useState("CONTROLLED");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setUnits([]);
      setScopeError(false);
      return;
    }
    let active = true;
    setScopeLoading(true);
    supabase.rpc("condominium_owner_portal_units").then(({ data, error }) => {
      if (!active) return;
      setUnits(error ? [] : data || []);
      setScopeError(Boolean(error));
      setScopeLoading(false);
    });
    return () => { active = false; };
  }, [session]);

  const modes = useMemo(() => new Set(units.map((unit) => unit.portal_mode)), [units]);
  const mixed = modes.has("LEGACY") && modes.has("CONTROLLED");
  const legacyUnitIds = useMemo(() => units.filter((unit) => unit.portal_mode === "LEGACY").map((unit) => unit.unidad_id), [units]);

  useEffect(() => {
    if (mixed) return;
    if (modes.has("LEGACY")) setExperience("LEGACY");
    if (modes.has("CONTROLLED")) setExperience("CONTROLLED");
  }, [mixed, modes]);

  if (authLoading) return <main style={centered}>Cargando…</main>;
  if (!session) return <LegacyCondominoPortal />;
  if (scopeLoading) return <main style={centered}>Cargando portal…</main>;
  if (scopeError) return <main style={centered}><div><p>No fue posible validar el acceso al portal.</p><button onClick={() => supabase.auth.signOut()}>Cerrar sesión</button></div></main>;

  if (!mixed && modes.has("LEGACY")) return <LegacyCondominoPortal />;
  if (!mixed && modes.has("CONTROLLED")) return <ControlledCondominoPortal />;
  if (!mixed) return <ControlledCondominoPortal />;

  return <>
    <MixedExperienceSelector value={experience} onChange={setExperience} />
    {experience === "LEGACY"
      ? <LegacyCondominoPortal allowedUnitIds={legacyUnitIds} />
      : <ControlledCondominoPortal />}
  </>;
}
