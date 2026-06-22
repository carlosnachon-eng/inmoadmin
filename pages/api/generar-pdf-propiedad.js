import { createClient } from "@supabase/supabase-js";
import { generarFichaPropiedadPdf } from "../../lib/generarFichaPropiedadPdf";

// Cliente normal (anon key): usado para leer los datos de la propiedad.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Cliente con service role: necesario para subir el PDF a Storage desde el
// servidor sin depender de la sesión del usuario (las API routes no tienen
// la sesión del navegador, así que con la anon key choca contra RLS).
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { propiedad_id } = req.body;
  if (!propiedad_id) {
    return res.status(400).json({ error: "Falta propiedad_id" });
  }

  // 1) Traer los datos de la propiedad desde Supabase
  const { data: propiedad, error: errorPropiedad } = await supabase
    .from("propiedades")
    .select("*")
    .eq("id", propiedad_id)
    .single();

  if (errorPropiedad || !propiedad) {
    return res.status(404).json({ error: "Propiedad no encontrada" });
  }

  try {
    // 2) Generar el PDF en memoria (sin tocar disco, sin depender de python3).
    //    Deliberadamente excluimos del PDF: status_gravamen, gravamen_institucion,
    //    notas_internas, comision_detalle, ubicacion_llave y demás datos operativos
    //    internos — esos nunca deben salir en el documento que ve el prospecto.
    const datosPublicos = {
      titulo: propiedad.titulo,
      descripcion: propiedad.descripcion,
      operacion: propiedad.operacion,
      precio: propiedad.precio,
      es_exclusiva: propiedad.es_exclusiva,
      tipo: propiedad.tipo,
      recamaras: propiedad.recamaras,
      banos: propiedad.banos,
      estacionamientos: propiedad.estacionamientos,
      m2_construccion: propiedad.m2_construccion,
      m2_terreno: propiedad.m2_terreno,
      direccion: propiedad.mostrar_ubicacion_exacta ? propiedad.direccion : "",
      colonia: propiedad.colonia,
      ciudad: propiedad.ciudad,
      estado: propiedad.estado,
      fotos: Array.isArray(propiedad.fotos) ? propiedad.fotos.slice(0, 3) : [],
      amenidades: propiedad.amenidades,
      creditos_aceptados: propiedad.creditos_aceptados,
      contacto_nombre: "Emporio Inmobiliario",
      contacto_telefono: "222 000 0000",
    };

    const pdfBuffer = await generarFichaPropiedadPdf(datosPublicos);

    // 3) Subir a Supabase Storage (bucket "fichas-propiedad", público)
    //    Usamos supabaseAdmin (service role) porque este endpoint corre en
    //    el servidor, sin la sesión del usuario, y RLS bloquearía el insert
    //    con la anon key.
    const nombreArchivo = `${propiedad.public_id || propiedad_id}_${Date.now()}.pdf`;
    const { error: errorUpload } = await supabaseAdmin.storage
      .from("fichas-propiedad")
      .upload(nombreArchivo, pdfBuffer, { contentType: "application/pdf", upsert: true });

    if (errorUpload) {
      throw new Error("Error al subir el PDF: " + errorUpload.message);
    }

    const { data: urlData } = supabaseAdmin.storage
      .from("fichas-propiedad")
      .getPublicUrl(nombreArchivo);

    return res.status(200).json({ url: urlData.publicUrl });

  } catch (error) {
    console.error("Error generando ficha PDF:", error);
    return res.status(500).json({ error: error.message || "Error al generar el PDF" });
  }
}
