const fmtMoney = (value) => new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
}).format(Number(value) || 0);

const STATUS_LABELS = {
  published: "Publicada",
  reserved: "Apartada",
  sold: "Vendida",
  leased: "Rentada",
  draft: "Borrador",
  archived: "Archivada",
};

const propiedadTitulo = (property = {}) => (
  property.titulo
  || property.direccion
  || property.public_id
  || "Propiedad sin nombre"
);

const propiedadUbicacion = (property = {}) => [property.colonia, property.ciudad]
  .filter(Boolean)
  .join(", ");

const baseNews = (type, property, createdBy) => ({
  property_id: property?.id || null,
  property_public_id: property?.public_id || null,
  type,
  created_by: createdBy || null,
});

export const buildPropertyCreatedNews = (property, createdBy) => {
  if (!property || property.status !== "published") return null;
  const ubicacion = propiedadUbicacion(property);
  return {
    ...baseNews("created", property, createdBy),
    title: `Nueva propiedad: ${propiedadTitulo(property)}`,
    description: [
      property.operacion === "rental" ? "Disponible en renta" : "Disponible en venta",
      fmtMoney(property.precio),
      ubicacion,
    ].filter(Boolean).join(" · "),
    new_value: {
      precio: Number(property.precio) || 0,
      status: property.status,
      operacion: property.operacion,
      ubicacion,
    },
    priority: "high",
  };
};

export const buildPropertyPriceDropNews = (before, after, createdBy) => {
  const previousPrice = Number(before?.precio) || 0;
  const nextPrice = Number(after?.precio) || 0;
  if (!after || after.status !== "published" || !previousPrice || !nextPrice || nextPrice >= previousPrice) return null;
  return {
    ...baseNews("price_drop", after, createdBy),
    title: `Bajó de precio: ${propiedadTitulo(after)}`,
    description: `${fmtMoney(previousPrice)} a ${fmtMoney(nextPrice)}`,
    old_value: { precio: previousPrice },
    new_value: { precio: nextPrice },
    priority: "high",
  };
};

export const buildPropertyStatusNews = (before, after, createdBy, motivo = "") => {
  const previousStatus = before?.status;
  const nextStatus = after?.status;
  if (!after || !previousStatus || !nextStatus || previousStatus === nextStatus) return null;
  return {
    ...baseNews("status_changed", after, createdBy),
    title: `${STATUS_LABELS[nextStatus] || "Cambio de estatus"}: ${propiedadTitulo(after)}`,
    description: [
      `${STATUS_LABELS[previousStatus] || previousStatus} a ${STATUS_LABELS[nextStatus] || nextStatus}`,
      motivo,
    ].filter(Boolean).join(" · "),
    old_value: { status: previousStatus },
    new_value: { status: nextStatus },
    priority: ["published", "reserved", "sold", "leased"].includes(nextStatus) ? "high" : "normal",
  };
};

export const buildPropertyChangeNews = (before, after, createdBy) => [
  buildPropertyPriceDropNews(before, after, createdBy),
  buildPropertyStatusNews(before, after, createdBy),
].filter(Boolean);

export const registerPropertyNews = async (supabase, newsItems) => {
  const items = (Array.isArray(newsItems) ? newsItems : [newsItems]).filter(Boolean);
  if (!items.length) return { ok: true, count: 0 };

  const { error } = await supabase.from("property_news").insert(items);
  if (error) {
    console.warn("No se pudo registrar la noticia de inventario:", error.message);
    return { ok: false, error };
  }
  return { ok: true, count: items.length };
};
