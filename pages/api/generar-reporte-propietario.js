import { createClient } from "@supabase/supabase-js";
import { generarReportePropietarioPdf } from "../../lib/generarReportePropietarioPdf";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { propiedad_id, desde, hasta } = req.body;
  if (!propiedad_id) return res.status(400).json({ error: "Falta propiedad_id" });

  const { data: propiedad, error: errorPropiedad } = await supabaseAdmin
    .from("propiedades")
    .select("*")
    .eq("id", propiedad_id)
    .single();
  if (errorPropiedad || !propiedad) return res.status(404).json({ error: "Propiedad no encontrada" });

  const { data: propietario } = await supabaseAdmin
    .from("propietarios_inmuebles")
    .select("*")
    .eq("propiedad_id", propiedad_id)
    .maybeSingle();

  try {
    const filtroFecha = (query) => {
      let q = query;
      if (desde) q = q.gte("created_at", `${desde}T00:00:00`);
      if (hasta) q = q.lte("created_at", `${hasta}T23:59:59`);
      return q;
    };

    const filtroFechaHora = (query) => {
      let q = query;
      if (desde) q = q.gte("fecha_hora", `${desde}T00:00:00`);
      if (hasta) q = q.lte("fecha_hora", `${hasta}T23:59:59`);
      return q;
    };

    const [visitasRes, solicitudesRes, enviosPropRes, citasRes] = await Promise.all([
      filtroFecha(supabaseAdmin.from("visitas_propiedad").select("*").eq("propiedad_id", propiedad_id)),
      filtroFecha(supabaseAdmin.from("solicitudes_contacto_propiedad").select("*").eq("propiedad_id", propiedad_id)),
      supabaseAdmin.from("envios_propiedades").select("envio_id, envios(medio, destinatario_nombre, created_at)").eq("propiedad_id", propiedad_id),
      filtroFechaHora(supabaseAdmin.from("citas").select("*, clientes(nombre)").eq("propiedad_id", propiedad_id)),
    ]);

    const visitas = visitasRes.data || [];
    const solicitudes = solicitudesRes.data || [];
    let envios = (enviosPropRes.data || []).map((e) => e.envios).filter(Boolean);
    if (desde) envios = envios.filter((e) => e.created_at >= `${desde}T00:00:00`);
    if (hasta) envios = envios.filter((e) => e.created_at <= `${hasta}T23:59:59`);
    const citas = citasRes.data || [];

    // Periodo anterior (mismo número de días, justo antes del rango
    // seleccionado) — para la comparación mes contra mes en el PDF.
    let comparativaAnterior = null;
    if (desde && hasta) {
      const diffMs = new Date(hasta) - new Date(desde);
      const desdeAnterior = new Date(new Date(desde).getTime() - diffMs - 86400000);
      const hastaAnterior = new Date(new Date(desde).getTime() - 86400000);
      const desdeAnteriorStr = desdeAnterior.toISOString().split("T")[0];
      const hastaAnteriorStr = hastaAnterior.toISOString().split("T")[0];

      const [visitasAntRes, citasAntRes] = await Promise.all([
        supabaseAdmin.from("visitas_propiedad").select("id", { count: "exact", head: true }).eq("propiedad_id", propiedad_id).gte("created_at", `${desdeAnteriorStr}T00:00:00`).lte("created_at", `${hastaAnteriorStr}T23:59:59`),
        supabaseAdmin.from("citas").select("id", { count: "exact", head: true }).eq("propiedad_id", propiedad_id).gte("fecha_hora", `${desdeAnteriorStr}T00:00:00`).lte("fecha_hora", `${hastaAnteriorStr}T23:59:59`),
      ]);
      comparativaAnterior = { visitas: visitasAntRes.count || 0, citas: citasAntRes.count || 0 };
    }

    const pdfBuffer = await generarReportePropietarioPdf({
      propiedad,
      propietario,
      periodo: { desde, hasta },
      datos: { visitas, solicitudes, envios, citas, comparativaAnterior },
    });

    const nombreArchivo = `reporte_${propiedad.public_id || propiedad_id}_${Date.now()}.pdf`;
    const { error: errorUpload } = await supabaseAdmin.storage
      .from("fichas-propiedad")
      .upload(nombreArchivo, pdfBuffer, { contentType: "application/pdf", upsert: true });

    if (errorUpload) throw new Error("Error al subir el PDF: " + errorUpload.message);

    const { data: urlData } = supabaseAdmin.storage.from("fichas-propiedad").getPublicUrl(nombreArchivo);

    return res.status(200).json({ url: urlData.publicUrl });
  } catch (error) {
    console.error("Error generando reporte a propietario:", error);
    return res.status(500).json({ error: error.message || "Error al generar el reporte" });
  }
}
