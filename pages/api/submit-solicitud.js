import { google } from "googleapis";
import { Readable } from "stream";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

const FOLDER_ID = "1989KmcCFWJ_k0vDM7AgDAhmE3OVrsSyiJJMFJspIDz3EfAYcjXUWIl9iq5KbJsJ-6VEe7PrM";

async function uploadFileToDrive(drive, base64File, fileName, mimeType) {
  if (!base64File) return null;
  const buffer = Buffer.from(base64File, "base64");
  const stream = Readable.from(buffer);
  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [FOLDER_ID],
    },
    media: {
      mimeType,
      body: stream,
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  return res.data.webViewLink;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
      ],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const drive = google.drive({ version: "v3", auth });
    const spreadsheetId = "1jufU_KEqOUzpWUq7mbfIxk5e-HT--IfnghpPxZJGqVs";

    const d = req.body;
    const now = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
    const nombre = d.nombre_completo || d.razon_social || "Solicitante";

    // Subir archivos a Drive
    const linkIdentidadFisica = await uploadFileToDrive(drive, d.file_identidad_fisica, `${nombre}_identidad_fisica_${Date.now()}`, d.file_identidad_fisica_type || "application/pdf");
    const linkIdentidadMoral = await uploadFileToDrive(drive, d.file_identidad_moral, `${nombre}_identidad_moral_${Date.now()}`, d.file_identidad_moral_type || "application/pdf");
    const linkIngresos = await uploadFileToDrive(drive, d.file_ingresos, `${nombre}_ingresos_${Date.now()}`, d.file_ingresos_type || "application/pdf");
    const linkEmpresa = await uploadFileToDrive(drive, d.file_empresa, `${nombre}_empresa_${Date.now()}`, d.file_empresa_type || "application/pdf");

    const row = [
      now,
      d.direccion_inmueble || "",
      d.monto_renta || "",
      d.tipo_solicitante || "",
      d.nombre_completo || "",
      d.telefono || "",
      d.email || "",
      d.curp || "",
      d.rfc || "",
      d.nacionalidad || "",
      d.es_extranjero || "",
      d.estatus_migratorio || "",
      d.estado_civil || "",
      d.nombre_conyuge || "",
      d.telefono_conyuge || "",
      d.domicilio_actual || "",
      d.razon_social || "",
      d.rfc_empresa || "",
      d.giro_empresa || "",
      d.domicilio_fiscal || "",
      d.nombre_representante || "",
      d.telefono_representante || "",
      d.email_representante || "",
      linkIdentidadFisica || "",
      linkIdentidadMoral || "",
      d.empresa_labora || "",
      d.giro_empresa_labora || "",
      d.pagina_web_empresa || "",
      d.domicilio_trabajo || "",
      d.telefono_trabajo || "",
      d.nombre_jefe || "",
      d.puesto_jefe || "",
      d.telefono_email_jefe || "",
      d.tipo_ingresos || "",
      d.ingresos_mensuales || "",
      linkIngresos || "",
      d.actividad_empresa || "",
      d.giro_comercial || "",
      d.pagina_web_empresa2 || "",
      d.origen_recursos || "",
      d.ingresos_empresa || "",
      linkEmpresa || "",
      d.uso_inmueble || "",
      d.descripcion_uso || "",
      d.subarrendamiento || "",
      d.nombre_arrendador || "",
      d.telefono_arrendador || "",
      d.monto_renta_actual || "",
      d.motivo_cambio || "",
      d.ref_fam1_nombre || "",
      d.ref_fam1_parentesco || "",
      d.ref_fam1_telefono || "",
      d.ref_fam2_nombre || "",
      d.ref_fam2_parentesco || "",
      d.ref_fam2_telefono || "",
      d.ref_fam3_nombre || "",
      d.ref_fam3_parentesco || "",
      d.ref_fam3_telefono || "",
      d.ref_per1_nombre || "",
      d.ref_per1_relacion || "",
      d.ref_per1_telefono || "",
      d.ref_per2_nombre || "",
      d.ref_per2_relacion || "",
      d.ref_per2_telefono || "",
      d.ref_per3_nombre || "",
      d.ref_per3_relacion || "",
      d.ref_per3_telefono || "",
      d.num_personas || "",
      d.personas_detalle || "",
      d.mascotas || "",
      d.mascotas_detalle || "",
      d.personal_servicio || "",
      d.personal_servicio_detalle || "",
    ];

    await sheets.spreadsheets.values.append({
  spreadsheetId,
  range: "A1",
  valueInputOption: "USER_ENTERED",
  insertDataOption: "INSERT_ROWS",
  resource: { values: [row] },
});
    // Email a jurídico
    const linksHtml = [
      linkIdentidadFisica ? `<tr><td style="padding:8px;color:#6b7280;font-size:12px;">ID Persona física</td><td style="padding:8px;"><a href="${linkIdentidadFisica}">Ver archivo</a></td></tr>` : "",
      linkIdentidadMoral ? `<tr style="background:#f9fafb;"><td style="padding:8px;color:#6b7280;font-size:12px;">ID Persona moral</td><td style="padding:8px;"><a href="${linkIdentidadMoral}">Ver archivo</a></td></tr>` : "",
      linkIngresos ? `<tr><td style="padding:8px;color:#6b7280;font-size:12px;">Documentos ingresos</td><td style="padding:8px;"><a href="${linkIngresos}">Ver archivo</a></td></tr>` : "",
      linkEmpresa ? `<tr style="background:#f9fafb;"><td style="padding:8px;color:#6b7280;font-size:12px;">Documentos empresa</td><td style="padding:8px;"><a href="${linkEmpresa}">Ver archivo</a></td></tr>` : "",
    ].join("");

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "InmoAdmin <cobros@emporioinmobiliario.com.mx>",
        to: ["carlos.nachon@emporioinmobiliario.mx", "juridico@emporioinmobiliario.mx"],
        subject: `📋 Nueva solicitud — ${nombre} — ${d.direccion_inmueble}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px;">
            <div style="background:#1a1a2e;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
              <h1 style="color:#c8a96e;margin:0;font-size:20px;">📋 Nueva Solicitud de Arrendamiento</h1>
            </div>
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;padding:28px;">
              <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                <tr><td style="padding:8px;font-weight:700;color:#6b7280;font-size:12px;text-transform:uppercase;">Inmueble</td><td style="padding:8px;font-weight:600;">${d.direccion_inmueble}</td></tr>
                <tr style="background:#f9fafb;"><td style="padding:8px;font-weight:700;color:#6b7280;font-size:12px;text-transform:uppercase;">Monto renta</td><td style="padding:8px;font-weight:600;">$${d.monto_renta}</td></tr>
                <tr><td style="padding:8px;font-weight:700;color:#6b7280;font-size:12px;text-transform:uppercase;">Solicitante</td><td style="padding:8px;font-weight:600;">${nombre}</td></tr>
                <tr style="background:#f9fafb;"><td style="padding:8px;font-weight:700;color:#6b7280;font-size:12px;text-transform:uppercase;">Tipo</td><td style="padding:8px;">${d.tipo_solicitante}</td></tr>
                <tr><td style="padding:8px;font-weight:700;color:#6b7280;font-size:12px;text-transform:uppercase;">Teléfono</td><td style="padding:8px;">${d.telefono}</td></tr>
                <tr style="background:#f9fafb;"><td style="padding:8px;font-weight:700;color:#6b7280;font-size:12px;text-transform:uppercase;">Email</td><td style="padding:8px;">${d.email}</td></tr>
                <tr><td style="padding:8px;font-weight:700;color:#6b7280;font-size:12px;text-transform:uppercase;">Ingresos</td><td style="padding:8px;">${d.ingresos_mensuales || d.ingresos_empresa || "—"}</td></tr>
              </table>
              ${linksHtml ? `
              <p style="font-weight:700;color:#1a1a2e;margin:0 0 8px;">📎 Documentos adjuntos:</p>
              <table style="width:100%;border-collapse:collapse;">${linksHtml}</table>
              ` : ""}
              <div style="margin-top:20px;padding:16px;background:#f0fdf4;border-radius:10px;text-align:center;">
                <p style="margin:0;font-size:13px;color:#065f46;font-weight:600;">✅ Datos completos en el Google Sheet de jurídico</p>
              </div>
            </div>
          </div>
        `,
      }),
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
