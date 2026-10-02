// No name matching, phone matching, client creation, canonical link creation or identity audits.
export async function resolveSocialAppointmentClient(admin, respondContactId) {
  const [links, opportunities] = await Promise.all([
    admin.from("respond_identity_links").select("client_identity_id,link_status").eq("respond_contact_id", respondContactId).in("link_status", ["confirmed", "conflict"]).limit(3),
    admin.from("gv_opportunities").select("cliente_id").eq("respond_contact_id", respondContactId).not("cliente_id", "is", null).limit(100),
  ]);
  if (links.error || opportunities.error) throw links.error || opportunities.error;
  if (links.data?.some((x) => x.link_status === "conflict") || links.data?.length > 1) return { clientId: null, reason: "identity_ambiguous" };
  const ids = [...new Set((opportunities.data || []).map((x) => x.cliente_id).filter(Boolean))];
  if (opportunities.data?.length === 100 || ids.length > 1) return { clientId: null, reason: "client_link_ambiguous" };
  if (!ids.length) return { clientId: null, reason: "client_link_missing" };
  return { clientId: ids[0], reason: "explicit_contact_opportunity_link" };
}
