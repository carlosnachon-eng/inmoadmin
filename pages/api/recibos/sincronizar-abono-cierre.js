import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function autenticar(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role_id")
    .eq("id", user.id)
    .maybeSingle();
  return ["admin", "gerente_ventas"].includes(profile?.role_id) ? user : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const user = await autenticar(req);
  if (!user) return res.status(401).json({ ok: false, error: "Sesión requerida" });

  const { abono_id } = req.body || {};
  if (!abono_id) return res.status(400).json({ ok: false, error: "Falta abono_id" });

  const { data: abono, error: abonoError } = await supabase
    .from("recibos_abonos")
    .select("id, recibo_id, monto, fecha, forma_pago, notas")
    .eq("id", abono_id)
    .single();
  if (abonoError || !abono) return res.status(404).json({ ok: false, error: "Abono no encontrado" });

  const { data: cierre } = await supabase
    .from("cierres")
    .select("id, comision, cobrado")
    .eq("recibo_id", abono.recibo_id)
    .maybeSingle();

  if (!cierre) {
    return res.status(200).json({ ok: true, pendiente_cierre: true });
  }

  const marcador = `recibo_abono:${abono.id}`;
  const { data: existente } = await supabase
    .from("cierre_pagos")
    .select("id")
    .eq("cierre_id", cierre.id)
    .ilike("notas", `%${marcador}%`)
    .maybeSingle();

  if (!existente) {
    const notas = [abono.notas, marcador].filter(Boolean).join(" · ");
    const { error: pagoError } = await supabase.from("cierre_pagos").insert({
      cierre_id: cierre.id,
      concepto: "complemento",
      monto: Number(abono.monto || 0),
      fecha: abono.fecha,
      metodo_pago: String(abono.forma_pago || "transferencia").toLowerCase(),
      notas,
    });
    if (pagoError) return res.status(500).json({ ok: false, error: pagoError.message });

    const cobrado = Number(cierre.cobrado || 0) + Number(abono.monto || 0);
    const pendiente = Math.max(0, Number(cierre.comision || 0) - cobrado);
    await supabase.from("cierres").update({
      cobrado,
      pendiente,
      cobrado_bool: Number(cierre.comision || 0) > 0 && cobrado >= Number(cierre.comision || 0),
      updated_at: new Date().toISOString(),
    }).eq("id", cierre.id);
  }

  return res.status(200).json({ ok: true, cierre_id: cierre.id });
}
