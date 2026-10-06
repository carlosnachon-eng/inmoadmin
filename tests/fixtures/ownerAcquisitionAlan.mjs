// Exact sanitized text and chronology supplied by the user, not fetched/replayed.
// Source identifiers are provenance ONLY. Executable tests use synthetic contacts.
export const alanRecordedSource = Object.freeze({
  provenance: "user_supplied_real_incident",
  respondContactId: "550316773",
  channelId: "498219",
  routeId: "3d37d19d-8b36-4da7-b141-0aab7df72099",
  observedDestination: "SALES",
  observedReason: "sales_intent",
});

export const alanRecordedTurns = Object.freeze([
  {
    at: "2026-10-03T01:42:30.000Z",
    text: "Hola buen dia",
    observedDestination: "SALES",
    observedReason: "whatsapp_compatible_fallback",
    observedStatus: "skipped",
  },
  {
    at: "2026-10-03T01:42:36.000Z",
    text: "Soy Alan Márquez.\n\nTengo disponibilidad de lofts en renta sobre Av. Juárez, Puebla, y estoy buscando una inmobiliaria que pueda apoyarnos con su **comercialización y colocación\n\nMe gustaría conocer su esquema de trabajo, comisión y condiciones para valorar una posible colaboración.\n\nQuedo atento. Muchas gracias.",
    expectedDestination: "OWNER",
  },
]);

// Synthetic follow-ups exercising the requested coverage, NOT Alan's transcript.
export const syntheticOwnerFollowups = Object.freeze([
  "¿Cuál es su comisión y cuáles son las condiciones?",
  "Buscamos renta tradicional para estos lofts.",
  "¿También manejan administración de los inmuebles?",
  "Les comparto la ubicación de los lofts.",
  "Estas son las fotos de los inmuebles.",
  "Los lofts tienen dos habitaciones y estacionamiento.",
  "Ahora busco una inmobiliaria para la comercialización de estos lofts.",
  "Quiero rentar una casa de mi propiedad con su apoyo para comercializarla.",
]);
