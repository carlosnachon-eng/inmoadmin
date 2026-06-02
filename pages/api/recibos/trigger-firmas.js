// pages/api/recibos/trigger-firmas.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ETAPAS_COMPRAVENTA = [
  { orden: 1,  clave: "apartado",         nombre: "Apartado provisional registrado ($10,000)", responsable: "ventas" },
  { orden: 2,  clave: "datos_comprador",  nombre: "Datos del comprador subidos",                responsable: "ventas" },
  { orden: 3,  clave: "contrato",         nombre: "Contrato elaborado segun carta oferta",      responsable: "juridico" },
  { orden: 4,  clave: "revision",         nombre: "Contrato enviado a revision por ambas partes", responsable: "juridico" },
  { orden: 5,  clave: "cambios",          nombre: "Cambios resueltos + contrato aprobado",      responsable: "juridico" },
  { orden: 6,  clave: "promesa_enganche", nombre: "Firma de promesa + pago de enganche",        responsable: "direccion" },
  { orden: 7,  clave: "credito",          nombre: "Proceso de credito iniciado con broker",     responsable: "ventas" },
  { orden: 8,  clave: "avaluo",           nombre: "Avaluo realizado",                           responsable: "ventas" },
  { orden: 9,  clave: "expediente_banco", nombre: "Expediente ingresado a banco/INFONAVIT",     responsable: "direccion" },
  { orden: 10, clave: "escritura",        nombre: "Firma de escritura + pagos liquidados",      responsable: "direccion" },
  { orden: 11, clave: "entrega",          nombre: "Casa entregada",                             responsable: "ventas" },
];

const CONTADO_OMITIR = [7, 8, 9];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const {
    recibo_id, folio, tipo, cliente_nombre, inmueble,
    monto, forma_pago, es_contado, es_urgente, creado_por, creado_por_nombre
  } = req.body;

  if (tipo !== "compraventa") return res.status(200).json({ skipped: true });

  try {
    const inmuebleCorto = inmueble.split(",")[0].trim();
    const clienteCorto = cliente_nombre.split(" ").slice(0, 2).join(" ");
    const titulo = `${inmuebleCorto} - ${clienteCorto}`;

    const fpNorm = (forma_pago || "").toLowerCase().includes("transferencia") ? "transferencia" : "efectivo";

    // 1. Crear expediente en firmas
    const { data: firma, error: firmaErr } = await supabase
      .from("firmas")
      .insert({
        tipo: "compraventa",
        titulo,
        direccion: inmueble,
        nombre_comprador: cliente_nombre,
        nombre_vendedor: "",
        monto_apartado: monto,
        forma_pago: fpNorm,
        modalidad_firma: "presencial",
        fecha_apartado: new Date().toISOString().split("T")[0],
        urgente: es_urgente || false,
        es_contado: es_contado || false,
        creado_por,
        etapa_actual: 1,
        status: "activo",
      })
      .select()
      .single();

    if (firmaErr) throw new Error(firmaErr.message);

    // 2. Crear etapas
    const etapas = ETAPAS_COMPRAVENTA.map(e => ({
      firma_id: firma.id,
      orden: e.orden,
      clave: e.clave,
      nombre: e.nombre,
      responsable: e.responsable,
      status: (es_contado && CONTADO_OMITIR.includes(e.orden)) ? "no_aplica" : "pendiente",
    }));
    await supabase.from("firma_etapas").insert(etapas);

    // 3. Marcar etapa 1 como completada
    await supabase
      .from("firma_etapas")
      .update({ status: "completada", fecha_completada: new Date().toISOString() })
      .eq("firma_id", firma.id)
      .eq("orden", 1);

    // 4. Comentario bitácora
    await supabase.from("firma_comentarios").insert([
      {
        firma_id: firma.id,
        usuario_nombre: creado_por_nombre || "Sistema",
        mensaje: `Expediente creado. Tipo: compraventa. ${es_contado ? "Operacion de contado." : ""}`,
        tipo: "cambio_etapa",
      },
      {
        firma_id: firma.id,
        usuario_nombre: creado_por_nombre || "Sistema",
        mensaje: `Apartado provisional registrado ($${Number(monto).toLocaleString("es-MX")}). Folio de recibo: ${folio}.`,
        tipo: "cambio_etapa",
      },
    ]);

    // 5. Vincular recibo con firma
    await supabase
      .from("recibos_apartado")
      .update({ firma_id: firma.id })
      .eq("id", recibo_id);

    return res.status(200).json({ ok: true, firma_id: firma.id, titulo });

  } catch (e) {
    console.error("Error trigger firmas:", e.message);
    return res.status(200).json({ ok: false, error: e.message });
  }
}
