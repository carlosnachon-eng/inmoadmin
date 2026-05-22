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

async function generarPDF(data) {
  // Importar librerías
  const jspdfModule = await import("jspdf");
  const jsPDFClass = jspdfModule.jsPDF || (jspdfModule.default && jspdfModule.default.jsPDF) || jspdfModule.default;
  const html2canvas = (await import("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js")).default;

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
  const score = mult >= 4 ? 95 : mult >= 3 ? 80 : mult >= 2.5 ? 65 : mult >= 2 ? 50 : 35;
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

  // ── Documentos ───────────────────────────────────────
  const docIdent = data.doc_identificacion_b64 || data.doc_identificacion;
  const docComp  = data.doc_comprobante_ingresos_b64 || data.doc_comprobante_ingresos;

  const renderDocHTML = (b64, titulo) => {
    if (!b64) return "";
    const isImg = b64.startsWith("data:image/");
    return `
      <div style="margin-bottom:16px">
        <div style="font-size:9px;font-weight:700;color:${GR2};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">${titulo}</div>
        ${isImg
          ? `<img src="${b64}" style="width:100%;max-height:200px;object-fit:contain;border:1px solid ${GR3};border-radius:8px;background:#fafafa" />`
          : `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;text-align:center;color:#1e40af;font-weight:700;font-size:12px">
              📄 DOCUMENTO PDF ADJUNTO<br><span style="font-size:10px;font-weight:400;color:#6b7280;margin-top:4px;display:block">${titulo}</span>
            </div>`
        }
      </div>`;
  };

  // ── HTML COMPLETO ────────────────────────────────────
  const html = `
  <div style="width:794px;font-family:'Montserrat',system-ui,sans-serif;background:#f8f8f8;color:${GR1}">

    <!-- PORTADA -->
    <div style="background:#fff;min-height:1123px;position:relative;display:flex;flex-direction:column;page-break-after:always">
      
      <!-- Header portada -->
      <div style="padding:24px 40px 20px;border-bottom:3px solid ${ROJO};position:relative">
        <div style="position:absolute;bottom:0;left:0;right:0;height:1.5px;background:${BORG};margin-top:3px"></div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <img src="${logoSrc}" style="height:44px;object-fit:contain" crossorigin="anonymous" />
          <div style="text-align:right">
            <div style="font-size:9px;color:${GR2};font-weight:600;text-transform:uppercase;letter-spacing:0.08em">Folio</div>
            <div style="font-size:20px;font-weight:900;color:${ROJO};letter-spacing:0.05em">${data.folio || "—"}</div>
            <div style="font-size:10px;color:${GR2}">${data.fecha || ""}</div>
          </div>
        </div>
      </div>

      <!-- Cuerpo portada -->
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:0 60px;gap:32px">
        
        <!-- Área jurídica -->
        <div style="text-align:center">
          <div style="font-size:9px;color:${GR2};font-weight:700;text-transform:uppercase;letter-spacing:0.15em;margin-bottom:4px">Emporio Inmobiliario · Área Jurídica</div>
          <div style="font-size:13px;font-weight:800;color:${GR1};text-transform:uppercase;letter-spacing:0.05em">Reporte de Investigación y Dictamen del Inquilino</div>
          <div style="font-size:9px;color:${GR2};margin-top:4px">Póliza Jurídica de Desalojo y Deslinde — Habitacional</div>
        </div>

        <div style="height:1px;background:${GR3}"></div>

        <!-- Nombre solicitante -->
        <div style="text-align:center">
          <div style="font-size:10px;color:${GR2};font-weight:600;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">Solicitante</div>
          <div style="font-size:32px;font-weight:900;color:${GR1};line-height:1.1;margin-bottom:8px">${(data.nombre_solicitante || "—").toUpperCase()}</div>
          <div style="font-size:11px;color:${GR2}">${data.tipo_solicitante || "—"} · ${data.tipo_identificacion || "—"} · ${data.num_identificacion || "—"}</div>
        </div>

        <!-- Info rápida -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
          ${[
            ["Inmueble", data.direccion_inmueble],
            ["Renta mensual", data.monto_renta],
            ["Fecha de emisión", data.fecha],
          ].map(([l,v]) => `
            <div style="background:#fff;border:1px solid ${GR3};border-radius:10px;padding:14px">
              <div style="font-size:8px;font-weight:700;color:${GR2};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">${l}</div>
              <div style="font-size:11px;font-weight:700;color:${GR1}">${v || "—"}</div>
            </div>`).join("")}
        </div>

        <!-- Semáforo -->
        <div style="background:#fff;border:1px solid ${GR3};border-radius:12px;padding:24px 40px">
          <div style="display:flex;justify-content:space-around;align-items:center">${semHTML}</div>
        </div>

        <!-- Score -->
        <div style="background:#fff;border:1px solid ${GR3};border-radius:12px;padding:16px 20px">
          <div style="font-size:9px;font-weight:700;color:${GR2};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Índice de confianza del perfil</div>
          <div style="display:flex;align-items:center;gap:16px">
            <div style="font-size:14px;font-weight:900;color:${scoreColor};white-space:nowrap">${scoreLabel}</div>
            <div style="flex:1;height:8px;background:${GR3};border-radius:4px;overflow:hidden">
              <div style="height:100%;width:${score}%;background:${scoreColor};border-radius:4px"></div>
            </div>
            <div style="font-size:14px;font-weight:900;color:${scoreColor}">${score}%</div>
          </div>
        </div>

      </div>

      <!-- Footer portada -->
      <div style="padding:14px 40px;border-top:1px solid ${GR3};display:flex;justify-content:space-between;align-items:center">
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

    ${(docIdent || docComp) ? `
    <!-- DOCUMENTOS -->
    <div style="background:#fff;padding:32px 40px;min-height:1123px">
      <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;border-bottom:2px solid ${ROJO};margin-bottom:4px">
        <img src="${logoSrc}" style="height:28px;object-fit:contain" crossorigin="anonymous" />
        <div style="font-size:9px;color:${GR2};text-transform:uppercase;letter-spacing:0.08em">Documentos Adjuntos</div>
        <div style="font-size:9px;font-weight:800;color:${ROJO}">${data.folio || ""}</div>
      </div>
      <div style="height:1.5px;background:${BORG};margin-bottom:20px"></div>
      <div style="font-size:10px;color:${GR2};margin-bottom:16px">Los siguientes documentos fueron presentados por el solicitante como parte de la investigación.</div>
      ${renderDocHTML(docIdent, "Identificación oficial — INE / Pasaporte / Cédula")}
      ${docComp ? `<div style="margin-top:16px">${renderDocHTML(docComp, "Comprobante de ingresos — Nómina / Estados de cuenta / CFDI")}</div>` : ""}
    </div>` : ""}

  </div>`;

  // ── Renderizar con html2canvas ────────────────────────
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-9999px;top:0;z-index:-1";
  container.innerHTML = `<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&display=swap" rel="stylesheet">${html}`;
  document.body.appendChild(container);

  // Esperar a que carguen fuentes e imágenes
  await new Promise(r => setTimeout(r, 1500));

  const pages = container.querySelectorAll("div[style*='min-height:1123px'], div[style*='min-height: 1123px']");
  const doc = new jsPDFClass({ unit: "mm", format: "letter", orientation: "portrait" });

  for (let i = 0; i < pages.length; i++) {
    const canvas = await html2canvas(pages[i], {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#ffffff",
      width: 794,
    });
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    if (i > 0) doc.addPage();
    doc.addImage(imgData, "JPEG", 0, 0, 215.9, 279.4);
  }

  document.body.removeChild(container);
  return doc;
}
