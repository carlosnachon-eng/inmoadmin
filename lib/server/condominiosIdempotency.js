import { HttpError } from "./condominiosAuth.js";
import { stableHash } from "./condominiosValidation.js";

export async function reserveIdempotency({ supabase, actorId, condominioId, key, payload }) {
  const requestHash = stableHash(payload);
  const { data: current, error: selectError } = await supabase
    .from("condominio_idempotency")
    .select("request_hash,response")
    .eq("actor_id", actorId)
    .eq("condominio_id", condominioId)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (selectError) throw new HttpError(500, "No fue posible validar la idempotencia");
  if (current) {
    if (current.request_hash !== requestHash) {
      throw new HttpError(409, "La llave de idempotencia ya fue usada con otros datos", "IDEMPOTENCY_CONFLICT");
    }
    if (current.response) return { cached: true, response: current.response, requestHash };
    throw new HttpError(409, "La operación con esta llave sigue en proceso", "IDEMPOTENCY_IN_PROGRESS");
  }

  const { error: insertError } = await supabase.from("condominio_idempotency").insert({
    actor_id: actorId,
    condominio_id: condominioId,
    idempotency_key: key,
    request_hash: requestHash,
  });
  if (insertError?.code === "23505") {
    throw new HttpError(409, "La operación con esta llave sigue en proceso", "IDEMPOTENCY_IN_PROGRESS");
  }
  if (insertError) throw new HttpError(500, "No fue posible reservar la operación");
  return { cached: false, requestHash };
}

export async function completeIdempotency({ supabase, actorId, condominioId, key, response }) {
  const { error } = await supabase
    .from("condominio_idempotency")
    .update({ response })
    .eq("actor_id", actorId)
    .eq("condominio_id", condominioId)
    .eq("idempotency_key", key);
  if (error) throw new HttpError(500, "La operación terminó pero no pudo registrarse de forma idempotente");
}

export async function releaseIdempotency({ supabase, actorId, condominioId, key }) {
  await supabase
    .from("condominio_idempotency")
    .delete()
    .eq("actor_id", actorId)
    .eq("condominio_id", condominioId)
    .eq("idempotency_key", key)
    .is("response", null);
}
