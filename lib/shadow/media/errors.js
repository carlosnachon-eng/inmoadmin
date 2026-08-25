const MAX_ERROR_CODE_LENGTH = 80;

const CODE_STAGE_RULES = [
  [/^(enotfound|eai_again|dns_)/, "dns_resolution"],
  [/^rejected_network_target$/, "ssrf_validation"],
  [/^(err_invalid_ip_address|econnrefused|econnreset|enetunreach|ehostunreach|etimedout|media_connect_timeout)/, "tcp_connect"],
  [/^(cert_|unable_to_verify_|depth_|err_tls_|err_ssl_|tls_)/, "tls_handshake"],
  [/^(rejected_redirect_target|too_many_redirects)/, "redirect_validation"],
  [/^(media_too_large|media_download_timeout|stream_|err_stream_)/, "stream_read"],
  [/^(unsupported_or_invalid_magic|mime_mismatch|pdf_page_limit|invalid_or_encrypted_pdf)/, "content_validation"],
  [/^(pending_media_unavailable|media_http_error|http_)/, "http_request"],
];

export function normalizeMediaNetworkErrorCode(error) {
  const source = typeof error?.code === "string" && error.code.trim()
    ? error.code
    : (typeof error?.cause?.code === "string" && error.cause.code.trim() ? error.cause.code : null);
  if (!source) return "network_error_unknown";
  const normalized = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_ERROR_CODE_LENGTH)
    .replace(/_+$/g, "");
  return normalized && normalized !== "___" ? normalized : "network_error_unknown";
}

export function mediaNetworkErrorStage(errorOrCode) {
  const code = typeof errorOrCode === "string"
    ? normalizeMediaNetworkErrorCode({ code: errorOrCode })
    : normalizeMediaNetworkErrorCode(errorOrCode);
  return CODE_STAGE_RULES.find(([pattern]) => pattern.test(code))?.[1] ?? null;
}
