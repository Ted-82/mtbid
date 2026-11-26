const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {JSDOM} = require("jsdom");

const source = fs.readFileSync(path.join(__dirname, "../public/rexbid-owner-mfa.js"), "utf8");
const FACTOR = "6b6d030f-0a58-4d23-aa81-424dc5b47adf";
const CHALLENGE = "681eed99-3844-42b5-b0a2-70412a855654";
const SECRET = "JBSWY3DPEHPK3PXP";
const QR = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 2 2"><path fill="#000" d="M0 0h1v1H0z"/></svg>');
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
const response = (status, value) => ({ok: status >= 200 && status < 300, status, json: async () => value});
const state = (level = "aal1", factors = [{id: FACTOR, friendly_name: "Telefon właściciela", factor_type: "totp", status: "verified"}]) => ({ok: true, owner: true, assurance_level: level, factors});

// These tests execute the actual UI script in a DOM. They verify behavior and
// security boundaries, not browser layout, a live Supabase session or hosting.
async function page(t, {handler, initial = state(), url = "https://rexbid.pl/administracja.html"} = {}) {
  const dom = new JSDOM('<!doctype html><html lang="pl"><body><div id="rexbid-owner-mfa"></div></body></html>', {
    url, runScripts: "outside-only"
  });
  t.after(() => dom.window.close());
  const {window: win} = dom;
  const doc = win.document;
  await new Promise(resolve => doc.addEventListener("DOMContentLoaded", resolve, {once: true}));
  const requests = [], events = [];
  Object.defineProperty(win, "localStorage", {get() { throw new Error("MFA must not access localStorage"); }});
  Object.defineProperty(win, "sessionStorage", {get() { throw new Error("MFA must not access sessionStorage"); }});
  win.fetch = async (url, options) => {
    const request = {url, options, payload: options.body ? JSON.parse(options.body) : null};
    requests.push(request);
    if (handler) return await handler(request, requests);
    if (url === "/api/portal/security") return response(200, initial);
    if (url.endsWith("/enroll")) return response(201, {ok: true, factor: {id: FACTOR, factor_type: "totp", secret: SECRET, qr_code: QR, uri: "otpauth://totp/REXBID?secret=" + SECRET}});
    if (url.endsWith("/challenge")) return response(200, {ok: true, challenge_id: CHALLENGE, expires_at: 1900000000});
    if (url.endsWith("/verify")) return response(200, {ok: true, assurance_level: "aal2"});
    throw new Error("Unexpected endpoint: " + url);
  };
  doc.addEventListener("rexbid:owner-mfa-verified", event => events.push(event));
  win.eval(source);
  await flush();
  const element = doc.getElementById("rexbid-owner-mfa");
  const submit = value => {
    const form = element.querySelector("form");
    const input = form.elements.namedItem("owner_mfa_code");
    input.value = value;
    form.dispatchEvent(new win.Event("submit", {bubbles: true, cancelable: true}));
    return input;
  };
  return {win, doc, element, requests, events, submit};
}

test("owner with an existing verified TOTP receives a code form and makes only a private no-store GET", async t => {
  const p = await page(t);
  assert.equal(p.requests.length, 1);
  assert.equal(p.requests[0].url, "/api/portal/security");
  assert.equal(p.requests[0].options.credentials, "same-origin");
  assert.equal(p.requests[0].options.cache, "no-store");
  assert.equal(p.requests[0].options.redirect, "error");
  assert.equal(p.requests[0].options.method, "GET");
  assert.equal(p.requests[0].options.body, undefined);
  assert.match(p.element.textContent, /Wpisz aktualny kod/);
  assert.equal(p.element.querySelector("input").autocomplete, "one-time-code");
  assert.equal(p.element.querySelector("input").inputMode, "numeric");
  assert.equal(p.element.querySelector(".portal-mfa-secret"), null);
});

test("pending TOTP offers continuation, never reenrolls on reload and verifies with the original factor", async t => {
  const initial = state("aal1", [{id: FACTOR, factor_type: "totp", status: "unverified"}]);
  const p = await page(t, {initial});
  assert.match(p.element.textContent, /nie jest jeszcze potwierdzona/);
  assert.match(p.element.textContent, /Poprzedniego QR ani klucza nie można odczytać ponownie/);
  assert.equal(p.element.querySelector("img,.portal-mfa-secret"), null);
  assert.doesNotMatch(p.element.textContent, /Skonfiguruj ochronę konta/);
  await p.win.RexbidOwnerMfa.mount(p.element).refresh();
  await flush();
  assert.equal(p.requests.every(r => r.options.method === "GET"), true);
  p.submit("123456"); await flush();
  assert.equal(p.events.length, 1);
  assert.equal(p.requests.some(r => r.url.endsWith("/enroll") || r.options.method === "DELETE"), false);
  assert.equal(p.requests.find(r => r.url.endsWith("/challenge")).payload.factor_id, FACTOR);
});

test("one explicit staging restart click removes pending then opens new QR without submitting any verification code", async t => {
  let releaseReset;
  const pending = {...state("aal1", [{id:FACTOR, factor_type:"totp", status:"unverified"}]), restart_pending_available:true};
  const p = await page(t, {url:"https://rexbid-auth-test.tedn828.workers.dev/administracja", handler: async r => {
    if (r.url.endsWith("/restart-pending")) { await new Promise(resolve => {releaseReset=resolve;}); return response(200, {ok:true, removed_pending:true}); }
    if (r.url.endsWith("/enroll")) return response(201, {ok:true, factor:{id:FACTOR, factor_type:"totp", secret:SECRET, qr_code:QR}});
    return response(200, pending);
  }});
  assert.equal(p.requests.length, 1, "page load is read-only");
  const button = [...p.element.querySelectorAll("button")].find(b => b.textContent === "Rozpocznij konfigurację QR od nowa");
  assert.ok(button);
  button.click(); button.click();
  await flush();
  assert.equal(button.disabled, true);
  assert.equal(p.requests.filter(r => r.url.endsWith("/restart-pending")).length, 1);
  assert.deepEqual(p.requests[1].payload, {factor_id:FACTOR});
  releaseReset(); await flush();
  assert.deepEqual(p.requests.map(r => r.url), ["/api/portal/security", "/api/portal/security/restart-pending", "/api/portal/security/enroll"]);
  assert.equal(p.element.querySelector("img").src, QR);
  assert.equal(p.element.querySelector(".portal-mfa-secret").textContent, SECRET);
  assert.doesNotMatch(p.element.querySelector(".portal-mfa-diagnostics").textContent, new RegExp(SECRET));
  assert.doesNotMatch(p.element.textContent, /Rozpocznij konfigurację QR od nowa/);
  assert.equal(p.events.length, 0, "only the owner will scan and verify");
});

test("pending restart is absent without a server grant, on production and with any verified factor", async t => {
  for (const [url, granted, factors] of [
    ["https://rexbid.pl/administracja", true, [{id:FACTOR, factor_type:"totp", status:"unverified"}]],
    ["https://rexbid-auth-test.tedn828.workers.dev/administracja", false, [{id:FACTOR, factor_type:"totp", status:"unverified"}]],
    ["https://rexbid-auth-test.tedn828.workers.dev/administracja", true, [{id:FACTOR, factor_type:"totp", status:"verified"}]]
  ]) {
    const p = await page(t, {url, initial:{...state("aal1", factors), restart_pending_available:granted}});
    assert.doesNotMatch(p.element.textContent, /Rozpocznij konfigurację QR od nowa/);
    assert.equal(p.requests.length, 1);
  }
});

test("blocked or uncertain restart never enrolls or retries automatically", async t => {
  for (const status of [409,503]) {
    const p = await page(t, {url:"https://rexbid-auth-test.tedn828.workers.dev/administracja", handler: async r => r.url.endsWith("/restart-pending")
      ? response(status, {ok:false, code:status === 409 ? "MFA_RESTART_BLOCKED" : "MFA_RESTART_UNCERTAIN"})
      : response(200, {...state("aal1", [{id:FACTOR, factor_type:"totp", status:"unverified"}]), restart_pending_available:true})});
    [...p.element.querySelectorAll("button")].find(b => b.textContent === "Rozpocznij konfigurację QR od nowa").click();
    await flush();
    assert.equal(p.requests.length, 2);
    assert.equal(p.requests.some(r => r.url.endsWith("/enroll")), false);
    assert.equal(p.element.querySelector("img,.portal-mfa-secret"), null);
    assert.match(p.element.textContent, /Sprawdź istniejącą konfigurację/);
  }
});

test("verified factors take precedence over pending factors, including a verified factor outside the bounded list", async t => {
  const pending = {id: "pending-fixture-factor", factor_type: "totp", status: "unverified"};
  const p = await page(t, {initial: state("aal1", [pending, {id: FACTOR, factor_type: "totp", status: "verified"}])});
  p.submit("123456"); await flush();
  assert.equal(p.requests.find(r => r.url.endsWith("/challenge")).payload.factor_id, FACTOR);
  const hiddenVerified = await page(t, {initial: {...state("aal1", [pending]), has_verified_factor: true}});
  assert.match(hiddenVerified.element.textContent, /Konto ma już drugi składnik/);
  assert.equal(hiddenVerified.element.querySelector("form,button"), null);
});

test("conflicting enrollment exposes only safe staging stages and requires a state check instead of another POST", async t => {
  const diagnostic = {request_id: FACTOR, operation: "enroll", stage: "upstream_enroll", http_status: 409,
    upstream_status: 422, safe_code: "mfa_factor_name_conflict", pending_totp_count: 1, verified_totp_count: 0,
    token: "PRIVATE_TOKEN", qr: "PRIVATE_QR", secret: "PRIVATE_SECRET", email: "PRIVATE_EMAIL"};
  const handler = async (r, requests) => r.url.endsWith("/enroll")
    ? response(409, {ok: false, code: "mfa_factor_name_conflict", error: "PRIVATE_RAW_UPSTREAM", diagnostic})
    : response(200, state("aal1", requests.length > 1 ? [{id: FACTOR, status: "unverified", factor_type: "totp"}] : []));
  const p = await page(t, {url: "https://rexbid-auth-test.tedn828.workers.dev/administracja.html", handler});
  p.element.querySelector("button").click(); await flush();
  assert.match(p.element.textContent, /Istnieje już konfiguracja/);
  assert.match(p.element.querySelector(".portal-mfa-diagnostics").textContent, /enroll · upstream_enroll · HTTP 409 · Supabase 422 · mfa_factor_name_conflict/);
  assert.doesNotMatch(p.element.textContent, /PRIVATE_/);
  assert.equal(p.requests.filter(r => r.url.endsWith("/enroll")).length, 1);
  p.element.querySelector("button").click(); await flush();
  assert.match(p.element.textContent, /nie jest jeszcze potwierdzona/);
  assert.equal(p.requests.filter(r => r.url.endsWith("/enroll")).length, 1);
  assert.match(p.element.querySelector(".portal-mfa-diagnostics").textContent, /mfa_factor_name_conflict/, "next state read must not lose the original error");
  const production = await page(t, {handler});
  production.element.querySelector("button").click(); await flush();
  assert.equal(production.element.querySelector(".portal-mfa-diagnostics"), null);
  assert.doesNotMatch(production.element.textContent, /upstream_enroll|PRIVATE_/);
});

test("verification requests a fresh same-browser challenge, submits exact factor and code, then removes the code and notifies the portal", async t => {
  const p = await page(t);
  let callbacks = 0;
  p.win.RexbidOwnerMfa.mount(p.element, {onVerified() { callbacks++; }});
  const input = p.submit("123456");
  assert.equal(input.value, "", "code is cleared before awaiting the network");
  await flush();
  assert.equal(p.requests.length, 3);
  assert.equal(p.requests[1].url, "/api/portal/security/challenge");
  assert.deepEqual(p.requests[1].payload, {factor_id: FACTOR});
  assert.deepEqual(p.requests[2].payload, {factor_id: FACTOR, challenge_id: CHALLENGE, code: "123456"});
  for (const r of p.requests.slice(1)) {
    assert.equal(r.options.method, "POST");
    assert.equal(r.options.credentials, "same-origin");
    assert.equal(r.options.headers["Content-Type"], "application/json");
  }
  assert.equal(p.events.length, 1);
  assert.equal(callbacks, 1);
  assert.equal(p.element.querySelector("form"), null);
  assert.match(p.element.textContent, /zweryfikowane drugim składnikiem/);
  assert.equal(p.element.getAttribute("aria-busy"), null);
  assert.equal(p.element.querySelector("section").getAttribute("aria-busy"), "false");
});

test("initial enrollment requires an explicit action and shows a safe image and ephemeral secret until the server confirms aal2", async t => {
  const p = await page(t, {initial: state("aal1", [])});
  assert.equal(p.requests.length, 1);
  assert.equal(p.element.querySelector("form"), null);
  p.element.querySelector("button").click();
  await flush();
  assert.deepEqual(p.requests[1].payload, {});
  assert.equal(p.requests[1].url, "/api/portal/security/enroll");
  assert.equal(p.element.querySelector(".portal-mfa-secret").textContent, SECRET);
  assert.equal(p.element.querySelector("img").src, QR);
  assert.equal(p.element.querySelector("svg"), null, "QR is an image, never inserted as active DOM markup");
  assert.equal(p.element.querySelector('a[href^="otpauth:"]'), null);
  p.submit("654321");
  await flush();
  assert.equal(p.events.length, 1);
  assert.equal(p.element.querySelector("img"), null);
  assert.equal(p.element.querySelector(".portal-mfa-secret"), null);
  assert.equal(p.element.textContent.includes(SECRET), false);
});

test("QR markup containing a script, foreign object, event handler or external reference cannot become an image", async t => {
  const badSvg = [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>window.fixtureExecuted=true</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="https://evil.example"/></foreignObject></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="window.fixtureExecuted=true"><path d="M0 0"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(https://evil.example/a.svg)" d="M0 0"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:black;stroke:none;background:url(https://evil.example)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="https://evil.example"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="https://evil.example"><rect width="1"/></svg>'
  ];
  for (const markup of badSvg) {
    const p = await page(t, {handler: async r => r.url.endsWith("/enroll")
      ? response(201, {ok: true, factor: {id: FACTOR, factor_type: "totp", secret: SECRET, qr_code: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup)}})
      : response(200, state("aal1", []))});
    p.element.querySelector("button").click(); await flush();
    assert.equal(p.element.querySelector("img"), null);
    assert.equal(p.element.querySelector("script,svg,iframe"), null);
    assert.equal(p.win.fixtureExecuted, undefined);
    assert.equal(p.element.querySelector(".portal-mfa-secret").textContent, SECRET, "manual setup remains available");
  }
});

test("missing QR keeps manual setup clear and separate from the six-digit verification code", async t => {
  const p = await page(t, {handler: async r => {
    if (r.url.endsWith("/enroll")) return response(201, {ok: true, factor: {id: FACTOR, factor_type: "totp", secret: SECRET, qr_code: null}});
    if (r.url.endsWith("/challenge")) return response(200, {ok: true, challenge_id: CHALLENGE});
    if (r.url.endsWith("/verify")) return response(200, {ok: true, assurance_level: "aal2"});
    return response(200, state("aal1", []));
  }});
  p.element.querySelector("button").click(); await flush();
  assert.equal(p.element.querySelector("img"), null);
  assert.match(p.element.textContent, /Kod QR nie jest dostępny/);
  assert.match(p.element.textContent, /Dodaj konto ręcznie/);
  assert.match(p.element.textContent, /kod oparty na czasie \(TOTP\)/);
  assert.equal(p.element.querySelector(".portal-mfa-secret").textContent, SECRET);
  assert.match(p.element.querySelector(".portal-mfa-key-label").textContent, /w aplikacji na telefonie/);
  assert.equal(p.element.querySelector("input").maxLength, 6);
  p.submit("654321"); await flush();
  assert.equal(p.events.length, 1, "manual setup uses the same server-side challenge and verification");
  assert.equal(p.element.textContent.includes(SECRET), false);
});

test("QR image loading failure replaces the failed image with manual setup without re-enrollment", async t => {
  const p = await page(t, {initial: state("aal1", [])});
  p.element.querySelector("button").click(); await flush();
  const image = p.element.querySelector("img");
  assert.ok(image);
  image.dispatchEvent(new p.win.Event("error"));
  assert.equal(p.element.querySelector("img"), null);
  assert.match(p.element.textContent, /Nie udało się wyświetlić kodu QR/);
  assert.match(p.element.textContent, /Dodaj konto ręcznie/);
  assert.equal(p.element.querySelector(".portal-mfa-secret").textContent, SECRET);
  assert.equal(p.requests.length, 2, "an image error never creates a new TOTP factor");
  p.submit("654321"); await flush();
  assert.equal(p.events.length, 1);
});

test("QR network URLs and oversized data are rejected while factor names remain literal text", async t => {
  const factors = [
    {id: FACTOR, factor_type: "totp", status: "verified", friendly_name: '<img src=x onerror="window.fixtureExecuted=true">'},
    {id: CHALLENGE, factor_type: "totp", status: "verified", friendly_name: "Drugi telefon"}
  ];
  const p = await page(t, {initial: state("aal1", factors)});
  assert.equal(p.element.querySelector("select").options[0].textContent, factors[0].friendly_name);
  assert.equal(p.element.querySelector("img"), null);
  assert.equal(p.win.fixtureExecuted, undefined);
  p.element.querySelector("select").value = CHALLENGE;
  p.element.querySelector("select").dispatchEvent(new p.win.Event("change"));
  p.submit("123456"); await flush();
  assert.equal(p.requests[1].payload.factor_id, CHALLENGE);
  for (const qr of ["https://evil.example/qr.svg", "data:image/svg+xml;charset=utf-8," + "x".repeat(180001)]) {
    const q = await page(t, {handler: async r => r.url.endsWith("/enroll")
      ? response(201, {ok: true, factor: {id: FACTOR, secret: SECRET, qr_code: qr}})
      : response(200, state("aal1", []))});
    q.element.querySelector("button").click(); await flush();
    assert.equal(q.element.querySelector("img"), null);
    assert.equal(q.requests.length, 2, "QR never triggers an application fetch");
  }
});

test("already verified aal2 and unsupported existing second factors do not trigger enrollment", async t => {
  const p = await page(t, {initial: state("aal2")});
  assert.equal(p.element.querySelector("form,button"), null);
  assert.equal(p.events.length, 0, "a GET does not claim a newly completed verification");
  assert.match(p.element.textContent, /zweryfikowane drugim składnikiem/);
  const q = await page(t, {initial: state("aal1", [{id: FACTOR, factor_type: "phone", status: "verified"}])});
  assert.equal(q.element.querySelector("form,button"), null);
  assert.match(q.element.textContent, /Konto ma już drugi składnik/);
  assert.equal(q.requests.length, 1);
});

test("anonymous, forbidden and disabled responses keep administration closed and show actionable Polish errors", async t => {
  for (const status of [401, 403, 503]) {
    const p = await page(t, {handler: async () => response(status, {ok: false, error: "Server internal detail must not be displayed"})});
    assert.equal(p.element.querySelector("form,input"), null);
    assert.equal(p.requests.length, 1);
    assert.equal(p.events.length, 0);
    assert.equal(p.element.textContent.includes("Server internal detail"), false);
    if (status === 401) assert.equal(p.element.querySelector("a").href, "https://rexbid.pl/logowanie.html?return_to=%2Fadministracja.html");
    if (status === 403) assert.match(p.element.textContent, /nie ma uprawnień/);
    if (status === 503) assert.match(p.element.textContent, /pozostaje zamknięty/);
    assert.equal(p.element.querySelector("button").disabled, false);
  }
});

test("a claimed aal2 response without the server's owner flag cannot unlock the panel", async t => {
  const p = await page(t, {initial: {...state("aal2"), owner: false}});
  assert.equal(p.events.length, 0);
  assert.equal(p.element.querySelector("form"), null);
  assert.match(p.element.textContent, /nie ma uprawnień/);
});

test("malformed codes are cleared and never create a challenge", async t => {
  const p = await page(t);
  for (const value of ["12345", "1234567", "12ab56", "<svg>", ""]) {
    const input = p.submit(value);
    assert.equal(input.value, "");
    await flush();
    assert.equal(p.requests.length, 1);
    assert.match(p.element.textContent, /Wpisz sześciocyfrowy/);
  }
});

test("a failed challenge never sends the code and a failed verify is not retried automatically", async t => {
  const p = await page(t, {handler: async r => r.url.endsWith("/challenge")
    ? response(403, {ok: false}) : response(200, state())});
  p.submit("123456"); await flush();
  assert.equal(p.requests.length, 2);
  assert.equal(p.requests.some(r => r.url.endsWith("/verify")), false);
  assert.equal(p.events.length, 0);
  assert.match(p.element.textContent, /wygasła/);
  assert.equal(p.element.querySelector("button").disabled, false);
  const q = await page(t, {handler: async r => {
    if (r.url.endsWith("/verify")) return response(429, {ok: false});
    if (r.url.endsWith("/challenge")) return response(200, {ok: true, challenge_id: CHALLENGE});
    return response(200, state());
  }});
  q.submit("123456"); await flush();
  assert.equal(q.requests.length, 3);
  assert.equal(q.events.length, 0);
  assert.equal(q.element.querySelector("input").value, "");
  assert.match(q.element.textContent, /Zbyt wiele prób/);
  q.submit("654321"); await flush();
  assert.equal(q.requests.length, 5);
  assert.equal(q.requests[3].url, "/api/portal/security/challenge", "a deliberate new attempt starts with a new challenge");
});

test("verification does not report success when an upstream reply omits aal2", async t => {
  const p = await page(t, {handler: async r => {
    if (r.url.endsWith("/challenge")) return response(200, {ok: true, challenge_id: CHALLENGE});
    if (r.url.endsWith("/verify")) return response(200, {ok: true, assurance_level: "aal1"});
    return response(200, state());
  }});
  p.submit("123456"); await flush();
  assert.equal(p.events.length, 0);
  assert.equal(p.element.querySelector("form") !== null, true);
  assert.match(p.element.querySelector('[role="status"]').textContent, /Nie udało się/);
});

test("concurrent submissions are blocked and mounting the same element twice cannot create duplicate requests", async t => {
  let finishChallenge;
  const challenge = new Promise(resolve => { finishChallenge = resolve; });
  const p = await page(t, {handler: async r => {
    if (r.url.endsWith("/challenge")) return challenge;
    if (r.url.endsWith("/verify")) return response(200, {ok: true, assurance_level: "aal2"});
    return response(200, state());
  }});
  const first = p.win.RexbidOwnerMfa.mount(p.element);
  assert.equal(p.win.RexbidOwnerMfa.mount(p.element), first);
  assert.equal(p.requests.length, 1);
  p.submit("123456");
  p.submit("999999");
  assert.equal(p.requests.length, 2);
  assert.equal(p.element.querySelector("button").disabled, true);
  finishChallenge(response(200, {ok: true, challenge_id: CHALLENGE}));
  await flush();
  assert.equal(p.requests.length, 3);
  assert.equal(p.requests[2].payload.code, "123456");
  assert.equal(p.events.length, 1);
});

test("destroy clears enrollment secrets and ignores late successful responses", async t => {
  const p = await page(t, {initial: state("aal1", [])});
  p.element.querySelector("button").click(); await flush();
  assert.match(p.element.textContent, new RegExp(SECRET));
  p.win.RexbidOwnerMfa.mount(p.element).destroy();
  assert.equal(p.element.textContent, "");
  assert.equal(p.element.querySelector("img,code,input"), null);
  let finishState;
  const pending = new Promise(resolve => { finishState = resolve; });
  const q = await page(t, {handler: async () => pending});
  q.win.RexbidOwnerMfa.mount(q.element).destroy();
  finishState(response(200, state("aal2"))); await flush();
  assert.equal(q.element.textContent, "");
  assert.equal(q.events.length, 0);
});
