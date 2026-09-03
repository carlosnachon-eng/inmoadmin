const datePart = (value) => String(value || '').slice(0, 10);

export const propertyWasAdministeredOn = (property, date) => {
  if (!property) return true;
  const endedAt = datePart(property.administration_ended_at);
  const referenceDate = datePart(date);
  return !endedAt || !referenceDate || referenceDate <= endedAt;
};

export const propertyWasAdministeredInPeriod = (property, period) => {
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) return propertyWasAdministeredOn(property, new Date().toISOString());
  return propertyWasAdministeredOn(property, `${period}-01`);
};

export const propertyIsCurrentlyAdministered = (property) =>
  propertyWasAdministeredOn(property, new Date().toISOString());

export const propertiesByName = (properties = []) => new Map(
  properties.map((property) => [property.name, property])
);
