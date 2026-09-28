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
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
    }
  });
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
    return requestCorrelation.correlateResponse(response, correlated.requestId, operation);
  }
};
