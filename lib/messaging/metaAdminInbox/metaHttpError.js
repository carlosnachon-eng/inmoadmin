// Error bodies are untrusted: they may echo the entire request, names or secrets.
// Preserve only recognized provider diagnostic prose; unknown prose fails closed.
const SAFE_PROSE = /^(?:\(#\d{1,9}\)\s*)?(?:Permissions error|Permission denied|Access denied|Application does not have permission for this action|You do not have permission to access this resource|Invalid parameter|Invalid OAuth access token(?:\.| - Cannot parse access token)?|Error validating access token|The access token could not be decrypted|Unsupported post request\.?|Phone number not registered|Account not registered|Account has been locked|Business account is locked|Message failed to send because more than 24 hours have passed since the customer last replied to this number|Recipient phone number not in allowed list|Message Undeliverable|Service temporarily unavailable|An unknown error has occurred|Internal server error)\.?$/i;
const TYPES = new Set(['OAuthException','GraphMethodException','APIException','FacebookApiException']);
function prose(value, sensitive) {
  if (typeof value !== 'string') return null;
  // Check BEFORE truncating/normalizing; do not accidentally preserve a secret prefix.
  if (sensitive.some(s=>typeof s==='string'&&s.length&&value.includes(s))) return '[REDACTED]';
  const text=value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  return text.length<=500&&SAFE_PROSE.test(text)?text:'[REDACTED_UNRECOGNIZED_META_ERROR]';
}
export function sanitizeManualMetaHttpError(httpStatus, body, sensitive=[]) {
  const e=body?.error;
  const integer=x=>Number.isSafeInteger(x)&&x>=0&&x<=2147483647?x:null;
  return {
    http_status:Number.isInteger(httpStatus)&&httpStatus>=300&&httpStatus<=599?httpStatus:null,
    code:integer(e?.code),subcode:integer(e?.error_subcode),
    type:TYPES.has(e?.type)?e.type:null,
    message:prose(e?.message,sensitive),details:prose(e?.error_data?.details,sensitive)
    // fbtrace_id deliberately omitted: optional and not needed for diagnosis.
  };
}
