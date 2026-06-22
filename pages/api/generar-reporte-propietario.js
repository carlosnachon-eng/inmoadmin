import { createClient } from "@supabase/supabase-js";
import { generarReportePropietarioPdf } from "../../lib/generarReportePropietarioPdf";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { propiedad_id, desde, hasta } = req.body;
  if (!propiedad_id) return res.status(400).json({ error: "Falta propiedad_id" });

  const { data: propiedad, error: errorPropiedad } = await supabase
    .from("propiedades")
    .select("*")
    .eq("id", propiedad_id)
    .single();
  if (errorPropiedad || !propiedad) return res.status(404).json({ error: "Propiedad no encontrada" });

  const { data: propietario } = await supabase
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

    const [visitasRes, solicitudesRes, enviosPropRes] = await Promise.all([
      filtroFecha(supabase.from("visitas_propiedad").select("*").eq("propiedad_id", propiedad_id)),
      filtroFecha(supabase.from("solicitudes_contacto_propiedad").select("*").eq("propiedad_id", propiedad_id)),
      supabase.from("envios_propiedades").select("envio_id, envios(medio, destinatario_nombre, created_at)").eq("propiedad_id", propiedad_id),
    ]);

    const visitas = visitasRes.data || [];
    const solicitudes = solicitudesRes.data || [];
    let envios = (enviosPropRes.data || []).map((e) => e.envios).filter(Boolean);
    if (desde) envios = envios.filter((e) => e.created_at >= `${desde}T00:00:00`);
    if (hasta) envios = envios.filter((e) => e.created_at <= `${hasta}T23:59:59`);

    const pdfBuffer = await generarReportePropietarioPdf({
      propiedad,
      propietario,
      periodo: { desde, hasta },
      datos: { visitas, solicitudes, envios },
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
