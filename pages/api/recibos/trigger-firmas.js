// pages/api/recibos/trigger-firmas.js
// Crea automáticamente el expediente de firmas al generar un recibo de compraventa

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const {
    recibo_id, folio, tipo, cliente_nombre, inmueble,
    monto, forma_pago, es_contado, es_urgente, creado_por, creado_por_nombre
  } = req.body;

  // Solo crear expediente para compraventa
  if (tipo !== "compraventa") return res.status(200).json({ skipped: true });

  // Construir título automático a partir del inmueble y cliente
  // Ej: "Casa La Trinidad - Maricruz Alemán"
  const inmuebleCorto = inmueble.split(",")[0].trim();
  const clienteCorto = cliente_nombre.split(" ").slice(0, 2).join(" ");
  const titulo = `${inmuebleCorto} - ${clienteCorto}`;

  try {
    // 1. Crear expediente en firmas
    const firmasRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/firmas/crear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo: "compraventa",
        titulo,
        direccion: inmueble,
        nombre_comprador: cliente_nombre,
        nombre_vendedor: "",           // Se captura después en firmas
        monto_apartado: monto,
        forma_pago: forma_pago.includes("ransferencia") ? "transferencia" : "efectivo",
        modalidad_firma: "presencial", // Se edita después en firmas
        fecha_apartado: new Date().toISOString().split("T")[0],
        urgente: es_urgente || false,
        es_contado: es_contado || false,
        creado_por,
        creado_por_nombre,
      }),
    });

    const firmasData = await firmasRes.json();
    if (!firmasData.firma) throw new Error(firmasData.error || "Error creando expediente");

    const firmaId = firmasData.firma.id;

    // 2. Marcar etapa 1 (Apartado provisional) como completada
    await supabase
      .from("firma_etapas")
      .update({ status: "completada", fecha_completada: new Date().toISOString() })
      .eq("firma_id", firmaId)
      .eq("orden", 1);

    // 3. Comentario en bitácora con el folio del recibo
    await supabase.from("firma_comentarios").insert({
      firma_id: firmaId,
      usuario_nombre: creado_por_nombre || "Sistema",
      mensaje: `Apartado provisional registrado ($${Number(monto).toLocaleString("es-MX")}). Folio de recibo: ${folio}.`,
      tipo: "cambio_etapa",
    });

    // 4. Vincular recibo con el expediente (guardar firma_id en el recibo)
    await supabase
      .from("recibos_apartado")
      .update({ firma_id: firmaId })
      .eq("id", recibo_id);

    return res.status(200).json({ ok: true, firma_id: firmaId, titulo });

  } catch (e) {
    console.error("Error trigger firmas:", e.message);
    // No falla el recibo si el trigger falla — solo lo logea
    return res.status(200).json({ ok: false, error: e.message });
  }
}
