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
