// Strict enums only: never copy upstream messages, bodies or identifiers.
const UPSTREAM_CODES = new Set([
  "mfa_factor_name_conflict", "mfa_factor_not_found", "mfa_factor_limit_reached",
  "mfa_totp_enroll_not_enabled", "mfa_totp_verify_not_enabled",
  "mfa_challenge_expired", "mfa_verification_failed", "mfa_verification_rejected",
  "over_request_rate_limit", "over_request_limit", "insufficient_aal",
  "session_not_found", "session_expired", "bad_jwt", "unexpected_failure", "validation_failed"
]);
const LOCAL_CODES = new Set([
  "MFA_ENROLLMENT_PENDING", "MFA_UNAVAILABLE", "MFA_INVALID_ENROLLMENT",
  "MFA_INVALID_CHALLENGE", "MFA_INVALID_SESSION", "MFA_REQUEST_REJECTED",
  "AUTH_TIMEOUT", "AUTH_UNAVAILABLE", "AUTH_UNEXPECTED_REDIRECT", "AUTH_REJECTED", "AUTH_RATE_LIMITED",
  "MFA_RESTART_BLOCKED", "MFA_RESTART_UNCERTAIN"
]);
const STAGES = new Set([
  "method", "owner_session", "configuration", "origin", "limiter", "session",
  "account_lookup", "owner_policy", "factor_state", "input", "enrollment_guard",
  "upstream_enroll", "enrollment_payload", "upstream_challenge", "challenge_payload",
  "challenge_receipt", "upstream_verify", "session_verification", "complete",
  "restart_preflight", "restart_recheck", "upstream_unenroll_pending", "restart_readback"
]);
const HOST = "rexbid-auth-test.tedn828.workers.dev";
function upstreamCode(payload) {
  for (const key of ["code", "error_code", "error"]) if (UPSTREAM_CODES.has(payload?.[key])) return payload[key];
  return null;
}
function safeCode(code) { return UPSTREAM_CODES.has(code) || LOCAL_CODES.has(code) ? code : "MFA_UNAVAILABLE"; }
function providerFailure(error, operation) {
  const code = safeCode(error?.upstreamCode || error?.code);
  const upstream = Number.isInteger(error?.upstreamStatus) && error.upstreamStatus >= 100 && error.upstreamStatus <= 599 ? error.upstreamStatus : null;
  let status = 503;
  if (code === "MFA_RESTART_BLOCKED") status = 409;
  else if (code === "mfa_factor_name_conflict" || code === "mfa_factor_limit_reached") status = 409;
  else if (upstream === 429 || code === "AUTH_RATE_LIMITED") status = 429;
  else if (upstream === 401 || code === "session_not_found" || code === "session_expired" || code === "bad_jwt") status = 401;
  else if (code === "insufficient_aal") status = 403;
  else if (code === "mfa_factor_not_found" || (operation === "verify" && error?.status === 401)) status = 400;
  return { status, code, upstream_status: upstream };
}
function diagnosticsEnabled(request, env) {
  return env?.REXBID_AUTH_DIAGNOSTICS === "enabled" && env?.REXBID_AUTH_TEST_UI === "enabled"
    && env?.REXBID_AUTH_TEST_HOST === HOST && new URL(request.url).origin === `https://${HOST}`;
}
function diagnostic({ requestId, operation, stage, status, failure, factors }) {
  return {
    request_id: requestId, operation, stage: STAGES.has(stage) ? stage : "owner_session",
    http_status: status, upstream_status: failure?.upstream_status ?? null,
    safe_code: failure ? safeCode(failure.code) : status >= 400 ? "MFA_REQUEST_REJECTED" : null,
    verified_totp_count: factors ? factors.filter(f => f.status === "verified").length : null,
    pending_totp_count: factors ? factors.filter(f => f.status === "unverified").length : null
  };
}
module.exports = { upstreamCode, providerFailure, diagnosticsEnabled, diagnostic };
