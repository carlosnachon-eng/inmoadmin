import {
  requireUser,
  sendApiError,
} from "../../../../lib/server/condominiosAuth";
import { asUuid } from "../../../../lib/server/condominiosValidation";

const ACTIONS = [
  "consultar","editar","importar_unidades","generar_cuotas","registrar_pago",
  "registrar_gasto","reversar_pago","reversar_gasto","cerrar_periodo",
  "reabrir_periodo","exportar","administrar_usuarios","subir_documento","enviar_recibo",
];

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });
  try {
    const condominioId = asUuid(req.query.id, "condominio_id");
    const context = await requireUser(req);
    const results = await Promise.all(ACTIONS.map(async (action) => {
      const { data, error } = await context.supabase.rpc("condominio_usuario_puede", {
        p_user_id: context.user.id,
        p_condominio_id: condominioId,
        p_accion: action,
        p_unidad_id: null,
      });
      if (error) throw error;
      return data ? action : null;
    }));
    return res.status(200).json({ ok: true, data: { acciones: results.filter(Boolean) } });
  } catch (error) {
    return sendApiError(res, error);
  }
}
