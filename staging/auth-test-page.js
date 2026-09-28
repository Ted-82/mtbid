const AUTH_TEST_HTML = String.raw`<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>REX.Bid — staging Auth E2E</title>
<style>
:root{color-scheme:dark;font:16px/1.5 system-ui,sans-serif;background:#101216;color:#f5f5f5}*{box-sizing:border-box}body{margin:0;padding:24px;background:#101216}.wrap{max-width:760px;margin:auto}.flag{padding:12px 16px;border:1px solid #b58b13;border-radius:10px;background:#27200c;color:#ffe18a;font-weight:700}.card{margin-top:16px;padding:20px;border:1px solid #34383f;border-radius:14px;background:#191c21}h1,h2{margin:0 0 12px}h1{font-size:1.5rem}h2{font-size:1.1rem}.status{display:inline-block;padding:4px 10px;border-radius:999px;background:#333;color:#fff;font-weight:700}.status[data-state="Authenticated"]{background:#16462d;color:#b5f2cb}.status[data-state="Awaiting email confirmation"]{background:#59450a;color:#ffe18a}.status[data-state="Anonymous"]{background:#333;color:#ddd}.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}label{display:block;flex:1 1 220px}input,button{font:inherit;border-radius:8px;padding:10px 12px}input{display:block;width:100%;margin-top:5px;background:#101216;border:1px solid #565b64;color:#fff}button{border:0;background:#f4c430;color:#161616;font-weight:700;cursor:pointer}button.secondary{background:#343941;color:#fff}button:disabled{opacity:.5;cursor:wait}.message{min-height:1.5em;color:#ddd}.facts{white-space:pre-wrap;overflow-wrap:anywhere;color:#bbb}.note{color:#aaa;font-size:.92rem}.hidden{display:none}ul{padding-left:22px}
</style>
</head>
<body><main class="wrap">
<div class="flag">STAGING ONLY — rexbid-auth-test. Nie używaj prawdziwego hasła ani konta klienta.</div>
<section class="card"><h1>Test Supabase Auth / BFF</h1><p>Status: <span id="auth-state" class="status" data-state="Anonymous">Anonymous</span></p><p id="auth-message" class="message" role="status" aria-live="polite">Sprawdzam sesję…</p><p id="signup-diagnostic" class="message note" role="status" aria-live="polite" data-stage="Ready">Ready</p><div id="me-facts" class="facts"></div></section>
<section class="card"><h2>Testowe konto</h2><form id="credentials" autocomplete="off"><div class="row"><label>Testowy e-mail<input id="email" type="email" autocomplete="off" required maxlength="320"></label><label>Testowe hasło<input id="password" type="password" autocomplete="new-password" required minlength="8" maxlength="1024"></label></div><div class="row"><button id="signup" type="button">Sign up</button><button id="login" type="button" class="secondary">Log in</button><button id="refresh" type="button" class="secondary">Refresh session</button><button id="logout" type="button" class="secondary">Log out</button></div></form><p class="note">Hasło jest wysyłane wyłącznie w HTTPS POST do stagingowego BFF. Strona go nie zapisuje ani nie wyświetla.</p></section>
<section class="card"><h2>Test ulubionych</h2><p class="note">Tworzy wyłącznie sztuczny wpis LOT w testowej D1. Nie jest to rzeczywisty pojazd.</p><div class="row"><label>LOT testowy<input id="favorite-lot" maxlength="80"></label><label>Platforma<select id="favorite-platform"><option value="copart">Copart</option><option value="iaai">IAAI</option></select></label></div><div class="row"><button id="favorite-add" type="button">Dodaj testowe favorite</button><button id="favorite-list" type="button" class="secondary">Pobierz favorites</button><button id="favorite-delete" type="button" class="secondary">Usuń testowe favorite</button><button id="favorite-merge" type="button" class="secondary">Merge test local favorite</button></div><p id="favorite-message" class="message" role="status" aria-live="polite"></p><ul id="favorite-list-output"></ul></section>
<p class="note">Auth tokens are HttpOnly-cookie-only; this page never reads cookies, tokens or localStorage. Do not share screenshots containing your test e-mail.</p>
</main>
<script>
(() => {
  const requiredHost = "rexbid-auth-test.tedn828.workers.dev";
  const byId = id => document.getElementById(id);
  const state = byId("auth-state"), message = byId("auth-message"), facts = byId("me-facts");
  const signupDiagnostic = byId("signup-diagnostic");
  const favoriteMessage = byId("favorite-message"), favoriteList = byId("favorite-list-output");
  let lastFavorite = null, actionNumber = 0, activeAction = null;
  const setMessage = value => { message.textContent = value; };
  function setSignupDiagnostic(stage, error, displayText = stage) {
    const safeType = error && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(String(error.name || "")) ? String(error.name) : "Error";
    if (!signupDiagnostic) return;
    signupDiagnostic.dataset.stage = stage;
    signupDiagnostic.textContent = error ? (activeAction?.label || "Auth") + " #" + (activeAction?.number || "?") + ": UI exception " + (activeAction?.stage || "before request") + " (" + safeType + ")" : displayText;
  }
  function showGlobalUiError(error) { if (activeAction) setSignupDiagnostic("UI error", error); }
  window.addEventListener("error", event => showGlobalUiError(event.error));
  window.addEventListener("unhandledrejection", event => showGlobalUiError(event.reason));
  const setFavoriteMessage = value => { favoriteMessage.textContent = value; };
  const setAuth = (value, text) => { state.dataset.state = value; state.textContent = value; if (text) setMessage(text); };
  function clearPrivateData() {
    facts.textContent = "";
    favoriteList.replaceChildren();
    lastFavorite = null;
    setFavoriteMessage("");
  }
  const buttonIds = ["signup","login","refresh","logout","favorite-add","favorite-list","favorite-delete","favorite-merge"];
  const busy = value => buttonIds.forEach(id => { byId(id).disabled = value; });
  async function api(path, options) {
    const response = await fetch(path, { credentials:"same-origin", cache:"no-store", ...options });
    if (response.status === 401) {
      clearPrivateData();
      setAuth("Anonymous", "Sesja wygasła. Zaloguj się ponownie.");
    }
    let data = null;
    try { data = await response.json(); } catch {}
    const requestId = response.headers?.get?.("X-RexBid-Request-ID") || "";
    const setCookiePresent = response.headers?.get?.("X-RexBid-Set-Cookie") === "present";
    return { response, data, requestId: /^[0-9a-f-]{36}$/i.test(requestId) ? requestId : "", setCookiePresent };
  }
  const actionLabels = { signup:"Signup", login:"Login", refresh:"Refresh", logout:"Logout" };
  function beginAction(operation) {
    const action = { operation, number: ++actionNumber, label: actionLabels[operation], stage:"preparing" };
    activeAction = action;
    facts.textContent = "";
    setAuth("Anonymous", operation === "login" ? "Logowanie w toku…" : operation === "signup" ? "Rejestracja w toku…" : operation === "refresh" ? "Odświeżanie sesji…" : "Wylogowywanie…");
    setSignupDiagnostic("preparing", null, action.label + " #" + action.number + ": preparing");
    return action;
  }
  function setActionStage(action, stage, result) {
    action.stage = stage;
    const status = result ? " — HTTP " + result.response.status : "";
    const requestId = result ? " · Request: " + (result.requestId || "unavailable") : "";
    const cookie = result ? " · Set-Cookie: " + (result.setCookiePresent ? "present" : "absent") : "";
    setSignupDiagnostic(stage, null, action.label + " #" + action.number + ": " + stage + status + requestId + cookie);
  }
  async function checkMe() {
    const {response,data} = await api("/api/me", {method:"GET"});
    if (response.status === 401) { clearPrivateData(); setAuth("Anonymous", "Brak aktywnej sesji."); return false; }
    if (!response.ok || !data || data.ok !== true || !data.user) { setMessage("Nie udało się sprawdzić sesji. Spróbuj ponownie."); return false; }
    const user = data.user;
    facts.textContent = "Rex.Bid user ID: " + String(user.id || "—") + "\nProvider: " + String(user.auth_provider || "—") + "\nE-mail verified: " + String(user.email_verified === true);
    setAuth("Authenticated", "Sesja staging jest aktywna."); return true;
  }
  async function withBusy(work) { busy(true); try { await work(); } finally { byId("password").value = ""; busy(false); } }
  async function submitCredentials(operation) {
    const action = beginAction(operation);
    try {
      await withBusy(async () => {
        const email = byId("email").value, password = byId("password").value;
        if (!email || !password) { setMessage("Wpisz testowy e-mail i hasło."); return; }
        action.stage = "before request";
        setActionStage(action, "sending");
        const result = await api(operation === "signup" ? "/api/auth/signup" : "/api/auth/login", {
          method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password})
        });
        setActionStage(action, "response received", result);
        if (operation === "signup") {
          if (result.response.status === 202 && result.data?.confirmation_required === true) {
            setAuth("Awaiting email confirmation", "Sprawdź pocztę i potwierdź adres e-mail."); return;
          }
          if (result.response.ok && result.data?.ok === true) { await checkMe(); return; }
          setMessage(result.response.status === 409 ? "Nie można utworzyć konta. Sprawdź dane lub użyj nowego testowego adresu." : "Rejestracja nie powiodła się. Sprawdź ustawienia staging Auth.");
          return;
        }
        if (!result.response.ok || result.data?.ok !== true) { setAuth("Anonymous", "Logowanie nie powiodło się. Potwierdź e-mail i sprawdź dane."); return; }
        await checkMe();
      });
    } catch (error) {
      setSignupDiagnostic("UI error", error);
      setMessage(action.stage === "sending" ? "Nie udało się połączyć ze stagingowym BFF." : "Nie udało się przygotować żądania. Sprawdź formularz.");
    }
  }
  byId("credentials").addEventListener("submit", event => event.preventDefault());
  byId("signup").addEventListener("click", () => submitCredentials("signup"));
  byId("login").addEventListener("click", () => submitCredentials("login"));
  for (const operation of ["refresh", "logout"]) byId(operation).addEventListener("click", () => runSessionAction(operation));
  async function runSessionAction(operation) {
    const action = beginAction(operation);
    try {
      await withBusy(async () => {
        setActionStage(action, "sending");
        const result = await api("/api/auth/" + operation, {method:"POST"});
        setActionStage(action, "response received", result);
        if (operation === "refresh") {
          if (result.response.ok) await checkMe(); else setAuth("Anonymous", "Odświeżenie sesji nie powiodło się.");
        } else {
          clearPrivateData();
          setAuth("Anonymous", "Wylogowano.");
          await checkMe();
        }
      });
    } catch (error) {
      setSignupDiagnostic("UI error", error);
      setMessage("Nie udało się wykonać " + (operation === "refresh" ? "odświeżenia sesji" : "wylogowania") + ".");
    }
  }
  function favoriteInput() {
    const lot = byId("favorite-lot").value.trim().toUpperCase(), platform = byId("favorite-platform").value;
    if (!lot) throw new Error("Wpisz LOT testowy.");
    return {lot,platform};
  }
  async function favoritesRequest(path, method, body) {
    const options = {method,headers:{"Content-Type":"application/json"}};
    if (body !== undefined) options.body = JSON.stringify(body);
    const {response,data} = await api(path,options);
    if (!response.ok || data?.ok !== true) throw new Error(response.status === 401 ? "Zaloguj się ponownie." : "Operacja ulubionych nie powiodła się.");
    return data;
  }
  byId("favorite-add").addEventListener("click", () => withBusy(async () => { try { lastFavorite=favoriteInput(); await favoritesRequest("/api/me/favorites","POST",lastFavorite); setFavoriteMessage("Dodano testowe favorite."); } catch(e) { setFavoriteMessage(e.message); } }));
  byId("favorite-list").addEventListener("click", () => withBusy(async () => { try { const data=await favoritesRequest("/api/me/favorites","GET"); favoriteList.replaceChildren(); for (const item of data.favorites || []) { const li=document.createElement("li"); li.textContent=String(item.key || "—")+" · "+String(item.platform || "—"); favoriteList.append(li); } setFavoriteMessage("Liczba wpisów: "+String((data.favorites || []).length)); } catch(e) { setFavoriteMessage(e.message); } }));
  byId("favorite-delete").addEventListener("click", () => withBusy(async () => { try { const item=lastFavorite || favoriteInput(); const key="lot:"+item.platform+":"+item.lot; await favoritesRequest("/api/me/favorites/"+encodeURIComponent(key),"DELETE"); setFavoriteMessage("Usunięto testowe favorite."); } catch(e) { setFavoriteMessage(e.message); } }));
  byId("favorite-merge").addEventListener("click", () => withBusy(async () => { try { const item=favoriteInput(); const data=await favoritesRequest("/api/me/favorites/merge","POST",{favorites:[item]}); lastFavorite=item; setFavoriteMessage("Merge zakończony. Scalono wpisów: "+String(data.merged)); } catch(e) { setFavoriteMessage(e.message); } }));
  if (location.hostname !== requiredHost) { document.body.textContent="Ta strona jest dostępna wyłącznie na stagingowym Workerze Rex.Bid."; return; }
  checkMe().catch(() => setMessage("Nie udało się sprawdzić sesji."));
})();
</script></body></html>`;

export default AUTH_TEST_HTML;
