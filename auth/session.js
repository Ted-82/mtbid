const utf8 = new TextEncoder();
const SESSION_COOKIE = "__Host-rexbid_session";
const FLOW_COOKIE = "__Host-rexbid_auth_flow";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const FLOW_MAX_AGE = 600;

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("INVALID_COOKIE");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function encryptionKey(secret, cryptoImpl) {
  if (typeof secret !== "string" || secret.length < 43) throw new Error("AUTH_COOKIE_SECRET_UNAVAILABLE");
  const digest = await cryptoImpl.subtle.digest("SHA-256", utf8.encode(`rex-bid-auth-cookie:v1:${secret}`));
  return cryptoImpl.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function sealCookiePayload(payload, secret, cryptoImpl = globalThis.crypto) {
  const key = await encryptionKey(secret, cryptoImpl);
  const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
  const ciphertext = await cryptoImpl.subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8.encode("rex-bid-auth-cookie:v1") }, key, utf8.encode(JSON.stringify(payload)));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

async function openCookiePayload(value, secret, cryptoImpl = globalThis.crypto) {
  try {
    const [version, ivPart, dataPart, extra] = String(value || "").split(".");
    if (version !== "v1" || !ivPart || !dataPart || extra) return null;
    const key = await encryptionKey(secret, cryptoImpl);
    const clear = await cryptoImpl.subtle.decrypt({ name: "AES-GCM", iv: base64UrlToBytes(ivPart), additionalData: utf8.encode("rex-bid-auth-cookie:v1") }, key, base64UrlToBytes(dataPart));
    const parsed = JSON.parse(new TextDecoder().decode(clear));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return null; }
  }
  return null;
}

function sessionCookie(value, maxAge = COOKIE_MAX_AGE) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAge))}; Secure; HttpOnly; SameSite=Lax`;
}

function flowCookie(value, maxAge = FLOW_MAX_AGE) {
  return `${FLOW_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAge))}; Secure; HttpOnly; SameSite=Lax`;
}

const clearSessionCookie = () => sessionCookie("", 0);
const clearFlowCookie = () => flowCookie("", 0);
const sessionCookieName = SESSION_COOKIE;
const flowCookieName = FLOW_COOKIE;
const sessionCookieMaxAge = COOKIE_MAX_AGE;
const flowCookieMaxAge = FLOW_MAX_AGE;

function isSameOriginWrite(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin && origin === new URL(origin).origin; }
  catch { return false; }
}

function safeReturnPath(value, fallback = "/konto.html") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const parsed = new URL(value, "https://rex.invalid");
    return parsed.origin === "https://rex.invalid" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
  } catch { return fallback; }
}

module.exports = {
  sealCookiePayload, openCookiePayload, readCookie, sessionCookie, flowCookie,
  clearSessionCookie, clearFlowCookie, sessionCookieName, flowCookieName,
  sessionCookieMaxAge, flowCookieMaxAge, isSameOriginWrite, safeReturnPath
};
