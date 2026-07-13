import { createClient } from "@supabase/supabase-js";
import { generarReciboComisionPdf } from "../../../lib/generarReciboComisionPdf";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function autenticarAdmin(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return { error: "Sesión requerida", status: 401 };

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return { error: "Sesión inválida", status: 401 };

  const { data: perfil, error: perfilError } = await supabase
    .from("profiles")
    .select("id, email, full_name, role_id")
    .eq("id", user.id)
    .maybeSingle();

  if (perfilError) return { error: perfilError.message, status: 500 };
  if (!perfil || perfil.role_id !== "admin") return { error: "Solo Admin puede generar recibos de comisión", status: 403 };

  return { user, perfil };
}

const filenameSafe = (value) =>
  String(value || "cierre")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56) || "cierre";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Faltan variables de Supabase" });
  }

  const auth = await autenticarAdmin(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const cierreId = req.query.id;
  if (!cierreId) return res.status(400).json({ error: "Falta id de cierre" });

  try {
    const { data: cierre, error: cierreError } = await supabase
      .from("cierres")
      .select("*")
      .eq("id", cierreId)
      .maybeSingle();

    if (cierreError) throw cierreError;
    if (!cierre) return res.status(404).json({ error: "Cierre no encontrado" });
    if (!Number(cierre.comision || 0) || !Number(cierre.cobrado || 0)) {
      return res.status(400).json({ error: "Este cierre aún no tiene comisión cobrada" });
    }

    const { data: pagos, error: pagosError } = await supabase
      .from("cierre_pagos")
      .select("id, cierre_id, concepto, monto, fecha, metodo_pago, notas")
      .eq("cierre_id", cierre.id)
      .order("fecha", { ascending: true });

    if (pagosError) throw pagosError;

    let propiedad = null;
    let propietario = null;
    let recibo = null;

    if (cierre.propiedad_id) {
      const { data: propiedadData, error: propiedadError } = await supabase
        .from("propiedades")
        .select("id, titulo, direccion, colonia, ciudad, estado")
        .eq("id", cierre.propiedad_id)
        .maybeSingle();
      if (propiedadError) throw propiedadError;
      propiedad = propiedadData || null;

      const { data: propietarioData, error: propietarioError } = await supabase
        .from("propietarios_inmuebles")
        .select("id, propiedad_id, nombre_propietario, razon_social_propietario")
        .eq("propiedad_id", cierre.propiedad_id)
        .maybeSingle();
      if (propietarioError) throw propietarioError;
      propietario = propietarioData || null;
    }

    if (cierre.recibo_id) {
      const { data: reciboData, error: reciboError } = await supabase
        .from("recibos_apartado")
        .select("id, inmueble, propiedad_id")
        .eq("id", cierre.recibo_id)
        .maybeSingle();
      if (reciboError) throw reciboError;
      recibo = reciboData || null;
    }

    const buffer = generarReciboComisionPdf({
      cierre,
      pagos: pagos || [],
      emitidoPor: auth.perfil.full_name || auth.perfil.email,
      propiedad,
      propietario,
      recibo,
    });

    const filename = `recibo-comision-${filenameSafe(propiedad?.titulo || cierre.propiedad)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("[recibo-comision]", error);
    return res.status(500).json({ error: error.message || "Error generando recibo de comisión" });
  }
}
