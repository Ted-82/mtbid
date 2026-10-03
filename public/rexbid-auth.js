(function (root) {
  "use strict";

  // The BFF is the source of truth. A disabled production deployment returns
  // enabled:false; the browser never infers auth availability from hostnames.
  let enabled = false;
  const pagePath = () => String(root.location?.pathname || "").replace(/\.html$/, "");
  const CACHE_OWNER = "rex_bid_auth_cache_owner_v1";
  const CACHE_PREFIX = "rex_bid_cloud_favorites_v1:";
  const AUTH_REQUEST_TIMEOUT_MS = 10000;
  const state = { enabled, status: "anonymous", user: null, cache: [] };
  const mountedForms = new Set();
  let recoveryMounted = false;
  let accountPageMounted = false;
  const text = value => value == null ? "" : String(value).trim();
  const dispatch = () => {
    root.dispatchEvent?.(new CustomEvent("rexbid:auth-state", { detail: { status: state.status } }));
    root.RexBidStorage?.refreshCounts?.();
  };
  const removeCache = owner => { try { if (owner) root.localStorage.removeItem(CACHE_PREFIX + owner); } catch {} };
  function clearPrivate() {
    state.user = null; state.status = "anonymous"; state.cache = [];
    try {
      const owner = root.localStorage.getItem(CACHE_OWNER);
      removeCache(owner);
      root.localStorage.removeItem(CACHE_OWNER);
    } catch {}
    dispatch();
  }
  async function requestJson(path, options = {}) {
    const controller = typeof root.AbortController === "function" ? new root.AbortController() : null;
    let timer;
    let rejectTimeout;
    const timeout = new Promise((_, reject) => { rejectTimeout = reject; });
    const timeoutError = Object.assign(new Error("AUTH_REQUEST_TIMEOUT"), { code: "AUTH_REQUEST_TIMEOUT" });
    const setTimer = typeof root.setTimeout === "function" ? root.setTimeout.bind(root) : setTimeout;
    const clearTimer = typeof root.clearTimeout === "function" ? root.clearTimeout.bind(root) : clearTimeout;
    timer = setTimer(() => { controller?.abort(); rejectTimeout(timeoutError); }, AUTH_REQUEST_TIMEOUT_MS);
    try {
      const responsePromise = root.fetch(path, {
        credentials: "same-origin", cache: "no-store", ...options,
        ...(controller ? { signal: controller.signal } : {})
      });
      const response = await Promise.race([responsePromise, timeout]);
      let body = null;
      try { body = await Promise.race([response.json(), timeout]); }
      catch (error) { if (error?.code === "AUTH_REQUEST_TIMEOUT") throw error; }
      return { response, body };
    } finally { clearTimer(timer); }
  }
  async function request(path, options = {}) {
    const { response, body } = await requestJson(path, options);
    if (response.status === 401) clearPrivate();
    return {
      response, body,
      requestId: response.headers?.get?.("X-RexBid-Request-ID") || "",
      setCookiePresent: response.headers?.get?.("X-RexBid-Set-Cookie") === "present"
    };
  }
  function cacheKey(userId) { return CACHE_PREFIX + userId; }
  function readCache(userId) {
    try {
      const value = JSON.parse(root.localStorage.getItem(cacheKey(userId)) || "[]");
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }
  function writeCache() {
    if (!state.user?.id) return;
    try {
      root.localStorage.setItem(cacheKey(state.user.id), JSON.stringify(state.cache));
      root.localStorage.setItem(CACHE_OWNER, state.user.id);
    } catch {}
  }
  function safeApiFavorite(item) {
    const vin = text(item?.vin).toUpperCase().slice(0, 64);
    const lot = text(item?.lot).toUpperCase().slice(0, 80);
    const platform = text(item?.platform).toLowerCase().slice(0, 40);
    if (vin) return { vin, lot: lot || undefined, platform: platform || undefined };
    if (lot && platform) return { lot, platform };
    return null;
  }
  function cacheSnapshot(item, detail) {
    const storage = root.RexBidStorage;
    const vehicle = detail?.data || detail?.vehicle || detail;
    const snapshot = storage?.snapshotFromVehicle?.(vehicle);
    if (snapshot) return snapshot;
    return {
      id: text(item.vin) ? "vin:" + text(item.vin).toUpperCase() : "lot:" + text(item.platform).toLowerCase() + ":" + text(item.lot).toUpperCase(),
      vin: text(item.vin).toUpperCase(), lot: text(item.lot).toUpperCase(), platform: text(item.platform).toLowerCase(),
      title: "Zapisany pojazd", image: "", pricing: {}, auction: {}, odometer: "", saved_at: item.created_at || new Date().toISOString()
    };
  }
  async function refreshCloudFavorites() {
    if (state.status !== "authenticated" || !state.user?.id) return [];
    const { response, body } = await request("/api/me/favorites", { method: "GET" });
    if (!response.ok || body?.ok !== true) throw new Error("FAVORITES_UNAVAILABLE");
    const rows = Array.isArray(body.favorites) ? body.favorites : [];
    const prior = readCache(state.user.id);
    const byId = new Map(prior.map(item => [item.id, item]));
    const hydrated = rows.map(row => {
      const fallback = cacheSnapshot(row, null);
      const cached = byId.get(fallback.id);
      if (cached) return { ...cached, saved_at: row.created_at || cached.saved_at };
      return fallback;
    });
    if (state.status !== "authenticated") return [];
    state.cache = hydrated;
    writeCache();
    dispatch();
    return hydrated;
  }
  async function bootstrap() {
    await configReady;
    if (!enabled) return { enabled: false, status: "disabled" };
    try {
      const { response, body } = await request("/api/me", { method: "GET" });
      if (response.status === 401) { state.status = "anonymous"; state.cache = []; dispatch(); return { enabled, status: state.status }; }
      if (!response.ok || body?.ok !== true || !body.user?.id) { clearPrivate(); return { enabled, status: state.status }; }
      const user = body.user;
      let oldOwner = "";
      try { oldOwner = root.localStorage.getItem(CACHE_OWNER) || ""; } catch {}
      if (oldOwner && oldOwner !== user.id) removeCache(oldOwner);
      state.user = user; state.status = "authenticated"; state.cache = readCache(user.id); writeCache(); dispatch();
      await refreshCloudFavorites();
      return { enabled, status: state.status, user };
    } catch { clearPrivate(); return { enabled, status: state.status }; }
  }
  async function loadAuthConfiguration() {
    try {
      const { response, body } = await requestJson("/api/auth/config");
      enabled = response.ok && body?.ok === true && body?.enabled === true;
      state.enabled = enabled;
      if (enabled) return { enabled, status: state.status };
    } catch { enabled = false; state.enabled = false; }
    return { enabled: false, status: "disabled" };
  }
  async function consumeCallbackDiagnostic() {
    const params = new URLSearchParams(root.location?.search || "");
    const id = params.get("cbdiag") || "";
    if (!/^[A-Za-z0-9_-]{16}$/.test(id) || !root.document?.querySelector) return;
    let consumed = false;
    try {
      const { response, body } = await request("/api/auth/callback-diagnostic?id=" + encodeURIComponent(id), { method: "GET" });
      if (response.ok && body?.ok === true && body.diagnostic?.id === id) {
        const host = root.document.querySelector("main") || root.document.body;
        if (host) {
          const details = root.document.createElement("details");
          const summary = root.document.createElement("summary");
          const output = root.document.createElement("pre");
          details.className = "staging-callback-diagnostic";
          summary.textContent = "Wynik diagnostyczny callbacku stagingowego";
          output.textContent = JSON.stringify(body.diagnostic, null, 2);
          details.append(summary, output);
          host.append(details);
        }
        consumed = true;
      }
    } catch { /* Diagnostic display must never block the auth page. */ }
    // Keep the opaque receipt ID in the URL if the one-time read did not
    // succeed, so the same browser can retry or open the diagnostic endpoint.
    if (!consumed) return;
    params.delete("cbdiag");
    try {
      const next = root.location.pathname + (params.toString() ? "?" + params.toString() : "") + (root.location.hash || "");
      root.history?.replaceState?.(null, "", next);
    } catch {}
  }
  async function login(email, password, onResponse, onStage) {
    onStage?.("login-request");
    const result = await request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    onStage?.("login-response");
    onResponse?.({ status: result.response.status, requestId: result.requestId, setCookiePresent: result.setCookiePresent });
    if (!result.response.ok || result.body?.ok !== true) return { ok: false, status: result.response.status, requestId: result.requestId, setCookiePresent: result.setCookiePresent };
    onStage?.("session-bootstrap");
    const account = await bootstrap();
    if (account.status === "authenticated") { onStage?.("guest-merge"); await mergeGuestFavorites(); }
    return { ok: account.status === "authenticated", status: result.response.status, requestId: result.requestId, setCookiePresent: result.setCookiePresent };
  }
  async function signup(email, password) {
    const result = await request("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    return { ok: result.response.ok && result.body?.ok === true, confirmationRequired: result.body?.confirmation_required === true, status: result.response.status, requestId: result.requestId, setCookiePresent: result.setCookiePresent };
  }
  async function requestPasswordReset(email) {
    const result = await request("/api/auth/recovery", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ email }) });
    return { ok:result.response.ok, status:result.response.status };
  }
  async function resendConfirmation(email) {
    const result = await request("/api/auth/resend-confirmation", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ email }) });
    return { ok:result.response.ok, status:result.response.status };
  }
  async function updatePassword(password) {
    const result = await request("/api/auth/password", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ password }) });
    if (result.response.ok && result.body?.ok === true) clearPrivate();
    return { ok:result.response.ok && result.body?.ok === true, status:result.response.status, otherSessionsRevoked:result.body?.other_sessions_revoked === true };
  }
  async function exportAccount() {
    const result = await request("/api/me/export", { method:"GET" });
    if (!result.response.ok || result.body?.ok !== true) return { ok:false, status:result.response.status };
    return { ok:true, data:result.body };
  }
  async function refreshSession() {
    const result = await request("/api/auth/refresh", { method: "POST" });
    if (!result.response.ok || result.body?.ok !== true) { clearPrivate(); return { ok: false, status: result.response.status, requestId: result.requestId }; }
    const account = await bootstrap();
    return { ok: account.status === "authenticated", status: result.response.status, requestId: result.requestId };
  }
  async function logout() {
    try { await request("/api/auth/logout", { method: "POST" }); } finally { clearPrivate(); }
  }
  async function toggleFavorite(vehicle) {
    await ready;
    if (state.status !== "authenticated") return root.RexBidStorage?.toggleLocalFavorite?.(vehicle);
    const snapshot = root.RexBidStorage?.snapshotFromVehicle?.(vehicle);
    const favorite = safeApiFavorite(snapshot || vehicle);
    if (!favorite) return { ok: false, reason: "missing_identifier" };
    const id = snapshot?.id || (favorite.vin ? "vin:" + favorite.vin : "lot:" + favorite.platform + ":" + favorite.lot);
    const existing = state.cache.some(item => item.id === id);
    if (existing) {
      const { response } = await request("/api/me/favorites/" + encodeURIComponent(id), { method: "DELETE" });
      if (!response.ok) return { ok: false, reason: "request_failed" };
    } else {
      const { response } = await request("/api/me/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(favorite) });
      if (!response.ok) return { ok: false, reason: "request_failed" };
      if (snapshot) {
        state.cache = [snapshot, ...state.cache.filter(item => item.id !== id)];
        writeCache();
      }
    }
    await refreshCloudFavorites();
    return { ok: true, saved: !existing };
  }
  async function removeFavorite(vehicleOrKey) {
    await ready;
    if (state.status !== "authenticated") return root.RexBidStorage?.removeLocalFavorite?.(vehicleOrKey);
    const id = typeof vehicleOrKey === "string" ? vehicleOrKey : text(vehicleOrKey?.id);
    if (!id) return false;
    const { response } = await request("/api/me/favorites/" + encodeURIComponent(id), { method: "DELETE" });
    if (!response.ok) return false;
    await refreshCloudFavorites();
    return true;
  }
  async function addFavoriteIdentity(value) {
    await ready;
    if (state.status !== "authenticated") return { ok: false, reason: "unauthenticated" };
    const favorite = safeApiFavorite(value);
    if (!favorite) return { ok: false, reason: "missing_identifier" };
    const result = await request("/api/me/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(favorite) });
    if (!result.response.ok || result.body?.ok !== true) return { ok: false, reason: "request_failed", status: result.response.status };
    await refreshCloudFavorites();
    return { ok: true, status: result.response.status };
  }
  async function mergeFavoriteIdentities(values) {
    await ready;
    if (state.status !== "authenticated" || !Array.isArray(values)) return { ok: false, reason: "unauthenticated" };
    const favorites = values.map(safeApiFavorite).filter(Boolean);
    if (!favorites.length) return { ok: true, merged: 0 };
    const result = await request("/api/me/favorites/merge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ favorites }) });
    if (!result.response.ok || result.body?.ok !== true) return { ok: false, reason: "request_failed", status: result.response.status };
    await refreshCloudFavorites();
    return { ok: true, merged: Number(result.body.merged) || 0, status: result.response.status };
  }
  async function mergeGuestFavorites() {
    if (state.status !== "authenticated") return false;
    const storage = root.RexBidStorage;
    const guestSnapshots = storage?.getGuestFavorites?.() || [];
    const guest = guestSnapshots.map(safeApiFavorite).filter(Boolean);
    if (!guest.length) return true;
    if (!root.confirm?.("Przenieść lokalne ulubione do konta Rex.Bid?")) return false;
    const result = await mergeFavoriteIdentities(guest);
    if (!result.ok) return false;
    const cached = new Map(state.cache.map(item => [item.id, item]));
    for (const snapshot of guestSnapshots) if (snapshot?.id) cached.set(snapshot.id, snapshot);
    state.cache = [...cached.values()];
    writeCache();
    storage?.clearGuestFavorites?.();
    await refreshCloudFavorites();
    return true;
  }
  function updateNavigation() {
    if (!enabled) return;
    document.querySelectorAll('a[href="logowanie.html"],a[href="/logowanie.html"],a[href="rejestracja.html"],a[href="/rejestracja.html"]').forEach(node => { node.hidden = true; });
    let slot = document.querySelector("[data-rexbid-auth-nav]");
    if (!slot) {
      const header = document.querySelector("header .header-inner, header .container");
      if (!header) return;
      slot = document.createElement("div"); slot.dataset.rexbidAuthNav = ""; slot.className = "rexbid-auth-nav"; header.append(slot);
      const style = document.createElement("style");
      style.textContent = ".rexbid-auth-nav{display:flex;align-items:center;gap:10px;margin-left:auto}.rexbid-auth-nav a,.rexbid-auth-nav button{font:700 13px Arial,sans-serif;color:inherit;background:transparent;border:1px solid currentColor;border-radius:8px;padding:9px 12px;text-decoration:none;cursor:pointer}.rexbid-auth-nav a:last-child{background:#f4c430;color:#171717;border-color:#f4c430}@media(max-width:700px){.rexbid-auth-nav{gap:5px}.rexbid-auth-nav a,.rexbid-auth-nav button{padding:7px 8px;font-size:12px}}";
      document.body.append(style);
    }
    slot.replaceChildren();
    const add = (label, href, action) => {
      const node = document.createElement(action ? "button" : "a"); node.textContent = label;
      if (action) { node.type = "button"; node.addEventListener("click", action); }
      else node.href = href;
      slot.append(node);
    };
    if (state.status === "authenticated") { add("Moje konto", "/konto.html"); add("Wyloguj", "", async () => { await logout(); updateNavigation(); }); }
    else { add("Zaloguj", "/logowanie.html"); add("Załóż konto", "/rejestracja.html"); }
  }
  function setPageMessage(node, textValue, kind = "") {
    node.textContent = textValue;
    node.dataset.kind = kind;
    node.hidden = !textValue;
    if (node.style) node.style.display = textValue ? "block" : "none";
  }
  function mountAuthForm(kind) {
    const formId = kind === "signup" ? "registerForm" : "loginForm";
    if (mountedForms.has(formId)) return;
    const form = document.getElementById(kind === "signup" ? "registerForm" : "loginForm");
    const message = document.getElementById("message");
    if (!form || !message) return;
    mountedForms.add(formId);
    // Staging auth uses explicit validation and direct actions rather than native
    // form submission, which can stop before the request handler runs.
    form.noValidate = true;
    let busy = false;
    let actionNumber = 0;
    let diagnostic = document.getElementById("rexbid-auth-stage");
    if (!diagnostic) {
      diagnostic = document.createElement("p");
      diagnostic.id = "rexbid-auth-stage";
      diagnostic.setAttribute("role", "status");
      diagnostic.setAttribute("aria-live", "polite");
      diagnostic.className = "auth-stage";
      diagnostic.hidden = true;
      message.after(diagnostic);
    }
    const setStage = value => { diagnostic.textContent = value; diagnostic.hidden = false; };
    const password = document.getElementById("password");
    const emailInput = document.getElementById("email");
    const nameInput = kind === "signup" ? document.getElementById("name") : null;
    const termsInput = kind === "signup" ? document.getElementById("terms") : null;
    let confirm = document.getElementById("passwordConfirm");
    const resendButton = document.getElementById("resendConfirmation");
    if (kind === "signup" && !confirm) {
      const group = document.createElement("div"); group.className = "group";
      const label = document.createElement("label"); label.htmlFor = "passwordConfirm"; label.textContent = "Powtórz hasło";
      confirm = document.createElement("input"); confirm.id = "passwordConfirm"; confirm.type = "password"; confirm.autocomplete = "new-password"; confirm.required = true;
      group.append(label, confirm); password?.parentElement?.after(group);
    }
    if (resendButton) resendButton.addEventListener("click", async event => {
      event.preventDefault?.(); await configReady;
      try { await resendConfirmation(emailInput?.value?.trim() || ""); setPageMessage(message, "Jeśli adres jest powiązany z niepotwierdzonym kontem, wyślemy wiadomość.", "success"); }
      catch { setPageMessage(message, "Nie udało się wysłać wiadomości. Spróbuj ponownie później.", "error"); }
    });
    message.textContent = ""; message.hidden = false; message.style.display = "none"; message.setAttribute("role", "status"); message.setAttribute("aria-live", "polite");
    if (kind === "login") {
      const authResult = new URLSearchParams(root.location.search || "").get("auth");
      const callbackMessage = authResult === "verify-email" ? "Potwierdź adres e-mail, aby dokończyć logowanie. Możesz wysłać wiadomość ponownie przyciskiem poniżej."
        : authResult === "failed" ? "Link jest nieprawidłowy lub wygasł. Poproś o nową wiadomość i spróbuj ponownie."
        : authResult === "unavailable" ? "Logowanie jest chwilowo niedostępne. Spróbuj ponownie później." : "";
      if (callbackMessage) setPageMessage(message, callbackMessage, authResult === "verify-email" ? "success" : "error");
      if (resendButton && authResult === "verify-email") resendButton.hidden = false;
    }
    const performAuth = async (operation, event) => {
      event?.preventDefault?.();
      if (busy) return;
      busy = true;
      const action = (operation === "signup" ? "Signup" : "Login") + " #" + (++actionNumber);
      setStage(action + ": preparing");
      setPageMessage(message, "", "");
      await configReady;
      if (!enabled) {
        setPageMessage(message, "Logowanie i rejestracja są obecnie niedostępne.", "error");
        setStage(action + ": auth unavailable");
        busy = false;
        return;
      }
      const email = emailInput?.value?.trim() || "", pass = password?.value || "";
      const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      const invalidMessage = !email ? "Wpisz adres e-mail."
        : !emailValid ? "Wpisz prawidłowy adres e-mail."
        : operation === "signup" && !nameInput?.value?.trim() ? "Wpisz imię."
        : !pass ? "Wpisz hasło."
        : pass.length < 8 ? "Hasło musi mieć co najmniej 8 znaków."
        : operation === "signup" && confirm?.value !== pass ? "Hasła muszą być takie same."
        : operation === "signup" && termsInput && !termsInput.checked ? "Zaakceptuj regulamin oraz politykę prywatności." : "";
      if (invalidMessage) {
        setPageMessage(message, invalidMessage, "error");
        setStage(action + ": validation error");
        busy = false;
        return;
      }
      const submit = form.querySelector('button[type="submit"]'); if (submit) submit.disabled = true;
      try {
        setStage(action + ": sending");
        if (operation === "signup") {
          const result = await signup(email, pass);
          setStage(action + ": response HTTP " + result.status);
          setPageMessage(message, result.ok ? (result.confirmationRequired ? "Jeśli można utworzyć konto, wysłaliśmy wiadomość z potwierdzeniem." : "Konto zostało utworzone.") : "Rejestracja nie powiodła się. Sprawdź dane lub spróbuj ponownie.", result.ok ? "success" : "error");
          if (resendButton && result.ok && result.confirmationRequired) resendButton.hidden = false;
        } else {
          const result = await login(email, pass, info => {
            const request = /^[0-9a-f-]{36}$/i.test(info.requestId) ? " · Request: " + info.requestId : "";
            const cookie = info.setCookiePresent ? " · Session cookie: present" : " · Session cookie: absent";
            setStage(action + ": response HTTP " + info.status + request + cookie);
          });
          if (!result.ok) setPageMessage(message, "Nie udało się zalogować. Sprawdź dane i potwierdź adres e-mail.", "error");
          else {
            const params = new URLSearchParams(root.location.search);
            const requested = params.get("return_to") || "/konto.html";
            let safe = "/konto.html";
            try { const target = new URL(requested, root.location.origin); if (requested.startsWith("/") && !requested.startsWith("//") && !requested.includes("\\") && target.origin === root.location.origin) safe = target.pathname + target.search + target.hash; } catch {}
            setStage(action + ": redirecting to account");
            root.location.assign(safe);
          }
        }
      } catch {
        setPageMessage(message, operation === "signup" ? "Rejestracja jest chwilowo niedostępna." : "Logowanie jest chwilowo niedostępne.", "error");
        setStage(action + ": network or session error");
      }
      finally { if (password) password.value = ""; if (confirm) confirm.value = ""; if (submit) submit.disabled = false; busy = false; }
    };
    const performLogin = event => performAuth("login", event);
    const performSignup = event => performAuth("signup", event);
    const perform = kind === "signup" ? performSignup : performLogin;
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.addEventListener("click", perform);
    form.addEventListener("submit", event => { event.preventDefault(); return perform(event); });
    for (const input of [emailInput, password, confirm].filter(Boolean)) {
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); return perform(event); }
      });
    }
  }
  async function mountAccountPage() {
    if (accountPageMounted) return;
    accountPageMounted = true;
    let host = document.getElementById("accountAuthMount");
    if (!host) {
      host = document.createElement("section"); host.className = "section";
      document.querySelector("main")?.append(host);
    }
    if (!host) return;
    host.setAttribute("aria-live", "polite");
    const render = () => {
      if (!enabled) {
        const title = document.createElement("h2"); title.textContent = "Konto niedostępne";
        const message = document.createElement("p"); message.textContent = "Logowanie jest obecnie niedostępne.";
        host.replaceChildren(title, message); return;
      }
      if (state.status !== "authenticated") {
        host.replaceChildren(); const title = document.createElement("h2"); title.textContent = "Zaloguj się do konta";
        const link = document.createElement("a"); link.href = "/logowanie.html?return_to=%2Fkonto.html"; link.textContent = "Przejdź do logowania"; link.className = "btn btn-red"; host.append(title, link); return;
      }
      const title = document.createElement("h2"); title.textContent = "Konto Rex.Bid";
      const verified = document.createElement("p"); verified.textContent = state.user.email_verified === true ? "Status: zalogowano · e-mail potwierdzony" : "Status: zalogowano";
      const provider = document.createElement("p"); provider.textContent = "Dostawca logowania: " + text(state.user.auth_provider || "—");
      const favorites = document.createElement("p"); favorites.textContent = "Ulubione w chmurze: " + String(state.cache.length);
      const link = document.createElement("a"); link.href = "/ulubione.html"; link.textContent = "Otwórz ulubione"; link.className = "btn btn-outline";
      const logoutButton = document.createElement("button"); logoutButton.type = "button"; logoutButton.className = "btn btn-red"; logoutButton.textContent = "Wyloguj";
      logoutButton.addEventListener("click", async () => { try { await logout(); } finally { render(); updateNavigation(); } });
      const exportButton = document.createElement("button"); exportButton.type = "button"; exportButton.className = "btn btn-outline"; exportButton.textContent = "Pobierz moje dane";
      exportButton.addEventListener("click", async () => {
        const result = await exportAccount();
        if (!result.ok) return;
        const blob = new Blob([JSON.stringify(result.data, null, 2)], { type:"application/json" });
        const objectUrl = URL.createObjectURL(blob); const download = document.createElement("a"); download.href = objectUrl; download.download = "rex-bid-dane-konta.json"; download.click(); URL.revokeObjectURL(objectUrl);
      });
      const children = [title, verified];
      if (state.user.email) { const email = document.createElement("p"); email.textContent = "E-mail: " + text(state.user.email); children.push(email); }
      children.push(provider, favorites, link, exportButton, logoutButton);
      host.replaceChildren(...children);
    };
    root.addEventListener?.("rexbid:auth-state", render);
    await ready; render();
  }
  async function mountRecoveryPage() {
    if (recoveryMounted) return;
    const main = document.querySelector("main"); if (!main) return;
    recoveryMounted = true;
    const box = document.createElement("section"); box.className = "account-recovery"; box.setAttribute("aria-live","polite");
    const title = document.createElement("h1"); title.textContent = "Odzyskiwanie dostępu";
    const message = document.createElement("p"); message.setAttribute("role","status");
    const form = document.createElement("form"); form.noValidate = true;
    const email = document.createElement("input"); email.type="email"; email.autocomplete="email"; email.required=true; email.setAttribute("aria-label","Adres e-mail"); email.placeholder="Adres e-mail";
    const password = document.createElement("input"); password.type="password"; password.autocomplete="new-password"; password.minLength=8; password.placeholder="Nowe hasło"; password.setAttribute("aria-label","Nowe hasło"); password.hidden=true;
    const submit = document.createElement("button"); submit.type="submit"; submit.className="btn btn-red";
    form.append(email,password,submit); box.append(title,message,form); main.append(box);
    await ready;
    const recoverySession = state.status === "authenticated" && new URLSearchParams(root.location.search).get("recovery") === "ready";
    email.hidden = recoverySession; password.hidden = !recoverySession;
    submit.textContent = recoverySession ? "Ustaw nowe hasło" : "Wyślij link odzyskiwania";
    form.addEventListener("submit", async event => {
      event.preventDefault(); submit.disabled=true; message.textContent="";
      try {
        if (recoverySession) {
          if ((password.value || "").length < 8) { message.textContent="Hasło musi mieć co najmniej 8 znaków."; return; }
          const result = await updatePassword(password.value);
          message.textContent = result.ok ? "Hasło zmienione. Zaloguj się ponownie." : "Nie udało się zmienić hasła. Spróbuj ponownie.";
        } else {
          const value = (email.value || "").trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { message.textContent="Wpisz prawidłowy adres e-mail."; return; }
          await requestPasswordReset(value);
          message.textContent="Jeśli adres jest powiązany z kontem, wyślemy wiadomość z instrukcją.";
        }
      } catch { message.textContent="Operacja jest chwilowo niedostępna."; }
      finally { submit.disabled=false; }
    });
  }
  async function mountFavoritesPage({ content, counter, storage }) {
    if (!enabled) return false;
    await ready;
    if (state.status !== "authenticated") return false;
    content.replaceChildren(); content.textContent = "Sprawdzam ulubione…";
    const note = document.querySelector(".device-note"); if (note) note.textContent = "Ulubione zapisane na koncie Rex.Bid.";
    try { await refreshCloudFavorites(); } catch { content.textContent = "Nie udało się pobrać ulubionych z konta."; return true; }
    const render = () => {
      if (state.status !== "authenticated") { content.replaceChildren(); counter.textContent = ""; return; }
      const cars = state.cache; counter.textContent = cars.length === 1 ? "1 obserwowany samochód" : `${cars.length} obserwowanych samochodów`;
      content.replaceChildren();
      if (!cars.length) {
        const p = document.createElement("p"); p.textContent = "Nie masz jeszcze ulubionych samochodów."; content.append(p);
        if (storage.getGuestFavorites().length) {
          const mergeButton = document.createElement("button"); mergeButton.type = "button"; mergeButton.textContent = "Scal ulubione z tego urządzenia"; mergeButton.addEventListener("click", async () => { if (await mergeGuestFavorites()) render(); }); content.append(mergeButton);
        }
        return;
      }
      const list = document.createElement("ul");
      for (const car of cars) {
        const li = document.createElement("li"), link = document.createElement("a"), remove = document.createElement("button");
        const vin = text(car.vin), lot = text(car.lot); link.href = vin ? "/car.html?vin=" + encodeURIComponent(vin) : "/car.html?lot=" + encodeURIComponent(lot);
        link.textContent = text(car.title) || [car.year, car.make, car.model].filter(Boolean).join(" ") || (vin ? "VIN " + vin : "LOT " + lot);
        remove.type = "button"; remove.textContent = "Usuń"; remove.addEventListener("click", async () => { if (await removeFavorite(car.id)) render(); });
        li.append(link, document.createTextNode(" "), remove); list.append(li);
      }
      content.append(list);
      if (storage.getGuestFavorites().length) {
        const mergeButton = document.createElement("button"); mergeButton.type = "button"; mergeButton.textContent = "Scal ulubione z tego urządzenia"; mergeButton.addEventListener("click", async () => { if (await mergeGuestFavorites()) render(); }); content.prepend(mergeButton);
      }
    };
    render();
    return true;
  }
  const configReady = loadAuthConfiguration();
  const ready = configReady.then(result => enabled ? bootstrap() : result);
  const api = {
    get enabled() { return enabled; }, get status() { return state.status; }, get user() { return state.user; }, ready, bootstrap,
    login, signup,
    getFavorites() { return state.status === "authenticated" ? state.cache.slice() : []; },
    isFavorite(vehicle) { const item = root.RexBidStorage?.snapshotFromVehicle?.(vehicle); return !!item && state.cache.some(saved => saved.id === item.id); },
    toggleFavorite, addFavoriteIdentity, removeFavorite, logout, refreshSession, requestPasswordReset, resendConfirmation, updatePassword, exportAccount, mergeFavoriteIdentities, mergeGuestFavorites, mountFavoritesPage, mountAccountPage,
    async initialize() { await ready; updateNavigation(); const path = pagePath(); if (path === "/konto") await mountAccountPage(); if (enabled && path === "/reset-hasla") await mountRecoveryPage(); },
  };
  root.RexBidAuth = api;
  if (pagePath() === "/rejestracja") mountAuthForm("signup");
  if (pagePath() === "/logowanie") mountAuthForm("login");
  root.addEventListener?.("rexbid:auth-state", updateNavigation);
  ready.then(() => { if (!enabled) { if (pagePath() === "/konto") mountAccountPage(); return; } consumeCallbackDiagnostic(); updateNavigation(); if (state.status === "authenticated") mergeGuestFavorites().catch(() => {}); if (pagePath() === "/konto") mountAccountPage(); if (pagePath() === "/reset-hasla") mountRecoveryPage(); });
})(typeof window !== "undefined" ? window : globalThis);
