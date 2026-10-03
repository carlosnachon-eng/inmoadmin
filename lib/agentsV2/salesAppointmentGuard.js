// Separate asking/offering coordination from asserting a booked appointment.
// Strip only narrowly recognized non-committal clauses; retain dates/times and
// unknown claims for fail-closed review. This does not authorize booking tools.
export function hasSalesAppointmentCommitment(value) {
  const text = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(?:hoy|manana|ayer|lunes|martes|miercoles|jueves|viernes|sabado|domingo|fin de semana)\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}[/-]\d{1,2}\b|\ba las? (?:\d|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b|\bnos vemos\b|\b(?:puedes venir|podemos conocer)\b/.test(text)) return true;
  const safeInfo = text.replace(/\bte confirmo (?:cual es|la informacion publicada|(?:la )?disponibilidad)(?=[.!?;,]|$)/g, "");
  if (/\b(?:te (?:confirmo|agendo)|(?:cita|visita|horario|dia|reunion) (?:confirmad[oa]|agendad[oa])|queda (?:confirmad[oa]|agendad[oa])|te espero|paso por ti)\b/.test(safeInfo)) return true;
  const remaining = safeInfo
    .replace(/\b(?:para |podemos |puedes |puedo |quieres |te gustaria |un asesor puede )?(?:solicitar|coordinar|consultar|pedir|verificar) (?:una |la |tu )?(?:visita|cita)(?: con (?:un |tu |el )?asesor)?\b/g, "")
    .replace(/\b(?:la |una |tu )?(?:visita|cita) (?:aun |todavia )?(?:no esta confirmada|requiere confirmacion|esta pendiente de confirmacion)\b/g, "");
  return /\b(?:cita|visita|agendad[oa])\b/.test(remaining);
}
