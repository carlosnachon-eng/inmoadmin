import { createClient } from "@supabase/supabase-js";
import { verifyCartaAcceptanceToken } from "../../../lib/cartaAcceptanceToken";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const fmt = (n) => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2 });

function getIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() || "";
  return req.socket?.remoteAddress || "";
}

export default async function handler(req, res) {
  const id = req.method === "GET" ? req.query.id : req.body?.id;
  const token = req.method === "GET" ? req.query.token : req.body?.token;
  if (!verifyCartaAcceptanceToken(id, token)) return res.status(403).json({ error: "Link inválido" });

  const { data: carta, error } = await supabase
    .from("cartas_oferta")
    .select("id, folio, cliente_nombre, propietarios, inmueble, precio_oferta, precio_contraoferta, apartado, enganche, saldo, forma_pago, vigencia_hrs, estatus, notas")
    .eq("id", id)
    .single();
  if (error || !carta) return res.status(404).json({ error: "Carta no encontrada" });

  if (req.method === "GET") {
    return res.status(200).json({
      carta: {
        id: carta.id,
        folio: carta.folio,
        cliente_nombre: carta.cliente_nombre,
        propietarios: carta.propietarios,
        inmueble: carta.inmueble,
        precio_aceptar: carta.precio_contraoferta || carta.precio_oferta,
        precio_oferta: carta.precio_oferta,
        precio_contraoferta: carta.precio_contraoferta,
        apartado: carta.apartado,
        enganche: carta.enganche,
        saldo: carta.saldo,
        forma_pago: carta.forma_pago,
        vigencia_hrs: carta.vigencia_hrs,
        estatus: carta.estatus,
      },
    });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const accion = req.body?.accion === "contraoferta" ? "contraoferta" : "aceptar";
  const aceptadoPor = String(req.body?.aceptado_por || carta.propietarios || "").trim();
  if (!aceptadoPor) return res.status(400).json({ error: "Indica quién responde" });
  const correo = String(req.body?.correo || "").trim();
  const telefono = String(req.body?.telefono || "").trim();
  if (!correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    return res.status(400).json({ error: "Captura un correo válido" });
  }
  const montoContraoferta = Number(req.body?.precio_contraoferta || 0);
  if (accion === "contraoferta" && (!montoContraoferta || montoContraoferta <= 0)) {
    return res.status(400).json({ error: "Captura el monto de la contraoferta" });
  }

  const fecha = new Date().toISOString();
  const registro = [
    "",
    accion === "contraoferta"
      ? "=== CONTRAOFERTA DIGITAL DEL PROPIETARIO ==="
      : "=== ACEPTACIÓN DIGITAL DE OFERTA POR PROPIETARIO ===",
    `Fecha/hora: ${fecha}`,
    `${accion === "contraoferta" ? "Contraofertó" : "Aceptó"}: ${aceptadoPor}`,
    `Correo: ${correo}`,
    telefono ? `Teléfono: ${telefono}` : "",
    `Medio: Link público de aceptación`,
    accion === "contraoferta"
      ? `Monto contraofertado: ${fmt(montoContraoferta)}`
      : `Precio aceptado: ${fmt(carta.precio_contraoferta || carta.precio_oferta)}`,
    req.body?.notas ? `Notas del propietario: ${String(req.body.notas).trim()}` : "",
    `IP: ${getIp(req)}`,
    `User-Agent: ${req.headers["user-agent"] || ""}`,
  ].filter(Boolean).join("\n");

  const updatePayload = accion === "contraoferta" ? {
    estatus: "contraoferta",
    precio_contraoferta: montoContraoferta,
    notas: `${carta.notas || ""}${registro}`,
  } : {
    estatus: "aceptado",
    notas: `${carta.notas || ""}${registro}`,
  };

  const { error: updateError } = await supabase.from("cartas_oferta").update(updatePayload).eq("id", id);
  if (updateError) return res.status(500).json({ error: updateError.message });

  return res.status(200).json({ ok: true, fecha, accion });
}
