const REQUEST_ID_HEADER = "X-RexBid-Request-ID";
const SAFE_ID = /^[0-9a-f-]{36}$/i;

function authOperation(path) {
  const match = /^\/api\/auth\/(signup|login|refresh|logout)$/.exec(path);
  return match?.[1] || "";
}

function correlateRequest(request, operation, cryptoImpl = globalThis.crypto) {
  if (!operation) return { request, requestId: "" };
  const requestId = cryptoImpl.randomUUID();
  if (!SAFE_ID.test(requestId)) throw new TypeError("Invalid generated request id");
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  return { request: new Request(request, { headers }), requestId };
}

function correlateResponse(response, requestId, operation, log = console.info) {
  if (!SAFE_ID.test(requestId || "")) return response;
  const headers = new Headers(response.headers);
  const setCookiePresent = headers.has("Set-Cookie");
  headers.set(REQUEST_ID_HEADER, requestId);
  headers.set("X-RexBid-Set-Cookie", setCookiePresent ? "present" : "absent");
  log("Rex.Bid staging auth response", JSON.stringify({ operation, stage: "response", request_id: requestId, http_status: response.status, set_cookie_present: setCookiePresent }));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

module.exports = { authOperation, correlateRequest, correlateResponse };
