import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../lib/supabase";
import { PageHeader, brand } from "../../components/Layout";
import jsPDF from "jspdf";
import { FIRMA_CARLOS_B64 } from "../../lib/firmaCarlos";

const fmt = (n) => "$" + Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2 });
const fmtFecha = (d) => new Date(d + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });

// ── Helpers PDF ───────────────────────────────────────────────
function wrapText(doc, text, x, y, maxW, lh, size) {
  doc.setFontSize(size);
  const words = text.split(" ");
  let line = "", cy = y;
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (doc.getTextWidth(test) <= maxW) { line = test; }
    else { doc.text(line, x, cy); cy += lh; line = w; }
  }
  if (line) { doc.text(line, x, cy); cy += lh; }
  return cy;
}

async function getLogoB64() {
  try {
    const res = await fetch("https://www.emporioinmobiliario.com.mx/logo.png");
    const blob = await res.blob();
    return await new Promise(r => { const fr = new FileReader(); fr.onloadend = () => r(fr.result); fr.readAsDataURL(blob); });
  } catch(_) { return null; }
}

async function getQRB64(text) {
  try {
    const res = await fetch(`https://quickchart.io/qr?text=${encodeURIComponent(text)}&size=80&margin=1`);
    const blob = await res.blob();
    return await new Promise(r => { const fr = new FileReader(); fr.onloadend = () => r(fr.result); fr.readAsDataURL(blob); });
  } catch(_) { return null; }
}

function baseDoc(logoB64) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = 612, H = 792, M = 42;
  const RED = [185,28,60], DARK = [26,26,46], GRAY = [120,120,120], LGRAY = [247,247,247], LINE = [220,220,220];

  // Top bar
  doc.setFillColor(...RED); doc.rect(0, 0, W, 6, "F");
  // Logo
  if (logoB64) doc.addImage(logoB64, "PNG", M, 10, 110, Math.round(110*(959/1801)));
  // Bottom bar
  doc.setFillColor(...RED); doc.rect(0, H-6, W, 6, "F");
  doc.setFont("helvetica","normal"); doc.setFontSize(6.5); doc.setTextColor(...GRAY);
  doc.text("emporioinmobiliario.com.mx  |  (222) 257-3237  |  ventas@emporioinmobiliario.mx", W/2-30, H-10, {align:"center"});

  return { doc, W, H, M, RED, DARK, GRAY, LGRAY, LINE };
}

function addFirma(doc, M, y, firma) {
  if (firma) {
    try { doc.addImage(firma, "PNG", M, y+2, 90, 50); } catch(_) {}
  }
  doc.setDrawColor(204,204,204); doc.setLineWidth(0.8);
  doc.line(M, y+54, M+180, y+54);
  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(26,26,46);
  doc.text("Carlos Alejandro Nachón Saldivar", M, y+64);
  doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(120,120,120);
  doc.text("Administrador Único — Emporio Inmobiliario", M, y+74);
}

// ── PDF 1: Carta de Intención de Compra ──────────────────────
async function generarIntencion(carta, logoB64) {
  const { doc, W, H, M, RED, DARK, GRAY, LGRAY, LINE } = baseDoc(logoB64);

  // Título
  const logoH = Math.round(110*(959/1801));
  const divY = 10 + logoH + 8;
  doc.setDrawColor(...RED); doc.setLineWidth(2); doc.line(M, divY, W-M, divY);
  let y = divY + 20;
  doc.setFont("helvetica","bold"); doc.setFontSize(13); doc.setTextColor(...DARK);
  doc.text("CARTA DE INTENCIÓN DE COMPRA", W/2, y, {align:"center"});
  y += 13;
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...GRAY);
  doc.text("Oferta de adquisición de inmueble", W/2, y, {align:"center"});
  y += 10;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.5); doc.line(M, y, W-M, y); y += 16;

  // Datos ofertante
  doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...RED);
  doc.text("DATOS DEL OFERTANTE", M, y); y += 12;
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
  doc.text("Nombre:", M, y); doc.setFont("helvetica","bold"); doc.setTextColor(...DARK);
  doc.text(carta.cliente_nombre, M+50, y);
  if (carta.cliente_tel) {
    doc.setFont("helvetica","normal"); doc.setTextColor(...GRAY);
    doc.text("Tel:", W/2, y); doc.setFont("helvetica","bold"); doc.setTextColor(...DARK);
    doc.text(carta.cliente_tel, W/2+20, y);
  }
  y += 20;

  // Inmueble
  doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...RED);
  doc.text("INMUEBLE DE INTERÉS", M, y); y += 12;
  doc.setFillColor(...[253,240,241]); doc.rect(M, y, W-2*M, 28, "F");
  doc.setFillColor(...RED); doc.rect(M, y, 4, 28, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...DARK);
  doc.text(carta.inmueble.split(",")[0].trim(), M+12, y+12);
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
  const resto = carta.inmueble.split(",").slice(1).join(",").trim();
  if (resto) doc.text(resto, M+12, y+23);
  y += 38;

  // Oferta
  doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...RED);
  doc.text("OFERTA ECONÓMICA", M, y); y += 12;
  doc.setFillColor(...RED); doc.rect(M, y, W-2*M, 56, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(255,255,255);
  doc.text("PRECIO OFERTADO", W/2, y+13, {align:"center"});
  doc.setFont("helvetica","bold"); doc.setFontSize(28);
  doc.text(fmt(carta.precio_oferta), W/2, y+37, {align:"center"});
  doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(255,204,204);
  y += 66;

  // Condiciones
  doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...RED);
  doc.text("ESQUEMA DE PAGO", M, y);
  y += 6; doc.setDrawColor(...LINE); doc.setLineWidth(0.5); doc.line(M, y, W-M, y); y += 10;

  const conds = [
    ["Apartado:", fmt(carta.apartado), "Al aceptar la oferta por escrito"],
    ["Enganche:", carta.enganche ? fmt(carta.enganche) : "Por acordar", "A la firma del contrato de promesa"],
    ["Saldo restante:", carta.saldo ? fmt(carta.saldo) : "Por acordar", "A la firma de la escritura"],
    ["Forma de pago:", carta.forma_pago, ""],
  ];
  for (let i = 0; i < conds.length; i++) {
    const [lbl, val, desc] = conds[i];
    doc.setFillColor(...(i%2===0 ? LGRAY : [255,255,255]));
    doc.rect(M, y-13, W-2*M, 18, "F");
    doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
    doc.text(lbl, M+4, y-4);
    doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(...DARK);
    doc.text(val, M+110, y-4);
    if (desc) { doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...GRAY); doc.text(desc, M+260, y-4); }
    y += 18;
  }
  y += 10;

  // Declaración
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
  y = wrapText(doc, "Por propia voluntad y con capacidad legal, manifiesto mi interés formal en adquirir el inmueble descrito, comprometiéndome a formalizar el proceso bajo las condiciones acordadas. Declaro que los recursos utilizados provienen de actividades lícitas.", M, y, W-2*M-8, 10, 8);
  y += 10;

  // Firma comprador
  doc.setDrawColor(...LINE); doc.setLineWidth(0.5); doc.line(M, y, W-M, y); y += 12;
  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...DARK);
  doc.text("Nombre y firma del ofertante", W/2+20, y);
  doc.setDrawColor(204,204,204); doc.setLineWidth(0.8);
  doc.line(W/2+20, y+28, W/2+20+180, y+28);
  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...DARK);
  doc.text(carta.cliente_nombre, W/2+20, y+38);
  doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...GRAY);
  doc.text("Fecha: ___________________________", W/2+20, y+48);

  return doc;
}

// ── PDF 2: Carta de Presentación de Oferta ───────────────────
async function generarPresentacion(carta, logoB64, qrB64) {
  const { doc, W, H, M, RED, DARK, GRAY, LGRAY, LINE } = baseDoc(logoB64);
  const logoH = Math.round(110*(959/1801));

  // Fecha top right
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
  doc.text("San Andrés Cholula, Puebla", W-M-155, 22);
  doc.text(fmtFecha(carta.fecha), W-M-155, 33);

  const divY = 10 + logoH + 8;
  doc.setDrawColor(...RED); doc.setLineWidth(2); doc.line(M, divY, W-M, divY);
  let y = divY + 20;

  doc.setFont("helvetica","bold"); doc.setFontSize(13); doc.setTextColor(...DARK);
  doc.text("CARTA DE PRESENTACIÓN DE OFERTA", W/2, y, {align:"center"});
  y += 13;
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...GRAY);
  doc.text("Carta de Intención de Compra", W/2, y, {align:"center"});
  y += 10;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.5); doc.line(M, y, W-M, y); y += 16;

  // Destinatarios
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...GRAY);
  doc.text("Estimados propietarios:", M, y); y += 13;
  doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(...RED);
  doc.text(carta.propietarios, M, y); y += 18;

  // Cuerpo
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...DARK);
  doc.text("Por medio de la presente, nos permitimos informarles que hemos recibido una ", M, y);
  const bw = doc.getTextWidth("Por medio de la presente, nos permitimos informarles que hemos recibido una ");
  doc.setFont("helvetica","bold"); doc.text("Carta de Intención de Compra", M+bw, y);
  y += 12;
  doc.setFont("helvetica","normal"); doc.text("respecto a su inmueble ubicado en:", M, y); y += 12;

  // Dirección
  doc.setFillColor(...[253,240,241]); doc.rect(M, y, W-2*M, 34, "F");
  doc.setFillColor(...RED); doc.rect(M, y, 4, 34, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...DARK);
  doc.text(carta.inmueble.split(",")[0].trim(), M+12, y+13);
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...GRAY);
  const restoDir = carta.inmueble.split(",").slice(1).join(",").trim();
  if (restoDir) doc.text(restoDir, M+12, y+26);
  y += 44;

  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...DARK);
  const pre = "La persona interesada en la adquisición es la ";
  doc.text(pre, M, y);
  const pw = doc.getTextWidth(pre);
  doc.setFont("helvetica","bold"); doc.setTextColor(...RED);
  doc.text(carta.cliente_nombre, M+pw, y);
  doc.setFont("helvetica","normal"); doc.setTextColor(...DARK);
  doc.text(", quien presenta la siguiente propuesta:", M+pw+doc.getTextWidth(carta.cliente_nombre), y);
  y += 20;

  // Precio box
  doc.setFillColor(...RED); doc.rect(M, y, W-2*M, 62, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(255,255,255);
  doc.text("PRECIO OFERTADO", W/2, y+14, {align:"center"});
  doc.setFont("helvetica","bold"); doc.setFontSize(30);
  doc.text(fmt(carta.precio_oferta), W/2, y+40, {align:"center"});
  y += 72;

  // Condiciones
  doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...RED);
  doc.text("CONDICIONES DE LA OFERTA", M, y);
  y += 6; doc.setDrawColor(...LINE); doc.setLineWidth(0.5); doc.line(M, y, W-M, y); y += 10;

  const conds = [
    ["Apartado:", fmt(carta.apartado), "A cubrir una vez que los propietarios acepten la oferta."],
    ["Enganche:", carta.enganche ? fmt(carta.enganche) : "Por acordar", "Pagadero a la firma del contrato de promesa de compraventa."],
    ["Saldo restante:", carta.saldo ? fmt(carta.saldo) : "Por acordar", "A la firma de la escritura correspondiente."],
    ["Forma de pago:", carta.forma_pago, ""],
  ];
  for (let i = 0; i < conds.length; i++) {
    const [lbl, val, desc] = conds[i];
    doc.setFillColor(...(i%2===0 ? LGRAY : [255,255,255]));
    doc.rect(M, y-13, W-2*M, 18, "F");
    doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
    doc.text(lbl, M+4, y);
    doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(...DARK);
    doc.text(val, M+110, y);
    if (desc) { doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...GRAY); doc.text(desc, M+255, y); }
    y += 18;
  }
  y += 10;

  doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...GRAY);
  y = wrapText(doc, "La propuesta se encuentra formalizada por escrito y firmada por la persona interesada, por lo que la ponemos a su consideración para su análisis y, en su caso, aceptación. Quedamos atentos a sus comentarios.", M, y, W-2*M, 12, 8.5);
  y += 16;

  // Línea + firma
  doc.setDrawColor(...RED); doc.setLineWidth(1.5); doc.line(M, y, W-M, y); y += 13;
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
  doc.text("Atentamente,", M, y); y += 12;
  doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(...RED);
  doc.text("EMPORIO INMOBILIARIO", M, y); y += 22;
  addFirma(doc, M, y, FIRMA_CARLOS_B64);

  // QR
  if (qrB64) {
    doc.addImage(qrB64, "PNG", W-M-58, H-70, 55, 55);
    doc.setFont("helvetica","normal"); doc.setFontSize(6); doc.setTextColor(...GRAY);
    doc.text("Verificar documento", W-M-29, H-12, {align:"center"});
  }

  return doc;
}

// ── PDF 3: Carta de Respuesta (contraoferta/aceptación) ───────
async function generarRespuesta(carta, logoB64, qrB64) {
  const { doc, W, H, M, RED, DARK, GRAY, LGRAY, LINE } = baseDoc(logoB64);
  const logoH = Math.round(110*(959/1801));
  const esContraoferta = !!carta.precio_contraoferta;
  const precioRespuesta = carta.precio_contraoferta || carta.precio_oferta;

  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
  doc.text("San Andrés Cholula, Puebla", W-M-155, 22);
  doc.text(fmtFecha(carta.fecha), W-M-155, 33);

  const divY = 10 + logoH + 8;
  doc.setDrawColor(...RED); doc.setLineWidth(2); doc.line(M, divY, W-M, divY);
  let y = divY + 20;

  doc.setFont("helvetica","bold"); doc.setFontSize(13); doc.setTextColor(...DARK);
  doc.text(esContraoferta ? "CARTA DE CONTRAOFERTA" : "CARTA DE ACEPTACIÓN DE OFERTA", W/2, y, {align:"center"});
  y += 13;
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...GRAY);
  doc.text("Respuesta a Carta de Intención de Compra", W/2, y, {align:"center"});
  y += 10;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.5); doc.line(M, y, W-M, y); y += 16;

  // Destinatario
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...GRAY);
  doc.text("Para:", M, y); y += 13;
  doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(...RED);
  doc.text(carta.cliente_nombre, M, y); y += 18;

  // Cuerpo
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...DARK);
  const intro = esContraoferta
    ? "En respuesta a la Carta de Intención de Compra presentada respecto al inmueble ubicado en "
    : "Nos complace comunicarle que su oferta de compra respecto al inmueble ubicado en ";
  y = wrapText(doc, intro + carta.inmueble + (esContraoferta ? ", nos permitimos comunicarle que los propietarios han analizado su propuesta y presentan la siguiente contraoferta:" : ", ha sido aceptada por los propietarios en los términos aquí indicados:"), M, y, W-2*M, 12, 9);
  y += 10;

  // Precio box
  doc.setFillColor(...RED); doc.rect(M, y, W-2*M, 68, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(255,255,255);
  doc.text(esContraoferta ? "PRECIO DE CONTRAOFERTA" : "PRECIO ACEPTADO", W/2, y+14, {align:"center"});
  doc.setFont("helvetica","bold"); doc.setFontSize(30);
  doc.text(fmt(precioRespuesta), W/2, y+42, {align:"center"});
  y += 78;

  // Condiciones
  doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...RED);
  doc.text("CONDICIONES DE PAGO", M, y);
  y += 6; doc.setDrawColor(...LINE); doc.setLineWidth(0.5); doc.line(M, y, W-M, y); y += 10;

  const enganche = carta.enganche ? (parseFloat(carta.precio_contraoferta || carta.precio_oferta) * parseFloat(carta.enganche) / parseFloat(carta.precio_oferta)) : null;
  const saldo = carta.precio_contraoferta ? (parseFloat(carta.precio_contraoferta) - (enganche || 0)) : carta.saldo;

  const conds = [
    ["Apartado:", fmt(carta.apartado), `A cubrir dentro de las ${carta.vigencia_hrs} hrs siguientes a la aceptación`],
    ["Enganche:", carta.enganche ? fmt(carta.enganche) : "Por acordar", "A la firma del contrato de promesa de compraventa"],
    ["Saldo restante:", carta.saldo ? fmt(carta.saldo) : "Por acordar", "A la firma de la escritura correspondiente"],
    ["Forma de pago:", carta.forma_pago, ""],
  ];
  for (let i = 0; i < conds.length; i++) {
    const [lbl, val, desc] = conds[i];
    doc.setFillColor(...(i%2===0 ? LGRAY : [255,255,255]));
    doc.rect(M, y-13, W-2*M, 18, "F");
    doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
    doc.text(lbl, M+4, y);
    doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(...DARK);
    doc.text(val, M+110, y);
    if (desc) { doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...GRAY); doc.text(desc, M+255, y); }
    y += 18;
  }
  y += 10;

  if (esContraoferta) {
    doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...DARK);
    doc.text("Esta contraoferta tiene una vigencia de ", M, y);
    const bw = doc.getTextWidth("Esta contraoferta tiene una vigencia de ");
    doc.setFont("helvetica","bold"); doc.setTextColor(...RED);
    doc.text(`${carta.vigencia_hrs} horas`, M+bw, y);
    doc.setFont("helvetica","normal"); doc.setTextColor(...DARK);
    doc.text(" a partir de la fecha de la presente.", M+bw+doc.getTextWidth(`${carta.vigencia_hrs} horas`), y);
    y += 14;
  }

  doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...GRAY);
  doc.text("Quedamos atentos a sus comentarios y a las órdenes para formalizar el proceso.", M, y);
  y += 22;

  doc.setDrawColor(...RED); doc.setLineWidth(1.5); doc.line(M, y, W-M, y); y += 13;
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
  doc.text("Atentamente,", M, y); y += 12;
  doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(...RED);
  doc.text("EMPORIO INMOBILIARIO", M, y); y += 22;
  addFirma(doc, M, y, FIRMA_CARLOS_B64);

  if (qrB64) {
    doc.addImage(qrB64, "PNG", W-M-58, H-70, 55, 55);
    doc.setFont("helvetica","normal"); doc.setFontSize(6); doc.setTextColor(...GRAY);
    doc.text("Verificar documento", W-M-29, H-12, {align:"center"});
  }

  return doc;
}

// ── PDF 4: Constancia interna de aceptación del propietario ────────────────
async function generarConstanciaAceptacion(carta, aceptacion, logoB64, qrB64) {
  const { doc, W, H, M, RED, DARK, GRAY, LGRAY, LINE } = baseDoc(logoB64);
  const logoH = Math.round(110*(959/1801));
  const precioAceptado = carta.precio_contraoferta || carta.precio_oferta;

  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
  doc.text("San Andrés Cholula, Puebla", W-M-155, 22);
  doc.text(fmtFecha(aceptacion.fecha), W-M-155, 33);

  const divY = 10 + logoH + 8;
  doc.setDrawColor(...RED); doc.setLineWidth(2); doc.line(M, divY, W-M, divY);
  let y = divY + 22;

  doc.setFont("helvetica","bold"); doc.setFontSize(13); doc.setTextColor(...DARK);
  doc.text("CONSTANCIA DE ACEPTACIÓN DE OFERTA", W/2, y, {align:"center"});
  y += 13;
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...GRAY);
  doc.text(`Registro interno de aceptación — ${carta.folio}`, W/2, y, {align:"center"});
  y += 16;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.5); doc.line(M, y, W-M, y); y += 18;

  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...DARK);
  y = wrapText(doc, "Por medio de la presente se deja constancia de que Emporio Inmobiliario registró la aceptación de la oferta indicada por parte del propietario o propietarios del inmueble.", M, y, W-2*M, 12, 9);
  y += 14;

  const rows = [
    ["Propietario(s):", carta.propietarios],
    ["Aceptó:", aceptacion.aceptado_por || carta.propietarios],
    ["Medio de aceptación:", aceptacion.medio],
    ["Fecha de aceptación:", fmtFecha(aceptacion.fecha)],
    ["Comprador/ofertante:", carta.cliente_nombre],
    ["Inmueble:", carta.inmueble],
    ["Precio aceptado:", fmt(precioAceptado)],
    ["Apartado:", fmt(carta.apartado)],
    ["Forma de pago:", carta.forma_pago || "—"],
  ];

  rows.forEach(([label, value], i) => {
    const rowH = label === "Inmueble:" ? 34 : 20;
    doc.setFillColor(...(i%2===0 ? LGRAY : [255,255,255]));
    doc.rect(M, y - 12, W - 2*M, rowH, "F");
    doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...GRAY);
    doc.text(label, M + 6, y);
    doc.setFont("helvetica","normal"); doc.setTextColor(...DARK);
    if (label === "Inmueble:") {
      wrapText(doc, String(value || "—"), M + 120, y, W - 2*M - 130, 10, 8);
    } else {
      doc.text(String(value || "—"), M + 120, y);
    }
    y += rowH;
  });
  y += 12;

  if (aceptacion.notas) {
    doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...RED);
    doc.text("OBSERVACIONES / EVIDENCIA", M, y); y += 12;
    doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...DARK);
    y = wrapText(doc, aceptacion.notas, M, y, W-2*M, 12, 8.5);
    y += 14;
  }

  doc.setDrawColor(...RED); doc.setLineWidth(1.5); doc.line(M, y, W-M, y); y += 14;
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
  doc.text("Registró:", M, y); y += 12;
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...DARK);
  doc.text("Emporio Inmobiliario", M, y); y += 20;
  addFirma(doc, M, y, FIRMA_CARLOS_B64);

  if (qrB64) {
    doc.addImage(qrB64, "PNG", W-M-58, H-70, 55, 55);
    doc.setFont("helvetica","normal"); doc.setFontSize(6); doc.setTextColor(...GRAY);
    doc.text("Verificar registro", W-M-29, H-12, {align:"center"});
  }

  return doc;
}

// ── Componente principal ──────────────────────────────────────
export default function CartaDetalle() {
  const router = useRouter();
  const { id } = router.query;
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [carta, setCarta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generando, setGenerando] = useState(null);
  const [toast, setToast] = useState(null);
  const [editando, setEditando] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [modalAceptacion, setModalAceptacion] = useState(false);
  const [aceptacionForm, setAceptacionForm] = useState({ fecha: new Date().toISOString().slice(0, 10), aceptado_por: "", medio: "WhatsApp", notas: "" });
  const [aceptacionUrl, setAceptacionUrl] = useState(null);
  const [acceptanceLink, setAcceptanceLink] = useState("");
  const [archivoEvidencia, setArchivoEvidencia] = useState(null);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) supabase.from("profiles").select("*").eq("id", session.user.id).single().then(() => setAuthLoading(false));
      else setAuthLoading(false);
    });
  }, []);

  useEffect(() => { if (id && session) loadCarta(); }, [id, session]);

  const loadCarta = async () => {
    setLoading(true);
    const { data } = await supabase.from("cartas_oferta").select("*").eq("id", id).single();
    setCarta(data);
    if (data?.id && session?.access_token) loadAcceptanceLink(data.id, session.access_token);
    if (data?.folio) {
      const filename = `${data.folio}_Aceptacion_Propietario.pdf`;
      const { data: signed } = await supabase.storage.from("cartas-oferta").createSignedUrl(filename, 60*60*24*365);
      setAceptacionUrl(signed?.signedUrl || null);
    }
    setLoading(false);
  };

  const loadAcceptanceLink = async (cartaId, accessToken) => {
    const res = await fetch(`/api/cartas/aceptacion-link?id=${encodeURIComponent(cartaId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    if (res.ok && data.url) setAcceptanceLink(data.url);
  };

  const generarPDF = async (tipo) => {
    setGenerando(tipo);
    try {
      // Recargar carta para tener datos más recientes
      const { data: cartaFresh } = await supabase.from("cartas_oferta").select("*").eq("id", id).single();
      if (cartaFresh) setCarta(cartaFresh);
      const cartaData = cartaFresh || carta;

      const logoB64 = await getLogoB64();
      const qrB64 = await getQRB64(`https://www.emporioinmobiliario.com.mx/verificar-carta/${carta.folio}`);
      let doc, filename;

      if (tipo === "intencion") {
        doc = await generarIntencion(cartaData, logoB64);
        filename = `${cartaData.folio}_Intencion_Compra.pdf`;
      } else if (tipo === "presentacion") {
        doc = await generarPresentacion(cartaData, logoB64, qrB64);
        filename = `${cartaData.folio}_Presentacion_Oferta.pdf`;
      } else {
        doc = await generarRespuesta(cartaData, logoB64, qrB64);
        filename = `${cartaData.folio}_${cartaData.precio_contraoferta ? "Contraoferta" : "Aceptacion"}.pdf`;
      }

      // Subir a Storage
      const pdfBlob = doc.output("blob");
      const { error: upErr } = await supabase.storage.from("cartas-oferta").upload(filename, pdfBlob, { contentType: "application/pdf", upsert: true });
      if (!upErr) {
        const { data: signed } = await supabase.storage.from("cartas-oferta").createSignedUrl(filename, 60*60*24*365);
        const urlField = tipo === "intencion" ? "pdf_intencion_url" : tipo === "presentacion" ? "pdf_presentacion_url" : "pdf_respuesta_url";
        await supabase.from("cartas_oferta").update({ [urlField]: signed?.signedUrl }).eq("id", id);
      }

      doc.save(filename);
      showToast("PDF generado y descargado");
      loadCarta();
    } catch (e) {
      showToast("Error generando PDF: " + e.message, false);
    } finally {
      setGenerando(null);
    }
  };

  const guardarEdicion = async () => {
    setGuardando(true);
    const { error } = await supabase.from("cartas_oferta").update({
      precio_contraoferta: editForm.precio_contraoferta ? parseFloat(editForm.precio_contraoferta) : null,
      apartado: parseFloat(editForm.apartado),
      enganche: parseFloat(editForm.enganche) || null,
      saldo: parseFloat(editForm.saldo) || null,
      vigencia_hrs: parseInt(editForm.vigencia_hrs),
      forma_pago: editForm.forma_pago || carta.forma_pago,
      estatus: editForm.estatus,
      notas: editForm.notas,
    }).eq("id", id);
    setGuardando(false);
    if (!error) { setEditando(false); loadCarta(); showToast("Guardado"); }
  };

  const abrirAceptacion = () => {
    setAceptacionForm({
      fecha: new Date().toISOString().slice(0, 10),
      aceptado_por: carta.propietarios || "",
      medio: "WhatsApp",
      notas: "",
    });
    setArchivoEvidencia(null);
    setModalAceptacion(true);
  };

  const registrarAceptacion = async () => {
    if (!aceptacionForm.aceptado_por?.trim()) {
      showToast("Indica quién aceptó la oferta", false);
      return;
    }
    setGuardando(true);
    try {
      let evidenciaUrl = "";
      if (archivoEvidencia) {
        const ext = archivoEvidencia.name.split(".").pop();
        const evidenciaName = `${carta.folio}_Evidencia_Aceptacion_${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("cartas-oferta").upload(evidenciaName, archivoEvidencia, { contentType: archivoEvidencia.type || "application/octet-stream", upsert: true });
        if (!upErr) {
          const { data: signedEv } = await supabase.storage.from("cartas-oferta").createSignedUrl(evidenciaName, 60*60*24*365);
          evidenciaUrl = signedEv?.signedUrl || "";
        }
      }

      const logoB64 = await getLogoB64();
      const qrB64 = await getQRB64(`https://www.emporioinmobiliario.com.mx/verificar-carta/${carta.folio}-aceptacion`);
      const doc = await generarConstanciaAceptacion(carta, aceptacionForm, logoB64, qrB64);
      const filename = `${carta.folio}_Aceptacion_Propietario.pdf`;
      const pdfBlob = doc.output("blob");
      const { error: pdfErr } = await supabase.storage.from("cartas-oferta").upload(filename, pdfBlob, { contentType: "application/pdf", upsert: true });
      if (pdfErr) throw pdfErr;
      const { data: signed } = await supabase.storage.from("cartas-oferta").createSignedUrl(filename, 60*60*24*365);

      const registro = [
        "",
        "=== ACEPTACIÓN DE OFERTA POR PROPIETARIO ===",
        `Fecha: ${aceptacionForm.fecha}`,
        `Aceptó: ${aceptacionForm.aceptado_por}`,
        `Medio: ${aceptacionForm.medio}`,
        `Precio aceptado: ${fmt(carta.precio_contraoferta || carta.precio_oferta)}`,
        aceptacionForm.notas ? `Notas: ${aceptacionForm.notas}` : "",
        signed?.signedUrl ? `Constancia PDF: ${signed.signedUrl}` : "",
        evidenciaUrl ? `Evidencia adjunta: ${evidenciaUrl}` : "",
      ].filter(Boolean).join("\n");

      const { error } = await supabase.from("cartas_oferta").update({
        estatus: "aceptado",
        notas: `${carta.notas || ""}${registro}`,
      }).eq("id", id);
      if (error) throw error;

      setAceptacionUrl(signed?.signedUrl || null);
      setModalAceptacion(false);
      showToast("Aceptación registrada");
      loadCarta();
    } catch (e) {
      showToast("Error al registrar aceptación: " + e.message, false);
    } finally {
      setGuardando(false);
    }
  };

  const copiarAcceptanceLink = async () => {
    if (!acceptanceLink) {
      showToast("Aún no se generó el link", false);
      return;
    }
    try {
      await navigator.clipboard.writeText(acceptanceLink);
      showToast("Link copiado");
    } catch {
      showToast("No se pudo copiar el link", false);
    }
  };

  if (authLoading || loading) return <div style={{ minHeight: "100vh", background: brand.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><img src="https://www.emporioinmobiliario.com.mx/logo.png" style={{ height: 48, opacity: 0.4 }} /></div>;
  if (!session) { if (typeof window !== "undefined") window.location.href = "/"; return null; }
  if (!carta) return <div style={{ padding: 32 }}>No encontrado</div>;

  const inp = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, boxSizing: "border-box" };
  const ESTATUS_STYLE = { oferta: { bg: "#dbeafe", color: "#1e40af", label: "Oferta" }, contraoferta: { bg: "#fef3c7", color: "#92400e", label: "Contraoferta" }, aceptado: { bg: "#d1fae5", color: "#065f46", label: "Aceptado" }, cancelado: { bg: "#fee2e2", color: "#991b1b", label: "Cancelado" } };
  const est = ESTATUS_STYLE[carta.estatus] || ESTATUS_STYLE.oferta;

  return (
    <div style={{ minHeight: "100vh", background: brand.bg, fontFamily: "system-ui, sans-serif" }}>
      {toast && <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000 }}>{toast.msg}</div>}

      <PageHeader title="Carta de Oferta" icon="📄" />

      <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 20px" }}>

        {/* Info card */}
        <div style={{ background: "#1a3c5e", borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
            <div>
              <p style={{ color: "#c8a45a", fontSize: 11, margin: "0 0 4px", textTransform: "uppercase", fontWeight: 700 }}>Carta de Oferta</p>
              <h2 style={{ color: "#fff", fontSize: 20, margin: "0 0 4px", fontFamily: "monospace" }}>{carta.folio}</h2>
              <p style={{ color: "#aac4de", fontSize: 13, margin: 0 }}>{carta.inmueble}</p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => { setEditForm({ precio_contraoferta: carta.precio_contraoferta || "", apartado: carta.apartado, enganche: carta.enganche || "", saldo: carta.saldo || "", vigencia_hrs: carta.vigencia_hrs, forma_pago: carta.forma_pago || "", estatus: carta.estatus, notas: carta.notas || "" }); setEditando(!editando); }}
                style={{ background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 20, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                ✏️ Editar
              </button>
              <span style={{ background: est.bg, color: est.color, padding: "4px 12px", borderRadius: 99, fontSize: 12, fontWeight: 700 }}>{est.label}</span>
            </div>
          </div>

          {!editando ? (
            <div style={{ display: "flex", gap: 20, marginTop: 14, flexWrap: "wrap" }}>
              {[
                ["Comprador", carta.cliente_nombre],
                ["Propietarios", carta.propietarios],
                ["Oferta", fmt(carta.precio_oferta)],
                ["Contraoferta", carta.precio_contraoferta ? fmt(carta.precio_contraoferta) : "—"],
                ["Apartado", fmt(carta.apartado)],
                ["Vigencia", carta.vigencia_hrs + " hrs"],
                ["Forma de pago", carta.forma_pago],
              ].map(([k,v]) => (
                <div key={k}>
                  <p style={{ color: "#aac4de", fontSize: 11, margin: "0 0 2px" }}>{k}</p>
                  <p style={{ color: "#fff", fontSize: 13, margin: 0 }}>{v}</p>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 14, background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: 14 }}>
              <p style={{ color: "#c8a45a", fontSize: 12, fontWeight: 700, margin: "0 0 12px" }}>Editar carta</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  ["Precio de contraoferta", "precio_contraoferta", "number"],
                  ["Apartado", "apartado", "number"],
                  ["Enganche", "enganche", "number"],
                  ["Saldo restante", "saldo", "number"],
                  ["Vigencia (hrs)", "vigencia_hrs", "number"],
                ].map(([label, key, type]) => (
                  <div key={key}>
                    <label style={{ color: "#aac4de", fontSize: 11, display: "block", marginBottom: 3 }}>{label}</label>
                    <input style={{ ...inp, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }} type={type} value={editForm[key]} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))} />
                  </div>
                ))}
                <div style={{ gridColumn: "span 2" }}>
                  <label style={{ color: "#aac4de", fontSize: 11, display: "block", marginBottom: 3 }}>Forma de pago</label>
                  <input style={{ ...inp, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }} 
                    value={editForm.forma_pago || ""} onChange={e => setEditForm(f => ({ ...f, forma_pago: e.target.value }))}
                    placeholder="Ej: 60% crédito + 40% recursos propios" />
                </div>
              <div>
                  <label style={{ color: "#aac4de", fontSize: 11, display: "block", marginBottom: 3 }}>Estatus</label>
                  <select style={{ ...inp, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }} value={editForm.estatus} onChange={e => setEditForm(f => ({ ...f, estatus: e.target.value }))}>
                    <option value="oferta">Oferta</option>
                    <option value="contraoferta">Contraoferta</option>
                    <option value="aceptado">Aceptado</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={() => setEditando(false)} style={{ flex: 1, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: 8, fontSize: 13, cursor: "pointer" }}>Cancelar</button>
                <button onClick={guardarEdicion} disabled={guardando} style={{ flex: 2, background: "#22c55e", color: "#fff", border: "none", borderRadius: 6, padding: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{guardando ? "Guardando..." : "✓ Guardar"}</button>
              </div>
            </div>
          )}
        </div>

        {/* Aceptación del propietario */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 800, color: brand.gray, margin: "0 0 6px" }}>Aceptación del propietario</h3>
              <p style={{ margin: 0, fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
                Registra cuando el propietario acepta la oferta para dejar evidencia interna antes de responder al cliente.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {acceptanceLink && (
                <button onClick={copiarAcceptanceLink} style={{ background: "#f5f3ff", color: "#7c3aed", border: "1px solid #c4b5fd", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
                  Copiar link
                </button>
              )}
              {aceptacionUrl && (
                <a href={aceptacionUrl} target="_blank" rel="noreferrer" style={{ background: "#d1fae5", color: "#065f46", padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
                  Ver constancia
                </a>
              )}
              <button onClick={abrirAceptacion} style={{ background: "#1a3c5e", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
                Registrar aceptación
              </button>
            </div>
          </div>
          {carta.estatus === "aceptado" && (
            <div style={{ marginTop: 12, background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#065f46", borderRadius: 10, padding: "10px 12px", fontSize: 12, fontWeight: 700 }}>
              Oferta marcada como aceptada por propietario.
            </div>
          )}
        </div>

        {/* Generar PDFs */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: brand.gray, margin: "0 0 16px" }}>Generar documentos</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { tipo: "intencion", icon: "📝", titulo: "Carta de Intención de Compra", desc: "La presenta el comprador — sin firma de Emporio", urlKey: "pdf_intencion_url", showFirma: false },
              { tipo: "presentacion", icon: "📬", titulo: "Carta de Presentación de Oferta", desc: "De Emporio a los propietarios — con firma y QR", urlKey: "pdf_presentacion_url", showFirma: true },
              { tipo: "respuesta", icon: carta.precio_contraoferta ? "↩️" : "✅", titulo: carta.precio_contraoferta ? "Carta de Contraoferta" : "Carta de Aceptación", desc: "De Emporio al comprador — con firma y QR", urlKey: "pdf_respuesta_url", showFirma: true },
            ].map(({ tipo, icon, titulo, desc, urlKey, showFirma }) => (
              <div key={tipo} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: "#f9fafb", borderRadius: 10, gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 24 }}>{icon}</span>
                  <div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1a1a2e" }}>{titulo}</p>
                    <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>{desc}</p>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  {carta[urlKey] && <a href={carta[urlKey]} target="_blank" rel="noreferrer" style={{ background: "#dbeafe", color: "#1e40af", padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>Ver PDF</a>}
                  <button onClick={() => generarPDF(tipo)} disabled={generando === tipo}
                    style={{ background: generando === tipo ? "#9ca3af" : brand.red, color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: generando === tipo ? "not-allowed" : "pointer" }}>
                    {generando === tipo ? "Generando..." : carta[urlKey] ? "Regenerar" : "Generar PDF"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {modalAceptacion && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2500, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: "100%", maxWidth: 520, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>Registrar aceptación</h3>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>{carta.folio} · {carta.propietarios}</p>
              </div>
              <button onClick={() => setModalAceptacion(false)} style={{ background: "#f3f4f6", color: "#6b7280", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>✕</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 4 }}>Fecha de aceptación</label>
                <input type="date" value={aceptacionForm.fecha} onChange={e => setAceptacionForm(f => ({ ...f, fecha: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 4 }}>Medio</label>
                <select value={aceptacionForm.medio} onChange={e => setAceptacionForm(f => ({ ...f, medio: e.target.value }))} style={inp}>
                  <option>WhatsApp</option>
                  <option>Correo electrónico</option>
                  <option>Llamada</option>
                  <option>Presencial</option>
                  <option>Otro</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 4 }}>Quién aceptó</label>
              <input value={aceptacionForm.aceptado_por} onChange={e => setAceptacionForm(f => ({ ...f, aceptado_por: e.target.value }))} placeholder="Nombre del propietario o representante" style={inp} />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 4 }}>Notas / texto de evidencia</label>
              <textarea value={aceptacionForm.notas} onChange={e => setAceptacionForm(f => ({ ...f, notas: e.target.value }))} rows={4} placeholder="Ej: Confirmó por WhatsApp: 'Acepto la oferta en esos términos'." style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 4 }}>Evidencia adjunta opcional</label>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setArchivoEvidencia(e.target.files?.[0] || null)} style={{ ...inp, padding: 8 }} />
              <p style={{ margin: "5px 0 0", fontSize: 11, color: "#9ca3af" }}>Puede ser captura de WhatsApp, correo o PDF.</p>
            </div>

            <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, marginBottom: 18 }}>
              <p style={{ margin: 0, fontSize: 12, color: "#374151" }}>
                Al confirmar se marcará la carta como <strong>Aceptado</strong> y se generará una constancia PDF del registro.
              </p>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setModalAceptacion(false)} disabled={guardando} style={{ background: "#f3f4f6", color: "#6b7280", border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={registrarAceptacion} disabled={guardando} style={{ background: guardando ? "#9ca3af" : brand.red, color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 800, cursor: guardando ? "not-allowed" : "pointer" }}>
                {guardando ? "Registrando..." : "Confirmar aceptación"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
