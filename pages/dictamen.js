import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";

const inp = {
  width: "100%", padding: "10px 14px", borderRadius: 8,
  border: "1.5px solid #e5e7eb", fontSize: 14, boxSizing: "border-box",
  fontFamily: "'Montserrat', sans-serif", color: "#1a1a2e", outline: "none",
  background: "#fff", transition: "border 0.15s",
};
const sel = { ...inp, cursor: "pointer" };
const txta = { ...inp, minHeight: 80, resize: "vertical" };

function Campo({ label, children, required }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}{required && <span style={{ color: "#C8102E" }}> *</span>}
      </label>
      {children}
    </div>
  );
}

function SecTitle({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "28px 0 20px" }}>
      <div style={{ width: 4, height: 18, background: "#C8102E", borderRadius: 2, flexShrink: 0 }} />
      <span style={{ fontSize: 11, fontWeight: 800, color: "#1a1a2e", letterSpacing: "0.15em", textTransform: "uppercase" }}>{children}</span>
      <div style={{ flex: 1, height: 1, background: "#f0f0f0" }} />
    </div>
  );
}

async function generarPDF(data, sb) {
  // Importar librerías
  const jspdfModule = await import("jspdf");
  const jsPDFClass = jspdfModule.jsPDF || (jspdfModule.default && jspdfModule.default.jsPDF) || jspdfModule.default;

  // Cargar html2canvas via script tag (no webpack)
  const html2canvas = await new Promise((resolve, reject) => {
    if (window.html2canvas) { resolve(window.html2canvas); return; }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    script.onload = () => resolve(window.html2canvas);
    script.onerror = reject;
    document.head.appendChild(script);
  });

  // Cargar logo
  let logoSrc = "https://www.emporioinmobiliario.com.mx/logo.png";

  const ROJO = "#b91c3c";
  const BORG = "#7f1d2e";
  const GR1  = "#4a4a4a";
  const GR2  = "#9ca3af";
  const GR3  = "#e5e7eb";

  const dict = data.dictamen || "APROBADO";
  const dictColor = dict === "APROBADO" ? "#065f46" : dict === "APROBADO CON CONDICIONES" ? "#92400e" : "#991b1b";
  const dictBg    = dict === "APROBADO" ? "#f0fdf4" : dict === "APROBADO CON CONDICIONES" ? "#fef9c3" : "#fee2e2";
  const dictBorder= dict === "APROBADO" ? "#6ee7b7" : dict === "APROBADO CON CONDICIONES" ? "#fde68a" : "#fca5a5";

  // Calcular score
  const rel = data.relacion_ingreso_renta || "";
  const multMatch = rel.match(/(\d+(?:\.\d+)?)x/);
  const mult = multMatch ? parseFloat(multMatch[1]) : 0;
  const scoreRaw = mult >= 4 ? 95 : mult >= 3 ? 80 : mult >= 2.5 ? 65 : mult >= 2 ? 60 : 35;
  // APROBADO nunca muestra PERFIL DE RIESGO
  const score = dict === "APROBADO" ? Math.max(scoreRaw, 70) : dict === "APROBADO CON CONDICIONES" ? Math.max(scoreRaw, 45) : scoreRaw;
  const scoreLabel = score >= 75 ? "PERFIL SÓLIDO" : score >= 55 ? "PERFIL ACEPTABLE" : "PERFIL DE RIESGO";
  const scoreColor = score >= 75 ? "#065f46" : score >= 55 ? "#92400e" : "#991b1b";

  const sinA = data.resultado_legal === "Sin antecedentes";

  // ── Helpers HTML ──────────────────────────────────────
  const campo = (label, value) => `
    <div style="margin-bottom:0">
      <div style="font-size:9px;font-weight:700;color:${GR2};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px">${label}</div>
      <div style="font-size:12px;font-weight:700;color:${GR1}">${value || "—"}</div>
    </div>`;

  const caja = (items, cols = 2) => `
    <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:10px;margin-bottom:10px">
      ${items.map(([l, v]) => `
        <div style="background:#fff;border:1px solid ${GR3};border-radius:8px;padding:10px 12px">
          ${campo(l, v)}
        </div>`).join("")}
    </div>`;

  const seccion = (num, titulo) => `
    <div style="display:flex;align-items:center;gap:10px;margin:22px 0 14px">
      <div style="width:28px;height:28px;border-radius:50%;background:${ROJO};color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0">${num}</div>
      <div style="font-size:11px;font-weight:800;color:${GR1};text-transform:uppercase;letter-spacing:0.08em">${titulo}</div>
      <div style="flex:1;height:1px;background:${GR3}"></div>
    </div>`;

  const cajaTexto = (label, value) => !value ? "" : `
    <div style="margin-bottom:12px">
      <div style="font-size:9px;font-weight:700;color:${GR2};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:5px">${label}</div>
      <div style="background:#fff;border:1px solid ${GR3};border-radius:8px;padding:12px;font-size:11px;color:${GR1};line-height:1.6">${value}</div>
    </div>`;

  // ── Semáforo HTML ─────────────────────────────────────
  const semItems = [
    { val: "APROBADO",                 lbl: "APROBADO",         icon: "✓", activeC: "#065f46", activeBg: "#dcfce7" },
    { val: "APROBADO CON CONDICIONES", lbl: "CON CONDICIONES",  icon: "!", activeC: "#92400e", activeBg: "#fef9c3" },
    { val: "NO APROBADO",              lbl: "NO APROBADO",      icon: "✗", activeC: "#991b1b", activeBg: "#fee2e2" },
  ];

  const semHTML = semItems.map(s => {
    const act = dict === s.val;
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;flex:1">
      <div style="width:52px;height:52px;border-radius:50%;
        background:${act ? s.activeBg : "#f3f4f6"};
        border:${act ? `2.5px solid ${s.activeC}` : `1.5px solid ${GR3}`};
        display:flex;align-items:center;justify-content:center;
        font-size:20px;font-weight:900;color:${act ? s.activeC : GR3}">
        ${s.icon}
      </div>
      <div style="font-size:10px;font-weight:${act ? 800 : 600};color:${act ? s.activeC : GR2}">${s.lbl}</div>
    </div>`;
  }).join("");

  // ── Documentos — migración automática base64 → Storage ──
  const docIdentRaw = data.doc_identificacion_b64 || data.doc_identificacion;
  const docCompRaw  = data.doc_comprobante_ingresos_b64 || data.doc_comprobante_ingresos;
  const docBuroRaw  = data.doc_buro_mexico || "";
  const solicitudId = data._solicitud_id || "";

  // sb viene como parámetro — es el cliente autenticado con la sesión activa

  const b64ToBlob = (b64) => {
    const [meta, data64] = b64.split(",");
    const mime = meta.match(/:(.*?);/)[1];
    const bytes = atob(data64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return { blob: new Blob([arr], { type: mime }), mime };
  };

  // Sube base64 a Storage si aún no está migrado, devuelve signed URL de 7 días
  const migrateAndSign = async (val, storagePath, dbField) => {
    if (!val) return "";
    // Ya es path de Storage — solo firmar
    if (!val.startsWith("data:")) {
      const { data: d } = await sb.storage.from("poliza-docs").createSignedUrl(val, 31536000);
      return d?.signedUrl || "";
    }
    // Es base64 — subir a Storage
    try {
      const { blob, mime } = b64ToBlob(val);
      const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "pdf";
      const path = `${storagePath}.${ext}`;
      await sb.storage.from("poliza-docs").remove([path]).catch(() => {});
      await sb.storage.from("poliza-docs").upload(path, blob, { contentType: mime });
      // Actualizar BD con el path para futuras generaciones
      if (solicitudId && dbField) {
        await sb.from("solicitudes_inquilino")
          .update({ [dbField]: path })
          .eq("id", solicitudId);
      }
      const { data: d } = await sb.storage.from("poliza-docs").createSignedUrl(path, 31536000);
      return d?.signedUrl || "";
    } catch { return ""; }
  };

  const [urlIdent, urlComp, urlBuro] = await Promise.all([
    migrateAndSign(docIdentRaw, `identificaciones/${solicitudId}`, "doc_identificacion"),
    migrateAndSign(docCompRaw,  `comprobantes/${solicitudId}`,     "doc_comprobante_ingresos"),
    migrateAndSign(docBuroRaw,  `buro/${solicitudId}`,             null), // buro ya se sube como path
  ]);

  const renderDocItem = (label, icono, url, disponible) => `
    <div style="display:flex;align-items:center;gap:14px;background:#fff;border:1px solid ${GR3};border-radius:10px;padding:14px 18px;margin-bottom:10px">
      <div style="width:40px;height:40px;border-radius:8px;background:${disponible ? '#f0fdf4' : '#f9fafb'};border:1px solid ${disponible ? '#6ee7b7' : GR3};display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">${icono}</div>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:700;color:${GR1}">${label}</div>
        <div style="font-size:10px;color:${GR2};margin-top:3px">${disponible ? 'Documento verificado y analizado' : 'No se adjuntó en esta solicitud'}</div>
      </div>
      <div style="font-size:11px;font-weight:800;color:${disponible ? '#065f46' : GR2};white-space:nowrap;margin-left:8px">${disponible ? '✓ PRESENTADO' : '— N/A'}</div>
    </div>`;

  const hayDocs = urlIdent || urlComp || urlBuro;

  // ── HTML COMPLETO ────────────────────────────────────
  const html = `
  <div style="width:794px;font-family:'Montserrat',system-ui,sans-serif;background:#f8f8f8;color:${GR1}">

    <!-- PORTADA — layout con padding fijo, sin flexbox vertical -->
    <div style="width:794px;height:1123px;background:#fff;position:relative;overflow:hidden;box-sizing:border-box">

      <!-- Franja roja superior -->
      <div style="position:absolute;top:0;left:0;right:0;height:6px;background:${ROJO}"></div>
      <div style="position:absolute;top:6px;left:0;right:0;height:2px;background:${BORG}"></div>

      <!-- Header -->
      <div style="position:absolute;top:18px;left:40px;right:40px;display:flex;justify-content:space-between;align-items:center">
        <img src="${logoSrc}" style="height:44px;object-fit:contain" crossorigin="anonymous" />
        <div style="text-align:right">
          <div style="font-size:9px;color:${GR2};font-weight:600;text-transform:uppercase;letter-spacing:0.08em">Folio</div>
          <div style="font-size:20px;font-weight:900;color:${ROJO};letter-spacing:0.05em">${data.folio || "—"}</div>
          <div style="font-size:10px;color:${GR2}">${data.fecha || ""}</div>
        </div>
      </div>

      <!-- Título área jurídica -->
      <div style="position:absolute;top:160px;left:40px;right:40px;text-align:center">
        <div style="font-size:9px;color:${GR2};font-weight:700;text-transform:uppercase;letter-spacing:0.15em;margin-bottom:6px">Emporio Inmobiliario · Área Jurídica</div>
        <div style="font-size:14px;font-weight:800;color:${GR1};text-transform:uppercase;letter-spacing:0.05em">Reporte de Investigación y Dictamen del Inquilino</div>
        <div style="font-size:9px;color:${GR2};margin-top:6px">Póliza Jurídica de Desalojo y Deslinde — Habitacional</div>
      </div>

      <!-- Línea divisora -->
      <div style="position:absolute;top:240px;left:40px;right:40px;height:1px;background:${GR3}"></div>

      <!-- Nombre solicitante -->
      <div style="position:absolute;top:260px;left:40px;right:40px;text-align:center">
        <div style="font-size:10px;color:${GR2};font-weight:600;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px">Solicitante</div>
        <div style="font-size:34px;font-weight:900;color:${GR1};line-height:1.1;margin-bottom:10px">${(data.nombre_solicitante || "—").toUpperCase()}</div>
        <div style="font-size:11px;color:${GR2}">${data.tipo_solicitante || "—"} · ${data.tipo_identificacion || "—"} · ${data.num_identificacion || "—"}</div>
      </div>

      <!-- Info rápida (3 cajas) -->
      <div style="position:absolute;top:430px;left:40px;right:40px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        ${[
          ["Inmueble", data.direccion_inmueble],
          ["Renta mensual", data.monto_renta],
          ["Fecha de emisión", data.fecha],
        ].map(([l,v]) => `
          <div style="background:#fff;border:1px solid ${GR3};border-radius:10px;padding:14px">
            <div style="font-size:8px;font-weight:700;color:${GR2};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:5px">${l}</div>
            <div style="font-size:11px;font-weight:700;color:${GR1}">${v || "—"}</div>
          </div>`).join("")}
      </div>

      <!-- Semáforo -->
      <div style="position:absolute;top:570px;left:40px;right:40px;background:#fff;border:1px solid ${GR3};border-radius:12px;padding:24px 40px">
        <div style="display:flex;justify-content:space-around;align-items:center">${semHTML}</div>
      </div>

      <!-- Score -->
      <div style="position:absolute;top:720px;left:40px;right:40px;background:#fff;border:1px solid ${GR3};border-radius:12px;padding:18px 20px">
        <div style="font-size:9px;font-weight:700;color:${GR2};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px">Índice de confianza del perfil</div>
        <div style="display:flex;align-items:center;gap:16px">
          <div style="font-size:13px;font-weight:900;color:${scoreColor};white-space:nowrap;min-width:140px">${scoreLabel}</div>
          <div style="flex:1;height:8px;background:${GR3};border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${score}%;background:${scoreColor};border-radius:4px"></div>
          </div>
          <div style="font-size:14px;font-weight:900;color:${scoreColor};min-width:36px;text-align:right">${score}%</div>
        </div>
      </div>

      <!-- Footer portada -->
      <div style="position:absolute;bottom:0;left:0;right:0;padding:14px 40px;border-top:1px solid ${GR3};display:flex;justify-content:space-between;align-items:center;background:#fff">
        <div style="font-size:9px;color:${GR2}">Emporio Inmobiliario · Reserva Territorial Atlixcayotl, San Andrés Cholula, Puebla · 222 257 3237</div>
        <div style="font-size:9px;font-weight:800;color:${ROJO};text-transform:uppercase;letter-spacing:0.1em">Confidencial</div>
      </div>

    </div>

    <!-- PÁGINAS DE CONTENIDO -->
    <div style="background:#fff;padding:32px 40px;min-height:1123px;page-break-after:always">
      
      <!-- Header interno -->
      <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;border-bottom:2px solid ${ROJO};margin-bottom:4px">
        <img src="${logoSrc}" style="height:28px;object-fit:contain" crossorigin="anonymous" />
        <div style="font-size:9px;color:${GR2};text-transform:uppercase;letter-spacing:0.08em">Reporte de Investigación y Dictamen</div>
        <div style="font-size:9px;font-weight:800;color:${ROJO}">${data.folio || ""}</div>
      </div>
      <div style="height:1.5px;background:${BORG};margin-bottom:20px"></div>

      ${seccion(1, "Datos Generales")}
      ${caja([["Nombre del solicitante", data.nombre_solicitante], ["Tipo de solicitante", data.tipo_solicitante]], 2)}
      ${caja([["Tipo de identificación", data.tipo_identificacion], ["Núm. de identificación", data.num_identificacion], ["Fecha de nacimiento", data.fecha_nacimiento]], 3)}
      ${caja([["RFC", data.rfc_solicitante || "—"], ["Estado civil", data.estado_civil || "—"], ["Cónyuge", data.conyuge || "—"]], 3)}
      ${caja([["Teléfono", data.telefono_inquilino], ["Correo electrónico", data.correo_inquilino], ["Tiempo en dom. anterior", data.tiempo_domicilio_anterior]], 3)}
      ${caja([["Domicilio anterior", data.domicilio_anterior], ["Nuevo inmueble", data.direccion_inmueble]], 2)}
      ${caja([["Monto de renta", data.monto_renta], ["Fecha de inicio", data.fecha_inicio], ["Tipo de solicitud", data.tipo_solicitante]], 3)}

      ${seccion(2, "Actividad y Fuente de Ingresos")}
      ${caja([["Actividad principal", data.actividad_principal], ["Fuente de ingresos", data.fuente_ingresos === "OTRA" ? `Otra: ${data.fuente_ingresos_otro}` : data.fuente_ingresos]], 2)}
      ${caja([["Empresa / Empleador", data.empresa], ["Teléfono RRHH", data.tel_empresa], ["Ingreso mensual", data.ingreso_mensual]], 3)}
      
      <!-- Relación ingreso/renta destacada -->
      <div style="background:#fff;border:1px solid ${GR3};border-left:4px solid ${ROJO};border-radius:8px;padding:12px 16px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:9px;font-weight:700;color:${GR2};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px">Relación Ingreso / Renta</div>
          <div style="font-size:13px;font-weight:800;color:${GR1}">${data.relacion_ingreso_renta || "—"}</div>
        </div>
        <div style="font-size:10px;color:${GR2}">Comprobante: ${data.comprobante_ingresos || "—"}</div>
      </div>

      ${seccion(3, "Uso del Inmueble / Ocupantes")}
      ${caja([["Uso declarado", data.uso_declarado], ["Núm. de ocupantes", data.num_ocupantes], ["Subarrendamiento", data.subarrendamiento || "No"]], 3)}
      ${caja([["Mascotas", data.mascotas === "Si — especificar" ? `Sí — ${data.mascotas_detalle}` : data.mascotas], ["Personal de servicio", data.personal_servicio], ["Modalidad", data.modalidad_servicio || "—"]], 3)}
      ${data.descripcion_uso ? cajaTexto("Descripción del uso", data.descripcion_uso) : ""}

      ${data.ref1_nombre || data.ref2_nombre ? `
        ${seccion(4, "Referencias Personales y Familiares")}
        ${data.ref1_nombre ? caja([["Referencia 1 — Nombre", data.ref1_nombre], ["Teléfono", data.ref1_telefono], ["Relación", data.ref1_relacion]], 3) : ""}
        ${data.ref2_nombre ? caja([["Referencia 2 — Nombre", data.ref2_nombre], ["Teléfono", data.ref2_telefono], ["Relación", data.ref2_relacion]], 3) : ""}
      ` : ""}

      ${seccion(5, "Antecedentes Legales — Buró México")}
      <div style="background:${sinA ? "#f0fdf4" : "#fee2e2"};border:1px solid ${sinA ? "#6ee7b7" : "#fca5a5"};border-left:4px solid ${sinA ? "#065f46" : "#991b1b"};border-radius:8px;padding:14px 16px;margin-bottom:10px">
        <div style="font-size:12px;font-weight:800;color:${sinA ? "#065f46" : "#991b1b"}">
          ${sinA ? "✓  Sin antecedentes legales relevantes" : "⚠  Con antecedentes — ver observaciones"}
        </div>
      </div>
      ${data.observaciones_legales ? cajaTexto("Observaciones", data.observaciones_legales) : ""}

      ${seccion(6, "Referencias e Historial / Revisión Legal")}
      ${cajaTexto("Historial de referencias", data.referencias)}
      ${cajaTexto("Revisión legal", data.revision_legal)}

      ${seccion(7, "Conclusión y Recomendación")}
      ${cajaTexto("Conclusión", data.conclusion)}
      ${data.observaciones_analista ? `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-left:4px solid #1e40af;border-radius:8px;padding:12px 16px;margin-bottom:10px">
          <div style="font-size:9px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Observaciones del analista</div>
          <div style="font-size:11px;color:#1e3a8a;line-height:1.6">${data.observaciones_analista}</div>
        </div>` : ""}

      ${seccion(8, "Dictamen Final")}
      <div style="background:${dictBg};border:1.5px solid ${dictBorder};border-left:5px solid ${dictColor};border-radius:10px;padding:20px;text-align:center;margin-bottom:10px">
        <div style="font-size:22px;font-weight:900;color:${dictColor};letter-spacing:0.05em">${dict}</div>
        ${data.condiciones ? `<div style="font-size:10px;color:${dictColor};margin-top:4px;opacity:0.8">Condiciones: ${data.condiciones}</div>` : ""}
      </div>

      <!-- Deslinde -->
      <div style="margin:16px 0 12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div style="width:4px;height:16px;background:${ROJO};border-radius:2px"></div>
          <div style="font-size:10px;font-weight:800;color:${ROJO};text-transform:uppercase;letter-spacing:0.08em">IX. Deslinde Legal</div>
        </div>
        <div style="font-size:9px;color:${GR2};line-height:1.7">
          El presente reporte y dictamen se emite con base en la información proporcionada por el solicitante y bajo un estándar de diligencia razonable, sin constituir garantía de pago ni sustituir resoluciones judiciales. Emporio Inmobiliario actúa como intermediario en la verificación de la información y no asume responsabilidad por datos incorrectos o incompletos proporcionados por el solicitante.
        </div>
      </div>

      <!-- Firma -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <div style="width:4px;height:16px;background:${ROJO};border-radius:2px"></div>
        <div style="font-size:10px;font-weight:800;color:${ROJO};text-transform:uppercase;letter-spacing:0.08em">X. Firma y Autorización</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div style="background:#fff;border:1px solid ${GR3};border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:9px;font-weight:700;color:${GR2};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:20px">Analista Responsable</div>
          <div style="border-top:1.5px solid ${GR1};padding-top:8px;margin-top:8px">
            <div style="font-size:11px;font-weight:800;color:${GR1}">${data.analista || "—"}</div>
            <div style="font-size:9px;color:${ROJO};margin-top:2px">Firma autorizada</div>
          </div>
        </div>
        <div style="background:#fff;border:1px solid ${GR3};border-radius:10px;padding:16px;text-align:center;display:flex;flex-direction:column;justify-content:center">
          <div style="font-size:9px;font-weight:700;color:${GR2};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Fecha de Emisión</div>
          <div style="font-size:18px;font-weight:900;color:${GR1}">${data.fecha || "—"}</div>
        </div>
        <div style="background:${ROJO};border-radius:10px;padding:16px;text-align:center;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:4px">
          <img src="${logoSrc}" style="height:32px;object-fit:contain;margin-bottom:6px" crossorigin="anonymous" />
          <div style="font-size:9px;color:rgba(255,255,255,0.8)">emporioinmobiliario.com.mx</div>
          <div style="font-size:10px;font-weight:800;color:#fff">222 257 3237</div>
          <div style="font-size:8px;color:rgba(255,255,255,0.8)">ventas@emporioinmobiliario.mx</div>
        </div>
      </div>

      <!-- Footer -->
      <div style="margin-top:24px;padding-top:12px;border-top:1px solid ${GR3};display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:8px;color:${GR2}">Emporio Inmobiliario · Reserva Territorial Atlixcayotl, San Andrés Cholula, Puebla · 222 257 3237 · ventas@emporioinmobiliario.mx</div>
      </div>
    </div>

    <!-- DOCUMENTOS ANALIZADOS -->
    <div style="background:#fff;padding:32px 40px;min-height:1123px">
      <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;border-bottom:2px solid ${ROJO};margin-bottom:4px">
        <img src="${logoSrc}" style="height:28px;object-fit:contain" crossorigin="anonymous" />
        <div style="font-size:9px;color:${GR2};text-transform:uppercase;letter-spacing:0.08em">Documentos Analizados</div>
        <div style="font-size:9px;font-weight:800;color:${ROJO}">${data.folio || ""}</div>
      </div>
      <div style="height:1.5px;background:${BORG};margin-bottom:24px"></div>

      <div style="margin-bottom:20px">
        <div style="font-size:13px;font-weight:800;color:${GR1};margin-bottom:4px">Documentación revisada durante la investigación</div>
        <div style="font-size:10px;color:${GR2}">Los siguientes documentos fueron recibidos y analizados por el Área Jurídica de Emporio Inmobiliario como parte del proceso de verificación del solicitante.</div>
      </div>

      ${renderDocItem("Identificación oficial — INE / Pasaporte / Cédula", "🪪", urlIdent, !!urlIdent)}
      ${renderDocItem("Comprobante de ingresos — Nómina / Estados de cuenta / CFDI", "💼", urlComp, !!urlComp)}
      ${renderDocItem("Reporte Buró México — Antecedentes crediticios y legales", "📋", urlBuro, !!urlBuro)}

      ${urlIdent || urlComp || urlBuro ? `
      <div style="margin-top:28px;background:#f0fdf4;border:1.5px solid #6ee7b7;border-radius:12px;padding:22px 24px">
        <div style="font-size:11px;font-weight:800;color:#065f46;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">🔗 Acceso digital a los documentos</div>
        <div style="font-size:10px;color:#374151;margin-bottom:16px">Para consultar los documentos originales, ingrese al siguiente enlace e introduzca el PIN de acceso.</div>
        <div style="background:#fff;border:1px solid #6ee7b7;border-radius:8px;padding:14px 18px;margin-bottom:12px">
          <div style="font-size:9px;font-weight:700;color:${GR2};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">Enlace</div>
          <div style="font-size:11px;font-weight:700;color:#1e40af">app.emporioinmobiliario.com.mx/poliza/docs/${data.folio || ""}</div>
        </div>
        <div style="background:#fff;border:1px solid #6ee7b7;border-radius:8px;padding:14px 18px">
          <div style="font-size:9px;font-weight:700;color:${GR2};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">PIN de acceso</div>
          <div style="font-size:22px;font-weight:900;color:${ROJO};letter-spacing:0.2em">${(data.folio || "").slice(-4)}</div>
        </div>
      </div>` : ""}

      <!-- Footer -->
      <div style="position:absolute;bottom:24px;left:40px;right:40px;padding-top:12px;border-top:1px solid ${GR3};display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:8px;color:${GR2}">Emporio Inmobiliario · Reserva Territorial Atlixcayotl, San Andrés Cholula, Puebla · 222 257 3237 · ventas@emporioinmobiliario.mx</div>
        <div style="font-size:8px;font-weight:800;color:${ROJO};text-transform:uppercase">Confidencial</div>
      </div>
    </div>

  </div>`;

  // ── Renderizar con html2canvas ────────────────────────
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-9999px;top:0;z-index:-1";
  container.innerHTML = `<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&display=swap" rel="stylesheet">${html}`;
  document.body.appendChild(container);

  // Esperar a que carguen fuentes e imágenes
  await new Promise(r => setTimeout(r, 1500));

  const doc = new jsPDFClass({ unit: "mm", format: "letter", orientation: "portrait" });
  const PAGE_H = 1123; // px altura de página carta a 96dpi
  const PAGE_W = 794;
  let pageIndex = 0;

  // Función para capturar cualquier elemento y agregarlo al PDF
  const addElementToDoc = async (el) => {
    const canvas = await html2canvas(el, {
      scale: 2, useCORS: true, allowTaint: false,
      backgroundColor: "#ffffff", width: PAGE_W,
    });
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    if (pageIndex > 0) doc.addPage();
    doc.addImage(imgData, "JPEG", 0, 0, 215.9, 279.4);
    pageIndex++;
  };

  // Función para paginar un div alto en múltiples páginas
  const addTallElementToDoc = async (el) => {
    const totalH = el.scrollHeight;
    const numPages = Math.ceil(totalH / PAGE_H);

    for (let p = 0; p < numPages; p++) {
      const canvas = await html2canvas(el, {
        scale: 2, useCORS: true, allowTaint: false,
        backgroundColor: "#ffffff",
        width: PAGE_W,
        height: PAGE_H,
        windowWidth: PAGE_W,
        windowHeight: PAGE_H,
        y: p * PAGE_H,
        scrollY: -(p * PAGE_H),
      });
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      if (pageIndex > 0) doc.addPage();
      doc.addImage(imgData, "JPEG", 0, 0, 215.9, 279.4);
      pageIndex++;
    }
  };

  // Portada (height fija 1123px)
  const portada = container.querySelector("div[style*='height:1123px']");
  if (portada) await addElementToDoc(portada);

  // Contenido (puede ser más alto que 1123px — paginar)
  const contenido = container.querySelector("div[style*='min-height:1123px'][style*='page-break-after']");
  if (contenido) await addTallElementToDoc(contenido);

  // Página de documentos (min-height:1123px sin page-break-after)
  const docsPage = container.querySelector("div[style*='min-height:1123px']:not([style*='page-break-after'])");
  if (docsPage) await addElementToDoc(docsPage);

  document.body.removeChild(container);
  return doc;
}
export default function Dictamen() {
  const router = useRouter();
  const [generando, setGenerando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [form, setForm] = useState({
    folio: "", fecha: new Date().toLocaleDateString("es-MX"),
    nombre_solicitante: "", tipo_solicitante: "PERSONA FÍSICA",
    tipo_identificacion: "INE", num_identificacion: "", fecha_nacimiento: "",
    telefono_inquilino: "", correo_inquilino: "",
    domicilio_anterior: "", tiempo_domicilio_anterior: "",
    direccion_inmueble: "", monto_renta: "", fecha_inicio: "",
    actividad_principal: "", fuente_ingresos: "NÓMINA", fuente_ingresos_otro: "",
    empresa: "", tel_empresa: "", ingreso_mensual: "",
    relacion_ingreso_renta: "Adecuada",
    comprobante_ingresos: "Sí — 3 recibos de nómina presentados",
    uso_declarado: "HABITACIONAL", descripcion_uso: "",
    num_ocupantes: "", mascotas: "No", mascotas_detalle: "",
    personal_servicio: "No", modalidad_servicio: "",
    ref1_nombre: "", ref1_telefono: "", ref1_relacion: "",
    ref2_nombre: "", ref2_telefono: "", ref2_relacion: "",
    resultado_legal: "Sin antecedentes", observaciones_legales: "",
    referencias: "Se revisaron referencias e historial de arrendamiento, no detectandose alertas relevantes para el propietario.",
    revision_legal: "Se realizo verificacion de identidad y consulta de antecedentes juridicos en plataforma BuroMexico. No se detectaron impedimentos legales, inconsistencias relevantes ni riesgos juridicos.",
    conclusion: "Derivado de la investigacion realizada, el perfil de los solicitantes resulta congruente con el inmueble y el monto de renta.",
    observaciones_analista: "",
    dictamen: "APROBADO", condiciones: "",
    analista: "LIC. ZAYETZY MONTES LUNA",
    doc_buro_mexico: "",
    _solicitud_id: "",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Pre-llenar desde solicitud si viene el query param
  useEffect(() => {
    const { solicitud_id } = router.query;
    if (!solicitud_id) return;
    setCargando(true);
    supabase.from("solicitudes_inquilino").select("*").eq("id", solicitud_id).single()
      .then(({ data: s }) => {
        if (!s) { setCargando(false); return; }
        const fmt = (n) => n ? `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2 })}` : "";
        const fmtFecha = (d) => {
          if (!d) return "";
          if (d.includes("/")) return d;
          return new Date(d + "T12:00:00").toLocaleDateString("es-MX");
        };
        // Calcular relacion ingreso/renta
        const ingresos = Number(s.ingresos_mensuales) || 0;
        const renta = Number(s.monto_renta_solicitada) || 0;
        let relacionIngresoRenta = "Adecuada";
        if (ingresos && renta) {
          const ratio = ingresos / renta;
          if (ratio >= 3) relacionIngresoRenta = "Adecuada — ingresos 3x el monto";
          else if (ratio >= 2.5) relacionIngresoRenta = "Adecuada — ingresos 2.5x el monto";
          else if (ratio >= 2) relacionIngresoRenta = "Adecuada — ingresos 2x el monto";
          else if (ratio >= 1.5) relacionIngresoRenta = "Ajustada";
          else relacionIngresoRenta = "Insuficiente";
        }
        // Mascotas
        let mascotas = "No";
        if (s.tiene_mascotas) mascotas = s.detalle_mascotas ? "Sí — especificar" : "Sí — perro";
        // Personal servicio
        let personalServicio = "No";
        if (s.personal_servicio) personalServicio = s.personal_servicio_detalle?.includes("planta") ? "Sí — de planta" : "Sí — entrada y salida";

        setForm(f => ({
          ...f,
          folio: solicitud_id.slice(0, 8).toUpperCase(),
          nombre_solicitante: s.nombre_completo || s.razon_social || "",
          tipo_solicitante: s.tipo_solicitante === "Persona moral" ? "PERSONA MORAL" : "PERSONA FÍSICA",
          num_identificacion: s.clave_elector || s.rfc || "",
          telefono_inquilino: s.telefono || s.telefono_representante || "",
          correo_inquilino: s.correo || s.email_representante || "",
          domicilio_anterior: s.domicilio_actual || "",
          direccion_inmueble: s.inmueble_interes || "",
          monto_renta: fmt(s.monto_renta_solicitada),
          fecha_inicio: fmtFecha(s.fecha_inicio_deseada),
          actividad_principal: s.ocupacion_arrendatario || s.giro_empresa_labora || "",
          empresa: s.empresa_labora || s.razon_social || "",
          tel_empresa: s.telefono_trabajo || "",
          ingreso_mensual: fmt(s.ingresos_mensuales || s.ingresos_empresa),
          relacion_ingreso_renta: relacionIngresoRenta,
          uso_declarado: s.uso_inmueble?.toUpperCase() || "HABITACIONAL",
          descripcion_uso: s.descripcion_uso || "",
          num_ocupantes: s.num_habitantes ? String(s.num_habitantes) + " personas" : "",
          mascotas,
          mascotas_detalle: s.detalle_mascotas || "",
          personal_servicio: personalServicio,
          ref1_nombre: s.ref_per1_nombre || s.ref_fam1_nombre || "",
          ref1_telefono: s.ref_per1_telefono || s.ref_fam1_telefono || "",
          ref1_relacion: s.ref_per1_relacion || s.ref_fam1_parentesco || "",
          ref2_nombre: s.ref_per2_nombre || s.ref_fam2_nombre || "",
          ref2_telefono: s.ref_per2_telefono || s.ref_fam2_telefono || "",
          ref2_relacion: s.ref_per2_relacion || s.ref_fam2_parentesco || "",
          doc_buro_mexico: s.doc_buro_mexico || "",
          doc_identificacion_b64: s.doc_identificacion_b64 || s.doc_identificacion || "",
          doc_comprobante_ingresos_b64: s.doc_comprobante_ingresos_b64 || s.doc_comprobante_ingresos || "",
          _solicitud_id: solicitud_id,
        }));
        setCargando(false);
      });
  }, [router.query]);

  const handleGenerar = async () => {
    if (!form.folio || !form.nombre_solicitante) { alert("Completa el Folio y Nombre del solicitante."); return; }
    setGenerando(true);
    try {
      const doc = await generarPDF(form, supabase);
      doc.save(`Dictamen_${form.folio}_${form.nombre_solicitante.split(" ")[0]}.pdf`);
      setGuardado(true); setTimeout(() => setGuardado(false), 3000);
    } catch (e) { alert("Error: " + e.message); }
    setGenerando(false);
  };

  const DOPTS = [
    { value: "APROBADO", color: "#22c55e", bg: "#dcfce7", tc: "#166534", icon: "✓", label: "APROBADO" },
    { value: "APROBADO CON CONDICIONES", color: "#eab308", bg: "#fef9c3", tc: "#854d0e", icon: "!", label: "CON CONDICIONES" },
    { value: "NO APROBADO", color: "#ef4444", bg: "#fee2e2", tc: "#991b1b", icon: "✗", label: "NO APROBADO" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", fontFamily: "'Montserrat',system-ui,sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&display=swap" rel="stylesheet" />

      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "16px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, color: "#C8102E", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Emporio Inmobiliario</p>
          <h1 style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 800, color: "#4a4a4a" }}>📋 Generador de Dictamen</h1>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9ca3af" }}>Poliza Juridica de Desalojo y Deslinde — Habitacional</p>
        </div>
        <a href="/" style={{ color: "#b91c3c", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>← Panel admin</a>
      </div>

      {cargando && (
        <div style={{ background: "#b91c3c", color: "#fff", padding: "12px 32px", textAlign: "center", fontWeight: 700, fontSize: 14 }}>
          ⏳ Cargando datos de la solicitud...
        </div>
      )}

      {router.query.solicitud_id && !cargando && (
        <div style={{ background: "#dcfce7", color: "#166534", padding: "12px 32px", textAlign: "center", fontWeight: 700, fontSize: 14 }}>
          ✅ Datos pre-llenados desde la solicitud — revisa y completa los campos necesarios
        </div>
      )}

      <div style={{ maxWidth: 980, margin: "0 auto", padding: "32px 20px" }}>

        <div style={{ background: "#fff", borderRadius: 20, padding: "28px 32px", marginBottom: 20, border: "1px solid #f0f0f0", boxShadow: "0 2px 16px rgba(0,0,0,0.04)" }}>
          <p style={{ margin: "0 0 20px", fontSize: 11, fontWeight: 800, color: "#C8102E", letterSpacing: "0.15em", textTransform: "uppercase" }}>Dictamen Final</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            {DOPTS.map(opt => (
              <button key={opt.value} onClick={() => set("dictamen", opt.value)} style={{
                padding: "20px 12px", borderRadius: 14, cursor: "pointer", textAlign: "center",
                border: form.dictamen === opt.value ? `2.5px solid ${opt.color}` : "2px solid #f3f4f6",
                background: form.dictamen === opt.value ? opt.bg : "#fafafa", transition: "all 0.2s",
              }}>
                <div style={{
                  width: 48, height: 48, borderRadius: "50%", margin: "0 auto 12px",
                  background: form.dictamen === opt.value ? opt.bg : "#f3f4f6",
                  border: form.dictamen === opt.value ? `3px solid ${opt.color}` : "2px solid #e5e7eb",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 22, fontWeight: 900, transition: "all 0.2s",
                  color: form.dictamen === opt.value ? opt.color : "#d1d5db"
                }}>{opt.icon}</div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: form.dictamen === opt.value ? opt.tc : "#9ca3af" }}>{opt.label}</p>
              </button>
            ))}
          </div>
          {form.dictamen === "APROBADO CON CONDICIONES" && (
            <div style={{ marginTop: 20 }}>
              <Campo label="Especifica las condiciones">
                <input value={form.condiciones} onChange={e => set("condiciones", e.target.value)} placeholder="Ej. Requiere aval adicional..." style={inp} />
              </Campo>
            </div>
          )}
        </div>

        <div style={{ background: "#fff", borderRadius: 20, padding: "28px 32px", border: "1px solid #f0f0f0", boxShadow: "0 2px 16px rgba(0,0,0,0.04)" }}>

          <SecTitle>I. Datos Generales</SecTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <Campo label="Folio" required><input value={form.folio} onChange={e => set("folio", e.target.value)} placeholder="E646" style={inp} /></Campo>
            <Campo label="Fecha"><input value={form.fecha} onChange={e => set("fecha", e.target.value)} style={inp} /></Campo>
            <Campo label="Tipo de solicitante"><select value={form.tipo_solicitante} onChange={e => set("tipo_solicitante", e.target.value)} style={sel}><option>PERSONA FÍSICA</option><option>PERSONA MORAL</option></select></Campo>
          </div>
          <Campo label="Nombre completo del solicitante" required><input value={form.nombre_solicitante} onChange={e => set("nombre_solicitante", e.target.value)} placeholder="Nombre completo tal como aparece en identificacion" style={inp} /></Campo>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <Campo label="Tipo de identificacion"><select value={form.tipo_identificacion} onChange={e => set("tipo_identificacion", e.target.value)} style={sel}><option>INE</option><option>Pasaporte</option><option>Cedula Profesional</option><option>Otro</option></select></Campo>
            <Campo label="Numero de identificacion"><input value={form.num_identificacion} onChange={e => set("num_identificacion", e.target.value)} placeholder="Clave de elector" style={inp} /></Campo>
            <Campo label="Fecha de nacimiento"><input value={form.fecha_nacimiento} onChange={e => set("fecha_nacimiento", e.target.value)} placeholder="DD/MM/AAAA" style={inp} /></Campo>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
           <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <Campo label="RFC"><input value={form.rfc_solicitante || ""} onChange={e => set("rfc_solicitante", e.target.value)} placeholder="XXXX000000XXX" style={inp} /></Campo>
            <Campo label="Estado civil">
              <select value={form.estado_civil || ""} onChange={e => set("estado_civil", e.target.value)} style={sel}>
                <option value="">— Selecciona —</option>
                <option>Soltero(a)</option>
                <option>Casado(a)</option>
                <option>Divorciado(a)</option>
                <option>Viudo(a)</option>
                <option>Unión libre</option>
              </select>
            </Campo>
            <Campo label="Nombre del cónyuge"><input value={form.conyuge || ""} onChange={e => set("conyuge", e.target.value)} placeholder="Solo si aplica" style={inp} /></Campo>
          </div>
            <Campo label="Telefono del inquilino"><input value={form.telefono_inquilino} onChange={e => set("telefono_inquilino", e.target.value)} placeholder="222 123 4567" style={inp} /></Campo>
            <Campo label="Correo electronico"><input value={form.correo_inquilino} onChange={e => set("correo_inquilino", e.target.value)} placeholder="inquilino@correo.com" style={inp} /></Campo>
          </div>
          {/* Subida de documentos si no vienen de la solicitud */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 4 }}>
            <Campo label={form.doc_identificacion_b64 ? "✓ Identificación subida por el cliente" : "Subir identificación oficial (si no la subió el cliente)"}>
              {!form.doc_identificacion_b64 ? (
                <input type="file" accept=".pdf,.jpg,.jpeg,.png"
                  onChange={async e => {
                    const file = e.target.files[0]; if (!file) return;
                    const ext = file.name.split(".").pop();
                    const path = `identificaciones/${solicitudId || "sin-id"}-${Date.now()}.${ext}`;
                    const { error } = await supabase.storage.from("poliza-docs").upload(path, file, { upsert: true });
                    if (!error) { set("doc_identificacion_b64", path); alert("✅ Identificación subida"); }
                    else alert("Error: " + error.message);
                  }}
                  style={{ ...inp, padding: "8px 12px", cursor: "pointer" }}
                />
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: "#065f46", fontWeight: 600, padding: "10px 0" }}>✓ Documento disponible</p>
              )}
            </Campo>
            <Campo label={form.doc_comprobante_ingresos_b64 ? "✓ Comprobante subido por el cliente" : "Subir comprobante de ingresos (si no lo subió el cliente)"}>
              {!form.doc_comprobante_ingresos_b64 ? (
                <input type="file" accept=".pdf,.jpg,.jpeg,.png"
                  onChange={async e => {
                    const file = e.target.files[0]; if (!file) return;
                    const ext = file.name.split(".").pop();
                    const path = `comprobantes/${solicitudId || "sin-id"}-${Date.now()}.${ext}`;
                    const { error } = await supabase.storage.from("poliza-docs").upload(path, file, { upsert: true });
                    if (!error) { set("doc_comprobante_ingresos_b64", path); alert("✅ Comprobante subido"); }
                    else alert("Error: " + error.message);
                  }}
                  style={{ ...inp, padding: "8px 12px", cursor: "pointer" }}
                />
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: "#065f46", fontWeight: 600, padding: "10px 0" }}>✓ Documento disponible</p>
              )}
            </Campo>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
            <Campo label="Domicilio anterior"><input value={form.domicilio_anterior} onChange={e => set("domicilio_anterior", e.target.value)} placeholder="Calle, numero, colonia, ciudad" style={inp} /></Campo>
            <Campo label="Tiempo vivido ahi"><input value={form.tiempo_domicilio_anterior} onChange={e => set("tiempo_domicilio_anterior", e.target.value)} placeholder="Ej. 2 anos" style={inp} /></Campo>
          </div>
          <Campo label="Direccion del inmueble a rentar" required><input value={form.direccion_inmueble} onChange={e => set("direccion_inmueble", e.target.value)} placeholder="Direccion completa" style={inp} /></Campo>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Campo label="Monto de renta mensual" required><input value={form.monto_renta} onChange={e => set("monto_renta", e.target.value)} placeholder="$16,000.00" style={inp} /></Campo>
            <Campo label="Fecha de inicio del contrato"><input value={form.fecha_inicio} onChange={e => set("fecha_inicio", e.target.value)} placeholder="01/05/2026" style={inp} /></Campo>
          </div>

          <SecTitle>II. Actividad y Fuente de Ingresos</SecTitle>
          <Campo label="Actividad principal"><input value={form.actividad_principal} onChange={e => set("actividad_principal", e.target.value)} placeholder="Profesion u ocupacion" style={inp} /></Campo>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <Campo label="Fuente de ingresos">
              <select value={form.fuente_ingresos} onChange={e => set("fuente_ingresos", e.target.value)} style={sel}>
                <option>NÓMINA</option><option>HONORARIOS</option><option>NEGOCIO PROPIO</option>
                <option>PENSIÓN</option><option>INVERSIONES</option><option>OTRA</option>
              </select>
            </Campo>
            <Campo label="Empresa / Empleador"><input value={form.empresa} onChange={e => set("empresa", e.target.value)} placeholder="Nombre de la empresa" style={inp} /></Campo>
            <Campo label="Telefono RRHH"><input value={form.tel_empresa} onChange={e => set("tel_empresa", e.target.value)} placeholder="222 000 0000" style={inp} /></Campo>
          </div>
          {form.fuente_ingresos === "OTRA" && (
            <Campo label="Especifica la fuente de ingresos">
              <input value={form.fuente_ingresos_otro} onChange={e => set("fuente_ingresos_otro", e.target.value)} placeholder="Describe la fuente de ingresos..." style={{ ...inp, borderColor: "#C8102E" }} />
            </Campo>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <Campo label="Ingreso mensual"><input value={form.ingreso_mensual} onChange={e => set("ingreso_mensual", e.target.value)} placeholder="$36,000.00" style={inp} /></Campo>
            <Campo label="Relacion ingreso-renta">
              <select value={form.relacion_ingreso_renta} onChange={e => set("relacion_ingreso_renta", e.target.value)} style={sel}>
                <option>Adecuada</option><option>Adecuada — ingresos 2x el monto</option>
                <option>Adecuada — ingresos 2.5x el monto</option><option>Adecuada — ingresos 3x el monto</option>
                <option>Ajustada</option><option>Insuficiente</option>
              </select>
            </Campo>
            <Campo label="Comprobante de ingresos">
              <select value={form.comprobante_ingresos} onChange={e => set("comprobante_ingresos", e.target.value)} style={sel}>
                <option>Sí — 3 recibos de nómina presentados</option><option>Sí — estados de cuenta</option>
                <option>Sí — declaracion fiscal</option><option>Parcial — documentacion incompleta</option>
                <option>No presentado</option>
              </select>
            </Campo>
          </div>

          <SecTitle>III. Uso del Inmueble y Ocupantes</SecTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Campo label="Uso declarado">
              <select value={form.uso_declarado} onChange={e => set("uso_declarado", e.target.value)} style={sel}>
                <option>HABITACIONAL</option><option>COMERCIAL</option><option>MIXTO</option>
              </select>
            </Campo>
            <Campo label="Descripcion del uso"><input value={form.descripcion_uso} onChange={e => set("descripcion_uso", e.target.value)} placeholder="Ej. Casa familiar..." style={inp} /></Campo>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <Campo label="Numero de ocupantes"><input value={form.num_ocupantes} onChange={e => set("num_ocupantes", e.target.value)} placeholder="Ej. 2 personas" style={inp} /></Campo>
            <Campo label="Mascotas">
              <select value={form.mascotas} onChange={e => set("mascotas", e.target.value)} style={sel}>
                <option>No</option><option>Sí — perro</option><option>Sí — gato</option><option>Sí — especificar</option>
              </select>
            </Campo>
            <Campo label="Personal de servicio">
              <select value={form.personal_servicio} onChange={e => set("personal_servicio", e.target.value)} style={sel}>
                <option>No</option><option>Sí — entrada y salida</option><option>Sí — de planta</option>
              </select>
            </Campo>
          </div>
          {form.mascotas === "Sí — especificar" && (
            <Campo label="Especifica las mascotas">
              <input value={form.mascotas_detalle} onChange={e => set("mascotas_detalle", e.target.value)} placeholder="Ej. 1 perro mediano, 2 gatos..." style={{ ...inp, borderColor: "#C8102E" }} />
            </Campo>
          )}

          <SecTitle>IV. Referencias Personales</SecTitle>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 16 }}>
            <Campo label="Referencia 1 — Nombre"><input value={form.ref1_nombre} onChange={e => set("ref1_nombre", e.target.value)} placeholder="Nombre completo" style={inp} /></Campo>
            <Campo label="Telefono"><input value={form.ref1_telefono} onChange={e => set("ref1_telefono", e.target.value)} placeholder="222 000 0000" style={inp} /></Campo>
            <Campo label="Relacion"><input value={form.ref1_relacion} onChange={e => set("ref1_relacion", e.target.value)} placeholder="Colega, familiar..." style={inp} /></Campo>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 16 }}>
            <Campo label="Referencia 2 — Nombre"><input value={form.ref2_nombre} onChange={e => set("ref2_nombre", e.target.value)} placeholder="Nombre completo" style={inp} /></Campo>
            <Campo label="Telefono"><input value={form.ref2_telefono} onChange={e => set("ref2_telefono", e.target.value)} placeholder="222 000 0000" style={inp} /></Campo>
            <Campo label="Relacion"><input value={form.ref2_relacion} onChange={e => set("ref2_relacion", e.target.value)} placeholder="Amigo, vecino..." style={inp} /></Campo>
          </div>

          <SecTitle>V. Antecedentes Legales — BuroMexico</SecTitle>
          <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
            {["Sin antecedentes", "Con antecedentes"].map(opt => (
              <button key={opt} onClick={() => set("resultado_legal", opt)} style={{
                flex: 1, padding: "14px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14,
                fontFamily: "'Montserrat',sans-serif", border: "2px solid", transition: "all 0.15s",
                borderColor: form.resultado_legal === opt ? (opt === "Sin antecedentes" ? "#22c55e" : "#ef4444") : "#e5e7eb",
                background: form.resultado_legal === opt ? (opt === "Sin antecedentes" ? "#dcfce7" : "#fee2e2") : "#fafafa",
                color: form.resultado_legal === opt ? (opt === "Sin antecedentes" ? "#166534" : "#991b1b") : "#9ca3af",
              }}>{opt === "Sin antecedentes" ? "✓ " : "⚠ "}{opt}</button>
            ))}
          </div>
          {form.resultado_legal === "Con antecedentes" && (
            <Campo label="Descripcion de antecedentes">
              <textarea value={form.observaciones_legales} onChange={e => set("observaciones_legales", e.target.value)} placeholder="Describe los antecedentes..." style={txta} />
            </Campo>
          )}

          <SecTitle>VI. Conclusion y Observaciones</SecTitle>
          <Campo label="Conclusion y recomendacion">
            <textarea value={form.conclusion} onChange={e => set("conclusion", e.target.value)} style={{ ...txta, minHeight: 90 }} />
          </Campo>
          <Campo label="Observaciones adicionales del analista">
            <textarea value={form.observaciones_analista} onChange={e => set("observaciones_analista", e.target.value)} placeholder="Notas adicionales, contexto relevante para el propietario..." style={txta} />
          </Campo>

          <SecTitle>VII. Firma</SecTitle>
          <Campo label="Analista responsable">
            <select value={form.analista} onChange={e => set("analista", e.target.value)} style={sel}>
              <option>LIC. ZAYETZY MONTES LUNA</option>
              <option>LIC. CARLOS NACHÓN</option>
              <option>OTRO</option>
            </select>
          </Campo>

          <div style={{ marginTop: 32, paddingTop: 24, borderTop: "2px solid #f3f4f6" }}>
            <button onClick={handleGenerar} disabled={generando} style={{
              width: "100%",
              background: guardado ? "#065f46" : generando ? "#9ca3af" : "#b91c3c",
              color: "#fff", border: "none", borderRadius: 14, padding: "18px",
              fontWeight: 900, fontSize: 17, cursor: generando ? "not-allowed" : "pointer",
              fontFamily: "'Montserrat',sans-serif", transition: "background 0.3s",
              boxShadow: "0 4px 16px rgba(185,28,60,0.25)",
            }}>
              {guardado ? "✅ PDF descargado correctamente" : generando ? "⏳ Generando PDF..." : "📄 Generar y Descargar Dictamen PDF"}
            </button>
            <p style={{ textAlign: "center", fontSize: 12, color: "#9ca3af", marginTop: 12, fontFamily: "'Montserrat',sans-serif" }}>
              Se descarga automaticamente · No requiere servidor · 100% en el navegador
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
