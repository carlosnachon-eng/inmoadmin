import { supabase } from "./supabase";

const fechaMexico = (fechaHora) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date(fechaHora));

const sumarDias = (fecha, dias) => {
  const d = new Date(`${fecha}T12:00:00-06:00`);
  d.setDate(d.getDate() + dias);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
};

export async function sincronizarKpisCitas(asesorId, fechaHora) {
  if (!asesorId || !fechaHora) return;

  const fecha = fechaMexico(fechaHora);
  const diaSiguiente = sumarDias(fecha, 1);
  const [{ data: perfil, error: perfilError }, { data: citas, error: citasError }] = await Promise.all([
    supabase.from("profiles").select("email, full_name").eq("id", asesorId).maybeSingle(),
    supabase
      .from("citas")
      .select("estado, fecha_hora")
      .eq("asesor_id", asesorId)
      .gte("fecha_hora", `${fecha}T00:00:00-06:00`)
      .lt("fecha_hora", `${diaSiguiente}T00:00:00-06:00`),
  ]);

  if (perfilError) throw perfilError;
  if (citasError) throw citasError;
  if (!perfil?.email) return;

  const citasDelDia = (citas || []).filter(c => fechaMexico(c.fecha_hora) === fecha);
  const calculado = {
    citas_agendadas: citasDelDia.length,
    citas_efectivas: citasDelDia.filter(c => c.estado === "efectiva" || c.estado === "calificada").length,
    citas_calificadas: citasDelDia.filter(c => c.estado === "calificada").length,
  };

  const { data: existente, error: existenteError } = await supabase
    .from("kpis_diarios")
    .select("id")
    .eq("email", perfil.email)
    .eq("fecha", fecha)
    .maybeSingle();

  if (existenteError) throw existenteError;

  if (existente) {
    const { error } = await supabase.from("kpis_diarios").update(calculado).eq("id", existente.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("kpis_diarios").insert({
    ...calculado,
    fecha,
    asesor: perfil.full_name || perfil.email,
    email: perfil.email,
  });
  if (error) throw error;
}
