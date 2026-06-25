import { createClient } from "@supabase/supabase-js";
import { getEtapas } from "../../../lib/firmasEtapas";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const formatearFechaTitulo = (fecha) => {
  if (!fecha) return "";
  const valor = new Date(`${fecha}T12:00:00`);
  if (Number.isNaN(valor.getTime())) return "";
  return valor.toLocaleDateString("es-MX", { day: "numeric", month: "long" });
};

async function autenticar(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return { error: "Sesión requerida", status: 401 };

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { error: "Sesión inválida", status: 401 };

  const { data: perfil } = await supabase
    .from("profiles")
    .select("id, full_name, email, role_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!perfil || !["admin", "gerente_ventas"].includes(perfil.role_id)) {
    return { error: "No tienes permiso para iniciar este flujo", status: 403 };
  }
  return { user, perfil };
}

const marcarRevision = async (reciboId, mensaje) => {
  await supabase.from("recibos_apartado").update({
    flujo_estado: "requiere_revision",
    flujo_error: mensaje,
    flujo_actualizado_en: new Date().toISOString(),
  }).eq("id", reciboId);
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const auth = await autenticar(req);
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });

  const { recibo_id } = req.body || {};
  if (!recibo_id) return res.status(400).json({ ok: false, error: "Falta recibo_id" });

  try {
    const { data: recibo, error: reciboError } = await supabase
      .from("recibos_apartado")
      .select("*")
      .eq("id", recibo_id)
      .single();
    if (reciboError || !recibo) throw new Error("Recibo no encontrado");
    if (!recibo.propiedad_id) throw new Error("El recibo no tiene propiedad vinculada");

    const { data: propiedad, error: propiedadError } = await supabase
      .from("propiedades")
      .select("id, titulo, direccion, colonia, ciudad, status")
      .eq("id", recibo.propiedad_id)
      .single();
    if (propiedadError || !propiedad) throw new Error("Propiedad no encontrada");
    if (!["published", "reserved"].includes(propiedad.status)) {
      throw new Error(`La propiedad no puede reservarse porque está ${propiedad.status}`);
    }

    await supabase.from("recibos_apartado").update({
      flujo_estado: "pendiente",
      flujo_error: null,
      flujo_actualizado_en: new Date().toISOString(),
    }).eq("id", recibo.id);

    const { error: reservaError } = await supabase.from("propiedades").update({
      status: "reserved",
      apartado_por_nombre: recibo.cliente_nombre,
      apartado_asesor_id: recibo.asesor_id || null,
      apartado_fecha: recibo.created_at || new Date().toISOString(),
      apartado_monto: recibo.monto,
      apartado_vigencia_hasta: recibo.apartado_vigencia_hasta || recibo.fecha_limite_firma || null,
      apartado_notas: `Recibo ${recibo.folio}`,
      status_motivo: `Apartado registrado con recibo ${recibo.folio}`,
      status_actualizado_en: new Date().toISOString(),
      status_actualizado_por: auth.user.id,
    }).eq("id", propiedad.id);
    if (reservaError) throw new Error(`No se pudo reservar la propiedad: ${reservaError.message}`);

    let { data: firma } = await supabase
      .from("firmas")
      .select("id, titulo")
      .eq("recibo_id", recibo.id)
      .maybeSingle();
    let firmaCreada = false;

    if (!firma) {
      const tipoFirma = recibo.tipo === "compraventa" ? "compraventa" : "arrendamiento";
      const inmuebleCorto = (propiedad.titulo || recibo.inmueble || "Propiedad").split(",")[0].trim();
      const { data: asesor } = recibo.asesor_id
        ? await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("id", recibo.asesor_id)
          .maybeSingle()
        : { data: null };
      const asesorNombre = (asesor?.full_name || asesor?.email?.split("@")[0] || "Sin asesor")
        .trim()
        .split(/\s+/)[0];
      const fechaMaxima = formatearFechaTitulo(
        recibo.fecha_limite_firma || recibo.apartado_vigencia_hasta
      );
      const titulo = tipoFirma === "arrendamiento"
        ? [inmuebleCorto, asesorNombre, fechaMaxima].filter(Boolean).join(" - ")
        : [inmuebleCorto, asesorNombre].filter(Boolean).join(" - ");
      const formaPago = String(recibo.forma_pago || "").toLowerCase().includes("transferencia") ? "transferencia" : "efectivo";
      const { data: propietarios } = await supabase
        .from("propietarios_inmuebles")
        .select("nombre_propietario")
        .eq("propiedad_id", propiedad.id)
        .limit(1);
      const nombrePropietario = propietarios?.[0]?.nombre_propietario || "";

      const { data: nuevaFirma, error: firmaError } = await supabase
        .from("firmas")
        .insert({
          tipo: tipoFirma,
          titulo,
          direccion: recibo.inmueble,
          nombre_comprador: recibo.cliente_nombre,
          nombre_vendedor: nombrePropietario,
          monto_apartado: recibo.monto,
          forma_pago: formaPago,
          propietario_asiste: true,
          modalidad_firma: "presencial",
          fecha_apartado: recibo.fecha || String(recibo.created_at || new Date().toISOString()).slice(0, 10),
          urgente: recibo.es_urgente || false,
          es_contado: recibo.es_contado || false,
          creado_por: auth.user.id,
          propiedad_id: propiedad.id,
          recibo_id: recibo.id,
          etapa_actual: 1,
          status: "activo",
        })
        .select("id, titulo")
        .single();
      if (firmaError) throw new Error(`No se pudo abrir Firmas: ${firmaError.message}`);
      firma = nuevaFirma;
      firmaCreada = true;
    }

    const { count: etapasExistentes } = await supabase
      .from("firma_etapas")
      .select("id", { count: "exact", head: true })
      .eq("firma_id", firma.id);
    if (!etapasExistentes) {
      const tipoFirma = recibo.tipo === "compraventa" ? "compraventa" : "arrendamiento";
      const etapas = getEtapas(tipoFirma, recibo.es_contado).map(etapa => ({
        firma_id: firma.id,
        orden: etapa.orden,
        clave: etapa.clave,
        nombre: etapa.nombre,
        responsable: etapa.responsable,
        status: etapa.orden === 1 ? "completada" : etapa.status,
        completada_por: etapa.orden === 1 ? auth.user.id : null,
        completada_at: etapa.orden === 1 ? new Date().toISOString() : null,
      }));
      const { error: etapasError } = await supabase.from("firma_etapas").insert(etapas);
      if (etapasError) throw new Error(`Firmas se creó sin etapas: ${etapasError.message}`);
    }

    if (firmaCreada) {
      await supabase.from("firma_comentarios").insert([
        {
          firma_id: firma.id,
          usuario_nombre: auth.perfil.full_name || auth.perfil.email || "Sistema",
          mensaje: `Expediente creado desde el recibo ${recibo.folio}.`,
          tipo: "cambio_etapa",
        },
        {
          firma_id: firma.id,
          usuario_nombre: auth.perfil.full_name || auth.perfil.email || "Sistema",
          mensaje: `Apartado registrado por $${Number(recibo.monto || 0).toLocaleString("es-MX")}.`,
          tipo: "cambio_etapa",
        },
      ]);
    }

    await supabase.from("recibos_apartado").update({
      firma_id: firma.id,
      flujo_estado: "completo",
      flujo_error: null,
      flujo_actualizado_en: new Date().toISOString(),
    }).eq("id", recibo.id);

    return res.status(200).json({
      ok: true,
      firma_id: firma.id,
      propiedad_id: propiedad.id,
      pendiente_cierre: true,
    });
  } catch (error) {
    await marcarRevision(recibo_id, error.message);
    console.error("Error flujo de apartado:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
