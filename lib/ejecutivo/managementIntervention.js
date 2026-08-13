export const MANAGEMENT_AUTO_REFRESH_MS = 60_000;
export const SESSION_EXPIRED_MESSAGE = "Tu sesión expiró. Inicia sesión nuevamente para continuar.";

function sessionExpiredError() {
  const error = new Error(SESSION_EXPIRED_MESSAGE);
  error.code = "session_expired";
  return error;
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function requestManagementIntervention({
  accessToken,
  method,
  body,
  refreshSession,
  fetchImpl = fetch,
}) {
  if (!accessToken) throw sessionExpiredError();

  const send = (token) => fetchImpl("/api/ejecutivo/management-intervention", {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  let response = await send(accessToken);
  let refreshedSession = null;

  if (response.status === 401) {
    try {
      const refreshed = await refreshSession();
      refreshedSession = refreshed?.data?.session || null;
    } catch {
      throw sessionExpiredError();
    }
    if (!refreshedSession?.access_token) throw sessionExpiredError();

    response = await send(refreshedSession.access_token);
    if (response.status === 401) throw sessionExpiredError();
  }

  return {
    response,
    json: await responseJson(response),
    refreshedSession,
  };
}

export function subscribeVisibleRefresh({
  refresh,
  windowObject = window,
  documentObject = document,
  intervalMs = MANAGEMENT_AUTO_REFRESH_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let intervalId = null;
  let refreshInFlight = false;
  let disposed = false;

  const isVisible = () => documentObject.visibilityState !== "hidden";
  const runRefresh = async () => {
    if (disposed || !isVisible() || refreshInFlight) return false;
    refreshInFlight = true;
    try {
      await refresh();
      return true;
    } finally {
      refreshInFlight = false;
    }
  };
  const runSafely = () => { runRefresh().catch(() => {}); };
  const stopPolling = () => {
    if (intervalId !== null) clearIntervalFn(intervalId);
    intervalId = null;
  };
  const startPolling = () => {
    if (!disposed && isVisible() && intervalId === null) {
      intervalId = setIntervalFn(runSafely, intervalMs);
    }
  };
  const onVisibilityChange = () => {
    if (isVisible()) {
      runSafely();
      startPolling();
    } else {
      stopPolling();
    }
  };
  const onFocus = () => { runSafely(); };

  windowObject.addEventListener("focus", onFocus);
  documentObject.addEventListener("visibilitychange", onVisibilityChange);
  startPolling();

  return () => {
    disposed = true;
    stopPolling();
    windowObject.removeEventListener("focus", onFocus);
    documentObject.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

export function resolveInterventionSignalState(intervention, snapshotsByContactId) {
  const signalType = intervention?.indicators?.signalType || null;
  if (signalType !== "sin_respuesta") {
    return {
      state: "undetermined",
      signalType,
      reason: "La señal no tiene todavía una regla determinística de resolución.",
    };
  }

  const respondContactId = intervention?.indicators?.respondContactId;
  const snapshot = respondContactId ? snapshotsByContactId.get(String(respondContactId)) : null;
  if (!snapshot) {
    return {
      state: "undetermined",
      signalType,
      reason: "No existe un snapshot actual para determinar la señal.",
    };
  }

  const conversationStatus = String(snapshot.respond_conversation_status || "").trim().toLowerCase();
  const unanswered = Boolean(snapshot.respond_unanswered_since);
  if (conversationStatus === "open" && unanswered) {
    return {
      state: "active",
      signalType,
      reason: "La conversación sigue abierta y esperando respuesta.",
    };
  }
  if (conversationStatus === "closed" || !unanswered) {
    return {
      state: "resolved",
      signalType,
      reason: conversationStatus === "closed"
        ? "La conversación está cerrada."
        : "La conversación ya no está esperando respuesta.",
    };
  }

  return {
    state: "undetermined",
    signalType,
    reason: "El estado actual de la conversación no permite determinar la señal.",
  };
}
