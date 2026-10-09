// Error bodies are untrusted: they may echo the entire request, names or secrets.
// Keep technical prose, NOT an allowlist of entire sentences. Unknown fragments
// are redacted, so a new error wording does not erase its entire explanation.
const TECHNICAL_WORDS = new Set(`a an the this that these those you your we our it its is are was were be been being has have had do does did not no and or but if for to from of on in at by with without as than since because when while can cannot could may must should will would required requires require necessary permission permissions access denied forbidden authorized unauthorized authentication authorization authenticate oauth token tokens valid invalid expired expiration session validating validation validate decrypted decrypt parse parsing malformed missing insufficient revoked granted grant scope scopes app application applications business account accounts whatsapp meta graph api cloud endpoint resource field fields object method operation action request requests supported unsupported support get post send sending sent message messages messaging behalf behalf_of behalf-of whatsapp_business_messaging whatsapp_business_management registered registration register unregistered phone number recipient allowed allow list failed failure undeliverable deliver delivery locked blocked disabled enabled enable restricted restriction restrictions limit limits rate exceeded available unavailable temporarily temporary service server internal error errors unknown occurred please check contact administrator status parameter parameters value values provided provide expected correct incorrect expired expired_token access_token user users system advanced standard review approved approval public published development live mode feature features product products attached assigned ownership owner does fulfill satisfy before after last customer replied reply response response_type more hours passed since capability capabilities opted opt window outside template templates use using only cannot_send reason billing payment credit balance insufficient funds reengagement daily throughput calls calling sip configured configuration settings verify verification verified expired credentials credential secret body payload header headers debug trace id ids invalid_parameter content attachment media image document`.split(/\s+/));
const TYPES = new Set(['OAuthException','GraphMethodException','APIException','FacebookApiException']);
function prose(value, sensitive, code) {
  if (typeof value !== 'string') return null;
  const marker='[REDACTED]';
  let text=value.normalize('NFKC');
  // Remove exact request values before tokenization or truncation. No raw fallback.
  for(const s of sensitive.filter(s=>typeof s==='string'&&s.length).sort((a,b)=>b.length-a.length)) {
    const escaped=s.normalize('NFKC').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    text=text.replace(new RegExp(escaped,'gi'),marker);
  }
  text=text.replace(/https?:\/\/[^\s]+|\b[^\s@]+@[^\s@]+\b/gi,marker)
    .replace(/"[^"\r\n]*"|'[^'\r\n]*'|`[^`\r\n]*`/g,marker)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g,' ');
  // Keep only the structured provider code as a numeric prefix, not IDs/numbers.
  const prefix=Number.isInteger(code)&&text.startsWith(`(#${code})`)?`(#${code}) `:'';
  if(prefix)text=text.slice(prefix.trim().length);
  text=text.replace(/\[REDACTED\]|[\p{L}\p{N}_+\/-]+|[^\s.,:;!?()]/gu,token=>
    token===marker||TECHNICAL_WORDS.has(token.toLowerCase())?token:marker);
  return (prefix+text.replace(/(?:\[REDACTED\][\s.,:;!?()-]*){2,}/g,marker+' ').replace(/\s+/g,' ').trim()).slice(0,500);
}
export function sanitizeManualMetaHttpError(httpStatus, body, sensitive=[]) {
  const e=body?.error;
  const integer=x=>Number.isSafeInteger(x)&&x>=0&&x<=2147483647?x:null;
  return {
    http_status:Number.isInteger(httpStatus)&&httpStatus>=300&&httpStatus<=599?httpStatus:null,
    code:integer(e?.code),subcode:integer(e?.error_subcode),
    type:TYPES.has(e?.type)?e.type:null,
    message:prose(e?.message,sensitive,integer(e?.code)),details:prose(e?.error_data?.details,sensitive,integer(e?.code))
    // fbtrace_id deliberately omitted: optional and not needed for diagnosis.
  };
}
