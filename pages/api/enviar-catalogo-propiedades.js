import { createClient } from "@supabase/supabase-js";
import { generarCatalogoPropiedadesPdf } from "../../lib/generarFichaPropiedadPdf";

// Cliente normal (anon key): usado para leer datos de propiedades.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Cliente con service role: necesario para subir a Storage e insertar en
// las tablas de registro de envíos desde el servidor (sin sesión de usuario).
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const fmt = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0 }).format(n || 0);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { propiedad_ids, usuario_id, destinatario_nombre, destinatario_correo, mensaje, cliente_id } = req.body;

  if (!Array.isArray(propiedad_ids) || propiedad_ids.length === 0) {
    return res.status(400).json({ error: "Falta la lista de propiedades (propiedad_ids)" });
  }
  if (!destinatario_correo || !destinatario_correo.includes("@")) {
    return res.status(400).json({ error: "Falta un correo de destinatario válido" });
  }

  // 1) Traer los datos de todas las propiedades seleccionadas
  const { data: propiedadesRaw, error: errorPropiedades } = await supabase
    .from("propiedades")
    .select("*")
    .in("id", propiedad_ids);

  if (errorPropiedades || !propiedadesRaw || propiedadesRaw.length === 0) {
    return res.status(404).json({ error: "No se encontraron las propiedades" });
  }

  // Mantener el mismo orden en el que el asesor las seleccionó
  const propiedades = propiedad_ids
    .map((id) => propiedadesRaw.find((p) => p.id === id))
    .filter(Boolean);

  // 2) Traer los datos de contacto del asesor que envía
  let contactoNombre = "Emporio Inmobiliario";
  let contactoTelefono = "222 257 3237";
  let contactoCorreo = "ventas@emporioinmobiliario.mx";

  if (usuario_id) {
    const { data: perfil } = await supabase
      .from("profiles")
      .select("full_name, email, telefono")
      .eq("id", usuario_id)
      .maybeSingle();
    if (perfil) {
      contactoNombre = perfil.full_name || contactoNombre;
      contactoTelefono = perfil.telefono || contactoTelefono;
      contactoCorreo = perfil.email || contactoCorreo;
    }
  }

  try {
    // 3) Armar los datos públicos de cada propiedad (mismo filtro de campos
    //    sensibles que en la ficha individual: nunca sale gravamen, notas
    //    internas, comisión, ubicación de llave, etc.)
    const datosPublicos = propiedades.map((p) => ({
      titulo: p.titulo,
      descripcion: p.descripcion,
      operacion: p.operacion,
      precio: p.precio,
      es_exclusiva: p.es_exclusiva,
      tipo: p.tipo,
      recamaras: p.recamaras,
      banos: p.banos,
      estacionamientos: p.estacionamientos,
      m2_construccion: p.m2_construccion,
      m2_terreno: p.m2_terreno,
      direccion: p.mostrar_ubicacion_exacta ? p.direccion : "",
      colonia: p.colonia,
      ciudad: p.ciudad,
      estado: p.estado,
      fotos: Array.isArray(p.fotos) ? p.fotos : [],
      amenidades: p.amenidades,
      creditos_aceptados: p.creditos_aceptados,
      public_id: p.public_id,
      url_publica: p.public_id ? `https://www.emporioinmobiliario.com.mx/propiedades/${p.public_id}` : "",
      contacto_nombre: contactoNombre,
      contacto_telefono: contactoTelefono,
      contacto_correo: contactoCorreo,
    }));

    // 4) Generar el catálogo (un PDF, una sección por propiedad)
    const pdfBuffer = await generarCatalogoPropiedadesPdf(datosPublicos);

    // 5) Subir a Storage (para tener un link de respaldo, además del adjunto)
    const nombreArchivo = `catalogo_${Date.now()}.pdf`;
    let pdfUrl = null;
    const { error: errorUpload } = await supabaseAdmin.storage
      .from("fichas-propiedad")
      .upload(nombreArchivo, pdfBuffer, { contentType: "application/pdf", upsert: true });
    if (!errorUpload) {
      const { data: urlData } = supabaseAdmin.storage.from("fichas-propiedad").getPublicUrl(nombreArchivo);
      pdfUrl = urlData.publicUrl;
    }

    // 6) Armar y enviar el correo vía Resend
    const listaPropiedadesHtml = propiedades
      .map((p) => `<li style="margin-bottom:6px;">${p.titulo} — <strong>${fmt(p.precio)}</strong></li>`)
      .join("");

    const mensajePersonalizado = mensaje
      ? `<p style="white-space:pre-wrap;">${mensaje}</p>`
      : `<p>Te comparto las siguientes opciones que pueden interesarte:</p>`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
        <div style="background:#C8102E; height:4px; margin-bottom:20px;"></div>
        <p>Hola ${destinatario_nombre || ""},</p>
        ${mensajePersonalizado}
        <ul style="padding-left:18px;">${listaPropiedadesHtml}</ul>
        <p>Adjunto te comparto el catálogo completo con todos los detalles y fotos.</p>
        <p style="margin-top:24px;">Saludos,<br/><strong>${contactoNombre}</strong><br/>${contactoTelefono}<br/>${contactoCorreo}</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;"/>
        <p style="font-size:11px;color:#9ca3af;">
          La información presentada es de carácter informativo y referencial; no constituye una oferta vinculante.
          En cumplimiento de la normatividad de PROFECO en materia de publicidad inmobiliaria, Emporio Inmobiliario
          se compromete a que la información aquí mostrada sea veraz y comprobable.
        </p>
      </div>`;

    const asunto = propiedades.length === 1
      ? propiedades[0].titulo
      : `${propiedades.length} propiedades de tu interés — Emporio Inmobiliario`;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Emporio Inmobiliario <ventas@emporioinmobiliario.com.mx>",
        to: [destinatario_correo],
        reply_to: contactoCorreo,
        subject: asunto,
        html,
        attachments: [
          {
            filename: propiedades.length === 1 ? "ficha-propiedad.pdf" : "catalogo-propiedades.pdf",
            content: pdfBuffer.toString("base64"),
          },
        ],
      }),
    });

    if (!resendResponse.ok) {
      const errorBody = await resendResponse.text();
      throw new Error("Error al enviar el correo: " + errorBody);
    }

    // 7) Registrar el envío para alimentar el futuro reporte a propietarios
    const { data: envio, error: errorEnvio } = await supabaseAdmin
      .from("envios")
      .insert({
        asesor_id: usuario_id || null,
        asesor_nombre: contactoNombre,
        destinatario_nombre,
        destinatario_correo,
        medio: "correo",
        mensaje,
        pdf_url: pdfUrl,
      })
      .select()
      .single();

    if (!errorEnvio && envio) {
      const filas = propiedades.map((p) => ({ envio_id: envio.id, propiedad_id: p.id }));
      await supabaseAdmin.from("envios_propiedades").insert(filas);
    }

    // 8) Si el envío fue desde la ficha de un cliente, sumar la entrada a
    //    su bitácora de seguimientos automáticamente.
    if (cliente_id) {
      const listaTitulos = propiedades.map((p) => p.titulo).join(", ");
      await supabaseAdmin.from("seguimientos_cliente").insert({
        cliente_id,
        asesor_id: usuario_id || null,
        nota: `Se envió por correo: ${listaTitulos}`,
        tipo: "envio_correo",
      });
    }

    return res.status(200).json({ ok: true, pdf_url: pdfUrl });

  } catch (error) {
    console.error("Error enviando catálogo de propiedades:", error);
    return res.status(500).json({ error: error.message || "Error al enviar el correo" });
  }
}
