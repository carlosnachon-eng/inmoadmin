import {
  enforceRateLimit,
  HttpError,
  requireUser,
  sendApiError,
} from "../../../lib/server/condominiosAuth";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });
  try {
    const context = await requireUser(req);
    await enforceRateLimit(context.supabase, `portal:${context.user.id}`, 60, 60);
    const { data: memberships, error: memberError } = await context.supabase
      .from("condominio_miembros")
      .select("condominio_id,unidad_id,rol")
      .eq("user_id", context.user.id)
      .eq("activo", true)
      .in("rol", ["condomino", "residente"]);
    if (memberError) throw new Error(memberError.message);
    if (!memberships?.length) return res.status(200).json({ ok: true, data: { unidades: [] } });

    const unitIds = [...new Set(memberships.map((item) => item.unidad_id).filter(Boolean))];
    if (!unitIds.length) throw new HttpError(403, "Las membresías del portal no tienen unidades asignadas");
    const { data: units, error: unitError } = await context.supabase
      .from("unidades_condominio")
      .select("*, condominios(id,nombre,direccion,total_unidades,cuota_mensual)")
      .in("id", unitIds)
      .eq("activo", true);
    if (unitError) throw new Error(unitError.message);

    const data = [];
    for (const unit of units || []) {
      const [{ data: fees, error: feeError }, { data: expenses, error: expenseError }] = await Promise.all([
        context.supabase.from("cuotas_condominio")
          .select("id,periodo,monto,status,fecha_vencimiento,fecha_pago,comprobante_documento_id,recibo_documento_id,unidad_id")
          .eq("condominio_id", unit.condominio_id).eq("unidad_id", unit.id).order("periodo", { ascending: false }),
        context.supabase.from("gastos_condominio")
          .select("id,concepto,categoria,monto,fecha,notas,documento_id")
          .eq("condominio_id", unit.condominio_id).is("reversed_at", null).order("fecha", { ascending: false }).limit(20),
      ]);
      if (feeError || expenseError) throw new Error(feeError?.message || expenseError?.message);
      data.push({ unidad: unit, condominio: unit.condominios, cuotas: fees || [], gastos: expenses || [] });
    }
    return res.status(200).json({ ok: true, data: { unidades: data } });
  } catch (error) {
    return sendApiError(res, error);
  }
}
