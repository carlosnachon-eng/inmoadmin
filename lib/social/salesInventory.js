import { socialSalesProtected, isShortSocialCta, isInventoryAbsenceClaim, SOCIAL_CTA_CLARIFICATION, SOCIAL_INVENTORY_CLARIFICATION } from "./commercialIntent.js";

// Only authenticated, persisted attribution bound to this inbound can select an origin.
// A post/campaign name or model argument is not a property mapping.
export async function readSocialSalesContext(db, inbound, env = process.env) {
  if (!socialSalesProtected(inbound, env)) return null;
  let sourcePropertyId = null;
  if (inbound.social_route_id) {
    const route = await db.from("social_message_routes").select("source_property_id,occurred_at")
      .eq("id", inbound.social_route_id).eq("inbound_id", inbound.id).eq("destination", "SALES")
      .eq("respond_contact_id", inbound.respond_contact_id).eq("source_channel_id", String(inbound.channel_id)).maybeSingle();
    if (route.error) throw route.error;
    sourcePropertyId = route.data?.source_property_id || null;
    if (!sourcePropertyId && route.data?.occurred_at) {
      // Read only the immediately preceding journal entry. The RPC's predecessor
      // is a concurrency precondition, not a stored column. Tied timestamps or an
      // intervening non-SALES decision do not authorize reusing an older property.
      const previous = await db.from("social_message_routes").select("source_property_id,destination,occurred_at")
        .neq("id",inbound.social_route_id).eq("respond_contact_id",inbound.respond_contact_id)
        .eq("source_channel_id",String(inbound.channel_id)).lte("occurred_at",route.data.occurred_at)
        .order("occurred_at",{ascending:false}).limit(2);
      if(previous.error)throw previous.error;
      const [prior,tied]=previous.data||[];
      if(prior?.destination==="SALES" && new Date(prior.occurred_at)<new Date(route.data.occurred_at)
        && (!tied || new Date(tied.occurred_at).getTime()!==new Date(prior.occurred_at).getTime()))
        sourcePropertyId=prior.source_property_id||null;
    }
  }
  const context = { messageText: inbound.sanitized_text, sourcePropertyId: null, sourceProperty: null, inventory: null };
  if (sourcePropertyId) {
    const property = await db.from("propiedades").select("id,public_id,titulo").eq("id", sourcePropertyId).eq("status", "published").maybeSingle();
    if (property.error) throw property.error;
    if (property.data) { context.sourcePropertyId = property.data.id; context.sourceProperty = { publicId: property.data.public_id, title: property.data.titulo }; }
  }
  return context;
}

const STOP = new Set("a al algo atras adelante cerca col colonia con como de del detras el en es esa ese esta estas este estoy frente hola indicadas indicas inf info informacion informes la las lo los me mejor mi puedes puede podrias por que quiero quisiera se sobre su te una un unas unos ver vista y casa casas departamento departamentos terreno terrenos propiedad propiedades inmueble inmuebles renta venta necesito busco dar dame tiene tienen gustaria saber favor".split(" "));
// No punctuation/wildcards can reach PostgREST filter grammar. Bounded AND of ORs,
// not one literal phrase; no scan of arbitrary contacts or unbounded inventory.
export function inventoryTerms(value) {
  const tokens = String(value || "").toLowerCase().slice(0,500).match(/[\p{L}\p{N}]+/gu) || [];
  return [...new Set(tokens.filter(t => t.length >= 3 && !STOP.has(t.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))))].slice(0,4);
}
const locationClause = token => ["colonia", "ciudad", "titulo", "direccion"].map(k => `${k}.ilike.%${token}%`).join(",");

export function constrainSocialLocation(query, location) {
  for (const token of inventoryTerms(location)) query = query.or(locationClause(token));
  return query;
}

export async function searchSocialInventory(makeQuery, args, context) {
  if (context.sourcePropertyId) {
    const origin = await makeQuery().eq("id", context.sourcePropertyId);
    if (origin.error) throw origin.error;
    if (origin.data?.length) {
      context.inventory = { evidence: "verified_source_property", matchCount: origin.data.length };
      return origin.data;
    }
  }
  const terms = inventoryTerms(args?.zone || context.messageText);
  let query = makeQuery();
  for (const token of terms) query = query.or(locationClause(token));
  const result = await query;
  if (result.error) throw result.error;
  context.inventory = { evidence: result.data?.length ? "published_text_matches_not_source_confirmation" : "no_match_in_bounded_query_not_inventory_absence", matchCount: result.data?.length || 0 };
  return result.data || [];
}

export function socialSalesOutput(text, context) {
  if (!context) return text;
  if (isShortSocialCta(context.messageText) && !context.sourceProperty) return SOCIAL_CTA_CLARIFICATION;
  if (context.inventory?.matchCount === 0 || isInventoryAbsenceClaim(text)) return SOCIAL_INVENTORY_CLARIFICATION;
  return text;
}
