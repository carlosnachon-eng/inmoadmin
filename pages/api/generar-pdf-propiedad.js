import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
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

  // 2) Armar el JSON con SOLO los campos que debe ver el prospecto.
  //    Deliberadamente excluimos: status_gravamen, gravamen_institucion,
  //    notas_internas, comision_detalle, ubicacion_llave, datos de servicios
  //    operativos — esos son de uso interno, nunca deben salir en el PDF
  //    que se le manda a un cliente.
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
    // Datos de contacto: por ahora el contacto general de Emporio.
    // Cuando se conecte con el asesor que envía, aquí se puede personalizar.
    contacto_nombre: "Emporio Inmobiliario",
    contacto_telefono: "222 000 0000",
  };

  const tmpDir = os.tmpdir();
  const dataFile = path.join(tmpDir, `ficha_data_${Date.now()}.json`);
  const pdfFile = path.join(tmpDir, `ficha_${Date.now()}.pdf`);
  const pyScript = path.join(process.cwd(), "scripts", "generate_ficha_propiedad.py");
  const logoPath = path.join(process.cwd(), "scripts", "logo_emporio.jpeg");

  try {
    fs.writeFileSync(dataFile, JSON.stringify(datosPublicos));

    execSync(`python3 "${pyScript}" "${dataFile}" "${pdfFile}" "${logoPath}"`, {
      timeout: 25000,
      env: { ...process.env },
    });

    if (!fs.existsSync(pdfFile)) {
      throw new Error("El PDF no fue generado");
    }

    const pdfBuffer = fs.readFileSync(pdfFile);

    // 3) Subir a Supabase Storage (bucket "fichas-propiedad", público)
    const nombreArchivo = `${propiedad.public_id || propiedad_id}_${Date.now()}.pdf`;
    const { error: errorUpload } = await supabase.storage
      .from("fichas-propiedad")
      .upload(nombreArchivo, pdfBuffer, { contentType: "application/pdf", upsert: true });

    if (errorUpload) {
      throw new Error("Error al subir el PDF: " + errorUpload.message);
    }

    const { data: urlData } = supabase.storage
      .from("fichas-propiedad")
      .getPublicUrl(nombreArchivo);

    // Limpieza de archivos temporales
    fs.unlinkSync(dataFile);
    fs.unlinkSync(pdfFile);

    return res.status(200).json({ url: urlData.publicUrl });

  } catch (error) {
    try { if (fs.existsSync(dataFile)) fs.unlinkSync(dataFile); } catch {}
    try { if (fs.existsSync(pdfFile)) fs.unlinkSync(pdfFile); } catch {}
    console.error("Error generando ficha PDF:", error);
    return res.status(500).json({ error: error.message || "Error al generar el PDF" });
  }
}
