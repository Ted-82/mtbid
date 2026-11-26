// Temporary, owner-approved recovery of ONE pre-existing pending factor.
// New enrollments created after the approval cutoff can never qualify.
const HOST = "rexbid-auth-test.tedn828.workers.dev";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function restartWindow(request, env, nowSeconds) {
  if (new URL(request.url).origin !== `https://${HOST}` || env?.REXBID_AUTH_TEST_UI !== "enabled"
    || env?.REXBID_AUTH_TEST_HOST !== HOST || env?.AUTH_CANONICAL_ORIGIN !== `https://${HOST}`
    || env?.REXBID_OWNER_MFA_PENDING_RESTART !== "enabled") return null;
  const before = Date.parse(env.REXBID_OWNER_MFA_PENDING_BEFORE);
  const until = Date.parse(env.REXBID_OWNER_MFA_PENDING_UNTIL);
  const now = nowSeconds * 1000;
  if (!Number.isFinite(before) || !Number.isFinite(until) || before > now || until <= now
    || until <= before || until - before > 86400000) return null;
  return { before, until };
}
function eligiblePendingFactor(identity, before) {
  // Full provider list, not a truncated UI list; absence is not proof of zero.
  if (!Number.isFinite(before) || identity?.assurance_level !== "aal1"
    || identity?.mfa_factors_complete !== true || identity?.mfa_factor_count !== 1
    || identity?.mfa_has_verified_factor !== false || identity?.mfa_factors?.length !== 1) return null;
  const factor = identity.mfa_factors[0];
  if (!UUID.test(factor?.id || "") || factor.factor_type !== "totp" || factor.status !== "unverified") return null;
  const created = typeof factor.created_at === "string" ? Date.parse(factor.created_at) : NaN;
  return Number.isFinite(created) && created > 0 && created <= before ? factor : null;
}
module.exports = { restartWindow, eligiblePendingFactor };
