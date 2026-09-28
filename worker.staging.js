import rexWorker from "./worker.js";
import authTestHtml from "./staging/auth-test-page.js";
import requestCorrelation from "./staging/request-correlation.cjs";

const REQUIRED_TEST_HOST = "rexbid-auth-test.tedn828.workers.dev";

function testUiEnabled(url, env) {
  return env?.REXBID_AUTH_TEST_UI === "enabled"
    && env?.REXBID_AUTH_TEST_HOST === REQUIRED_TEST_HOST
    && url.hostname === REQUIRED_TEST_HOST;
}

function htmlResponse() {
  return new Response(authTestHtml, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
    }
  });
}

function rewriteCallback(response, requestUrl) {
  if (response.status !== 303) return response;
  const location = response.headers.get("Location");
  if (!location) return response;
  let destination;
  try { destination = new URL(location, requestUrl.origin); } catch { return response; }
  if (destination.origin !== requestUrl.origin || !["/konto.html", "/logowanie.html"].includes(destination.pathname)) return response;

  const headers = new Headers(response.headers);
  if (typeof response.headers.getSetCookie === "function") {
    const cookies = response.headers.getSetCookie();
    headers.delete("Set-Cookie");
    for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  }
  headers.set("Location", "/auth-test.html");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, executionContext) {
    const url = new URL(request.url);
    const enabled = testUiEnabled(url, env);
    if (url.pathname === "/auth-test.html") {
      return enabled ? htmlResponse() : new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    const operation = enabled && env?.REXBID_AUTH_DIAGNOSTICS === "enabled" ? requestCorrelation.authOperation(url.pathname) : "";
    const correlated = requestCorrelation.correlateRequest(request, operation);
    if (correlated.requestId) console.info("Rex.Bid staging auth request", JSON.stringify({ operation, stage: "request_received", request_id: correlated.requestId }));
    const response = await rexWorker.fetch(correlated.request, env, executionContext);
    const stagedResponse = requestCorrelation.correlateResponse(response, correlated.requestId, operation);
    if (enabled && url.pathname === "/api/auth/callback") return rewriteCallback(stagedResponse, url);
    return stagedResponse;
  }
};
