// Keep this folding identical to the generated key in property_marketing_keywords.
export function normalizeMarketingKeyword(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/ +/g, ' ').toLowerCase();
}

export function validMarketingKeyword(value) {
  return typeof value === 'string' && value.length <= 60
    && /^[A-Za-z0-9 \u00c0-\u024f\u0300-\u036f-]+$/.test(value)
    && /^(?=.*[a-z])[a-z0-9]+(?:[ -][a-z0-9]+)*$/.test(normalizeMarketingKeyword(value));
}
