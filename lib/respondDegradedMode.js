// Operational hold for the Respond Growth cutover. Deliberately not inferred
// from recent traffic or overridable by old enable flags. Lifting this hold
// requires a reviewed cutover with a new NOT_BEFORE; never drain old jobs.
export const RESPOND_COMMERCIAL_HOLD = true;
export const RESPOND_FROZEN_NOTICE = "Datos de Respond sin sincronización en tiempo real";
export const commercialHeld = () => ({ status: "disabled", reason: "respond_commercial_hold" });
export function assertRespondCommercialAvailable() {
  if (RESPOND_COMMERCIAL_HOLD) throw new Error("respond_commercial_hold");
}
export function respondFreshness(rows = []) {
  const dates = rows.map(row => row.respond_last_synced_at).filter(value => value && Number.isFinite(Date.parse(value)));
  return { realtime: false, notice: RESPOND_FROZEN_NOTICE,
    lastUpdatedAt: dates.sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null };
}
