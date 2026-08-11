export const INSTITUTIONAL_NOTIFICATION_RECIPIENTS = Object.freeze([
  "carlos.nachon@emporioinmobiliario.mx",
  "administracion@emporioinmobiliario.com.mx",
]);

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

export const mergeUniqueEmails = (...groups) => {
  const recipients = [];
  const seen = new Set();

  for (const value of groups.flat()) {
    const email = normalizeEmail(value);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    recipients.push(email);
  }

  return recipients;
};

export const resolveCoordinationNotificationRecipients = async (
  supabaseClient,
  { logger = console } = {}
) => {
  const fallback = [...INSTITUTIONAL_NOTIFICATION_RECIPIENTS];
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("email")
    .eq("role_id", "coord_operaciones")
    .eq("active", true)
    .order("email", { ascending: true });

  if (error) {
    logger.warn("No se pudieron resolver destinatarios activos de coord_operaciones", error.message);
    return {
      recipients: fallback,
      coordinationEmails: [],
      source: "institutional_fallback",
    };
  }

  const coordinationEmails = mergeUniqueEmails((data || []).map((profile) => profile.email));

  return {
    recipients: mergeUniqueEmails(fallback, coordinationEmails),
    coordinationEmails,
    source: "active_coord_operaciones_profiles",
  };
};
