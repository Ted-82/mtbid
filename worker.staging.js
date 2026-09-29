import rexWorker from "./worker.js";
import authTestHtml from "./staging/auth-test-page.js";
import requestCorrelation from "./staging/request-correlation.cjs";
import phaseD from "./staging/phase-d-discovery.cjs";

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
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
    }
  });
}

function stagingResponse(response, request) {
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), browsing-topics=()");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  if (headers.get("Content-Type")?.includes("text/html") || new URL(request.url).pathname.endsWith(".html") || new URL(request.url).pathname === "/auth-test.html") {
    headers.set("Cache-Control", "private, no-store");
    headers.set("Pragma", "no-cache");
  }
  if (new URL(request.url).pathname === "/robots.txt") {
    headers.set("Content-Type", "text/plain; charset=UTF-8");
    headers.set("Cache-Control", "no-store");
    return new Response("User-agent: *\nDisallow: /\n", { status: 200, headers });
  }
  if (new URL(request.url).pathname === "/sitemap.xml") {
    headers.set("Content-Type", "text/plain; charset=UTF-8");
    headers.set("Cache-Control", "no-store");
    return new Response("Not Found", { status: 404, headers });
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, executionContext) {
    const url = new URL(request.url);
    const enabled = testUiEnabled(url, env);
    if (url.pathname === "/auth-test.html") {
      return stagingResponse(enabled ? htmlResponse() : new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } }), request);
    }
    const phaseDResponse = await phaseD.handlePhaseDRequest(request, env, executionContext, (innerRequest, innerEnv, innerContext) => rexWorker.fetch(innerRequest, innerEnv, innerContext));
    if (phaseDResponse) return stagingResponse(phaseDResponse, request);
    const operation = enabled && env?.REXBID_AUTH_DIAGNOSTICS === "enabled" ? requestCorrelation.authOperation(url.pathname) : "";
    const correlated = requestCorrelation.correlateRequest(request, operation);
    if (correlated.requestId) console.info("Rex.Bid staging auth request", JSON.stringify({ operation, stage: "request_received", request_id: correlated.requestId }));
    const response = await rexWorker.fetch(correlated.request, env, executionContext);
    return stagingResponse(requestCorrelation.correlateResponse(response, correlated.requestId, operation), request);
  }
};
