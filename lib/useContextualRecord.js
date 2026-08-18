import { useEffect, useRef } from "react";

export function useContextualRecord(router, queryKey, ready, prepare) {
  const value = router?.query?.[queryKey];
  const prepareRef = useRef(prepare);
  prepareRef.current = prepare;
  useEffect(() => {
    if (!router?.isReady || !ready || !value) return;
    prepareRef.current?.(String(value));
    const timer = window.setTimeout(() => {
      const target = document.getElementById(`${queryKey}-${value}`);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.dataset.contextTarget = "true";
    }, 80);
    return () => window.clearTimeout(timer);
  }, [router?.isReady, value, ready, queryKey]);
  return value ? String(value) : "";
}

export const contextualRecordStyle = (selected) => selected
  ? { outline: "3px solid #f59e0b", outlineOffset: 2, scrollMarginTop: 96 }
  : {};

export function resolveServiceDeepLinkContext(query = {}, services = [], payments = []) {
  const serviceId = typeof query.serviceId === "string" ? query.serviceId : "";
  const paymentId = typeof query.paymentId === "string" ? query.paymentId : "";
  const period = typeof query.period === "string" && /^\d{4}-\d{2}$/.test(query.period) ? query.period : "";
  const service = serviceId ? services.find((row) => String(row.id) === serviceId) || null : null;
  const paymentCandidate = paymentId ? payments.find((row) => String(row.id) === paymentId) || null : null;
  const paymentBelongsToService = paymentCandidate && service && (
    String(paymentCandidate.servicio_id || "") === String(service.id)
    || (!paymentCandidate.servicio_id && paymentCandidate.tipo === service.tipo)
  );
  const payment = paymentBelongsToService && (!period || paymentCandidate.periodo === period) ? paymentCandidate : null;
  return { serviceId, paymentId, period, service, payment, tab: payment ? "historial" : "estado", paymentMissing: Boolean(paymentId && !payment) };
}
