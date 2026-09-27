const clean = (value, limit = 500) => typeof value === "string" ? value.trim().slice(0, limit) : "";

class AuthConfigurationError extends Error {
  constructor() { super("AUTH_NOT_CONFIGURED"); this.name = "AuthConfigurationError"; }
}

class AuthProviderError extends Error {
  constructor(code, status = 502) { super(code); this.name = "AuthProviderError"; this.code = code; this.status = status; }
}

function createRexIdentity(input) {
  const issuer = clean(input?.issuer, 1000).replace(/\/$/, "");
  const subject = clean(input?.subject, 255);
  const authProvider = clean(input?.auth_provider, 80).toLowerCase();
  let issuerUrl;
  try { issuerUrl = new URL(issuer); } catch { throw new AuthProviderError("INVALID_IDENTITY", 401); }
  if (issuerUrl.protocol !== "https:" || issuerUrl.username || issuerUrl.password || issuerUrl.search || issuerUrl.hash || !subject || !authProvider) {
    throw new AuthProviderError("INVALID_IDENTITY", 401);
  }
  return Object.freeze({ issuer: issuerUrl.href.replace(/\/$/, ""), subject, email_verified: input?.email_verified === true, auth_provider: authProvider });
}

function createAuthProviderRegistry(providers = []) {
  const registry = new Map();
  for (const provider of providers) {
    if (!provider || typeof provider.id !== "string" || typeof provider.verifyIdentity !== "function" || registry.has(provider.id)) {
      throw new TypeError("Invalid or duplicate auth provider");
    }
    registry.set(provider.id, provider);
  }
  return Object.freeze({ get(id) { return registry.get(id) || null; }, ids() { return [...registry.keys()]; } });
}

module.exports = { AuthConfigurationError, AuthProviderError, createRexIdentity, createAuthProviderRegistry };
