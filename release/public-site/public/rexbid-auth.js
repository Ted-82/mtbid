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
  let accountExportPending = false;
  let accountExportFeedback = "";
  let accountExportMfaRequired = false;
  const text = value => value == null ? "" : String(value).trim();
  const dispatch = () => {
    root.dispatchEvent?.(new CustomEvent("rexbid:auth-state", { detail: { status: state.status } }));
    root.RexBidStorage?.refreshCounts?.();
  };
  const removeCache = owner => { try { if (owner) root.localStorage.removeItem(CACHE_PREFIX + owner); } catch {} };
  function clearPrivate() {
    state.user = null; state.status = "anonymous"; state.cache = [];
    accountExportFeedback = ""; accountExportMfaRequired = false;
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
      // A cached view of another auction of this VIN cannot replace the saved LOT.
      if (cached && (!fallback.lot || text(cached.lot) === fallback.lot)
        && (!fallback.platform || text(cached.platform).toLowerCase() === fallback.platform))
        return { ...cached, saved_at: row.created_at || cached.saved_at };
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
      try { await refreshCloudFavorites(); }
      catch { state.cache = []; dispatch(); /* Favorites failure is not an identity failure. */ }
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
    return { ok:result.response.ok && result.body?.ok === true, status:result.response.status, code:result.body?.code, error:result.body?.error, otherSessionsRevoked:result.body?.other_sessions_revoked === true };
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
    // Stop private downloads as soon as logout is requested, even when the
    // upstream logout POST hangs. Keep the existing session lifecycle intact.
    root.RexBidDataExport?.cancel?.();
    root.dispatchEvent?.(new CustomEvent("rexbid:logout-start"));
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
    if (!root.confirm?.("Przenieść lokalne ulubione do konta REXBID?")) return false;
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
    let slot = document.querySelector("[data-rexbid-auth-nav]");
    if (!slot) {
      const header = document.querySelector("header .header-inner, header .container");
      if (!header) return;
      slot = document.createElement("div"); slot.dataset.rexbidAuthNav = ""; slot.className = "rexbid-auth-nav"; header.append(slot);

    }
    // Replace legacy header controls only. Form navigation, recovery success
    // links and signup/login calls to action in main must remain accessible.
    document.querySelectorAll('header a[href="logowanie.html"],header a[href="/logowanie.html"],header a[href="rejestracja.html"],header a[href="/rejestracja.html"]').forEach(node => { node.hidden = true; });
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
    const termsInput = kind === "signup" ? document.getElementById("terms") : null;
    let confirm = document.getElementById("passwordConfirm");
    const resendButton = document.getElementById("resendConfirmation");
    if (kind === "signup" && !confirm) {
      const group = document.createElement("div"); group.className = "group";
      const label = document.createElement("label"); label.htmlFor = "passwordConfirm"; label.textContent = "Powtórz hasło";
      confirm = document.createElement("input"); confirm.id = "passwordConfirm"; confirm.type = "password"; confirm.autocomplete = "new-password"; confirm.required = true;
      group.append(label, confirm); password?.parentElement?.after(group);
    }
    const invalidFields = new Map();
    const clearFieldError = field => {
      if (!field || !invalidFields.has(field)) return;
      const hadMessageReference = invalidFields.get(field);
      invalidFields.delete(field);
      field.removeAttribute?.("aria-invalid");
      if (!hadMessageReference) {
        const references = String(field.getAttribute?.("aria-describedby") || "").split(/\s+/).filter(value => value && value !== message.id);
        if (references.length) field.setAttribute("aria-describedby", references.join(" "));
        else field.removeAttribute?.("aria-describedby");
      }
    };
    const clearValidationErrors = () => { for (const field of [...invalidFields.keys()]) clearFieldError(field); };
    const markFieldError = field => {
      if (!field) return;
      const references = String(field.getAttribute?.("aria-describedby") || "").split(/\s+/).filter(Boolean);
      invalidFields.set(field, references.includes(message.id));
      field.setAttribute("aria-invalid", "true");
      field.setAttribute("aria-describedby", [...new Set([...references, message.id])].join(" "));
      field.focus?.();
    };
    for (const field of [emailInput, password, confirm, termsInput].filter(Boolean)) {
      const clearEditedError = () => {
        const wasInvalid = invalidFields.has(field);
        clearFieldError(field);
        if (wasInvalid) setPageMessage(message, "", "");
      };
      field.addEventListener("input", clearEditedError);
      field.addEventListener("change", clearEditedError);
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
      clearValidationErrors();
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
      const validationError = !email ? {field:emailInput, message:"Wpisz adres e-mail."}
        : !emailValid ? {field:emailInput, message:"Wpisz prawidłowy adres e-mail."}
        : !pass ? {field:password, message:"Wpisz hasło."}
        : pass.length < 8 ? {field:password, message:"Hasło musi mieć co najmniej 8 znaków."}
        : operation === "signup" && confirm?.value !== pass ? {field:confirm, message:"Hasła muszą być takie same."}
        : operation === "signup" && (!termsInput || !termsInput.checked) ? {field:termsInput, message:"Zaakceptuj warunki korzystania z REXBID."} : null;
      if (validationError) {
        setPageMessage(message, validationError.message, "error");
        markFieldError(validationError.field);
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
    let portalOwner = null, portalConfiguration = null;
    const ensurePortalConfiguration = () => {
      const owner = enabled && state.status === "authenticated" ? state.user?.id : null;
      if (!owner || portalOwner === owner) return;
      portalOwner = owner; portalConfiguration = null;
      // Availability is a server capability, not a hostname or a guessed role.
      // This read is account-page-only; it never opens a business-data endpoint.
      requestJson("/api/portal/config").then(({response, body}) => {
        if (portalOwner !== owner || state.status !== "authenticated" || state.user?.id !== owner) return;
        portalConfiguration = response.ok && body?.ok === true && typeof body.enabled === "boolean"
          ? {enabled: body.enabled, files: body.enabled === true && body.uploads_enabled === true} : null;
        render();
      }).catch(() => {
        if (portalOwner === owner && state.status === "authenticated" && state.user?.id === owner) render();
      });
    };
    const render = () => {
      const portalNavigation = document.querySelector("[data-rexbid-account-portal]");
      if (!enabled || state.status !== "authenticated") { portalOwner = null; portalConfiguration = null; }
      const portalAvailable = enabled && state.status === "authenticated" && portalConfiguration?.enabled === true;
      if (portalNavigation) {
        portalNavigation.hidden = !portalAvailable;
        const portalLink = portalNavigation.querySelector("a");
        if (portalLink) portalLink.textContent = portalConfiguration?.files === true
          ? "Moje importy — etapy, rozmowy i dokumenty" : "Moje importy — etapy i rozmowy";
      }
      if (!enabled) {
        const title = document.createElement("h2"); title.textContent = "Konto niedostępne";
        const message = document.createElement("p"); message.textContent = "Logowanie jest obecnie niedostępne.";
        host.replaceChildren(title, message); return;
      }
      if (state.status !== "authenticated") {
        host.replaceChildren(); const title = document.createElement("h2"); title.textContent = "Zaloguj się do konta";
        const link = document.createElement("a"); link.href = "/logowanie.html?return_to=%2Fkonto.html"; link.textContent = "Przejdź do logowania"; link.className = "btn btn-red"; host.append(title, link); return;
      }
      ensurePortalConfiguration();
      const title = document.createElement("h2"); title.textContent = "Konto REXBID";
      const verified = document.createElement("p"); verified.textContent = state.user.email_verified === true ? "Status: zalogowano · e-mail potwierdzony" : "Status: zalogowano";
      const provider = document.createElement("p"); provider.textContent = "Dostawca logowania: " + text(state.user.auth_provider || "—");
      const favorites = document.createElement("p"); favorites.textContent = "Ulubione w chmurze: " + String(state.cache.length);
      const link = document.createElement("a"); link.href = "/ulubione.html"; link.textContent = "Otwórz ulubione"; link.className = "btn btn-outline";
      const logoutButton = document.createElement("button"); logoutButton.type = "button"; logoutButton.className = "btn btn-red"; logoutButton.textContent = "Wyloguj";
      logoutButton.addEventListener("click", async () => { try { await logout(); } finally { render(); updateNavigation(); } });
      const exportButton = document.createElement("button"); exportButton.type = "button"; exportButton.className = "btn btn-outline"; exportButton.textContent = "Pobierz moje dane";
      exportButton.id = "accountDownload"; exportButton.disabled = accountExportPending;
      const exportStatus = document.createElement("p"); exportStatus.id = "accountExportStatus"; exportStatus.setAttribute("role", "status"); exportStatus.textContent = accountExportFeedback;
      const exportNotice = document.createElement("p"); exportNotice.id = "accountExportNotice";
      exportNotice.textContent = portalConfiguration?.enabled === false
        ? "Eksport obejmuje dane konta i ulubione. Panel importów jest obecnie niedostępny."
        : portalAvailable
          ? "Zakres eksportu obejmuje konto, profil kontaktowy, ulubione i dane własnych importów wraz z rozmowami. Nie zawiera treści załączników."
            + (portalConfiguration.files ? " Dostępne zdjęcia i dokumenty pobierzesz osobno z panelu importów." : " Obsługa załączników jest obecnie wyłączona.")
          : "Eksport danych konta i ulubionych jest dostępny. Dostępność pozostałych danych zostanie sprawdzona przy pobieraniu.";
      exportButton.addEventListener("click", async () => {
        if (accountExportPending || !enabled || state.status !== "authenticated" || !state.user?.id) return;
        const owner = state.user.id;
        const getIdentity = () => enabled && state.status === "authenticated" ? state.user?.id : null;
        let cancelled = false;
        const cancelExport = () => { if (getIdentity() !== owner) cancelled = true; };
        const leavePage = () => { cancelled = true; };
        root.addEventListener?.("rexbid:auth-state", cancelExport); root.addEventListener?.("pagehide", leavePage); root.addEventListener?.("rexbid:logout-start", leavePage);
        accountExportPending = true; accountExportMfaRequired = false; accountExportFeedback = "Przygotowuję eksport Twoich danych…";
        exportButton.disabled = true; exportStatus.textContent = accountExportFeedback;
        try {
          if (typeof root.RexBidDataExport?.download === "function") {
            const result = await root.RexBidDataExport.download({ getIdentity, onProgress: progress => {
              if (cancelled || getIdentity() !== owner) return;
              const labels = { account:"konto", profile:"profil kontaktowy", favorites:"ulubione", orders:"importy", events:"historia", messages:"rozmowy", files:"metadane plików" };
              accountExportFeedback = "Pobieram: " + (labels[progress.section] || "dane") + "…"; exportStatus.textContent = accountExportFeedback;
            }});
            if (cancelled || getIdentity() !== owner || !result?.ok) throw Object.assign(new Error("EXPORT_CANCELLED"), { code:"EXPORT_CANCELLED" });
            accountExportFeedback = result.scope === "account_favorites_only"
              ? "Pobrano dane konta i ulubione. Panel importów jest wyłączony; importy, rozmowy i pliki nie są objęte tym eksportem."
              : "Pobrano dane konta, profil kontaktowy, ulubione i własne importy z historią, rozmowami oraz metadanymi plików.";
          } else {
            // Compatibility for pages without the new module. The original
            // exportAccount() API contract remains unchanged.
            const result = await exportAccount();
            if (!result.ok) throw Object.assign(new Error("EXPORT_UNAVAILABLE"), { code:result.status === 401 ? "EXPORT_UNAUTHORIZED" : "EXPORT_UNAVAILABLE" });
            if (cancelled || getIdentity() !== owner || result.data?.profile?.id !== owner) throw Object.assign(new Error("EXPORT_IDENTITY_CHANGED"), { code:"EXPORT_IDENTITY_CHANGED" });
            const data = { ...result.data, scope:"account_favorites_only", included_sections:["account","favorites"], notices:["Ten eksport obejmuje wyłącznie dane konta i ulubione."] };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json" });
            const objectUrl = URL.createObjectURL(blob); const download = document.createElement("a");
            try { if (cancelled || getIdentity() !== owner) throw Object.assign(new Error("EXPORT_CANCELLED"), { code:"EXPORT_CANCELLED" }); download.href = objectUrl; download.download = "rexbid-dane-konta-i-ulubionych.json"; download.click(); }
            finally { URL.revokeObjectURL(objectUrl); }
            accountExportFeedback = "Pobrano dane konta i ulubione. Ten eksport nie obejmuje importów, rozmów ani plików.";
          }
        } catch (error) {
          if (getIdentity() === owner) {
            accountExportMfaRequired = error?.code === "EXPORT_OWNER_MFA_REQUIRED";
            accountExportFeedback = accountExportMfaRequired ? "Potwierdź logowanie właściciela kodem 2FA w panelu administracyjnym, a następnie ponów eksport."
              : error?.code === "EXPORT_UNAUTHORIZED" ? "Sesja wygasła. Zaloguj się ponownie, aby pobrać dane."
              : ["EXPORT_CANCELLED","EXPORT_IDENTITY_CHANGED"].includes(error?.code) ? "Pobieranie zostało przerwane."
              : ["EXPORT_TOO_LARGE","EXPORT_PAGE_LIMIT"].includes(error?.code) ? "Eksport przekracza limit tego pobrania. Skontaktuj się z obsługą REXBID, aby otrzymać pełny zakres danych."
              : "Nie udało się przygotować pełnego eksportu. Spróbuj ponownie.";
          }
        } finally {
          root.removeEventListener?.("rexbid:auth-state", cancelExport); root.removeEventListener?.("pagehide", leavePage); root.removeEventListener?.("rexbid:logout-start", leavePage);
          accountExportPending = false;
          if (getIdentity() === owner) render();
        }
      });
      const children = [title, verified];
      if (state.user.email) { const email = document.createElement("p"); email.textContent = "E-mail: " + text(state.user.email); children.push(email); }
      children.push(provider, favorites, link, exportButton, exportNotice, exportStatus);
      if (accountExportMfaRequired) { const mfaLink = document.createElement("a"); mfaLink.href = "/administracja.html"; mfaLink.textContent = "Przejdź do potwierdzenia 2FA"; mfaLink.className = "btn btn-outline"; children.push(mfaLink); }
      children.push(logoutButton);
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
    const field = (labelText, type, autocomplete) => {
      const label = document.createElement("label"); label.textContent=labelText;
      const input = document.createElement("input"); input.type=type; input.autocomplete=autocomplete; input.setAttribute("aria-label",labelText);
      label.append(input); return { label, input };
    };
    const emailField = field("Adres e-mail", "email", "email"), email = emailField.input;
    const passwordField = field("Nowe hasło", "password", "new-password"), password = passwordField.input;
    const confirmField = field("Powtórz nowe hasło", "password", "new-password"), confirmPassword = confirmField.input;
    password.minLength=8; confirmPassword.minLength=8;
    const submit = document.createElement("button"); submit.type="submit"; submit.className="btn btn-red";
    const loginLink = document.createElement("a"); loginLink.href="/logowanie.html"; loginLink.textContent="Przejdź do logowania";
    form.append(emailField.label,passwordField.label,confirmField.label,submit); box.append(title,message,form,loginLink);
    document.getElementById?.("recoveryLoading")?.remove(); main.append(box);
    form.hidden=true;
    await ready;
    if (!enabled) { message.textContent="Odzyskiwanie dostępu jest chwilowo niedostępne."; return; }
    let recoverySession = false;
    try {
      const result = await requestJson("/api/auth/recovery-session");
      if (!result.response.ok || result.body?.ok !== true) throw new Error("RECOVERY_STATUS_UNAVAILABLE");
      recoverySession = result.body.recovery_ready === true;
    } catch { message.textContent="Nie udało się sprawdzić linku. Odśwież stronę i spróbuj ponownie."; return; }
    const renderMode = () => {
      emailField.label.hidden=recoverySession; email.required=!recoverySession;
      passwordField.label.hidden=!recoverySession; confirmField.label.hidden=!recoverySession;
      password.required=recoverySession; confirmPassword.required=recoverySession;
      title.textContent=recoverySession ? "Ustaw nowe hasło" : "Nie pamiętasz hasła?";
      submit.textContent=recoverySession ? "Zapisz nowe hasło" : "Wyślij link odzyskiwania";
      form.hidden=false;
    };
    renderMode();
    const recoveryHint = new URLSearchParams(root.location.search).get("recovery");
    message.textContent=recoverySession ? "Wpisz nowe hasło do konta. Minimum 8 znaków." : recoveryHint ? "Link nie może zostać użyty w tej przeglądarce, został wykorzystany lub stracił ważność. Poproś o nową wiadomość." : "Wyślemy instrukcję, jeśli adres jest powiązany z kontem REXBID.";
    form.addEventListener("submit", async event => {
      if (submit.disabled) { event.preventDefault(); return; }
      event.preventDefault(); submit.disabled=true; message.textContent="";
      try {
        if (recoverySession) {
          if ((password.value || "").length < 8 || password.value.length > 1024) { message.textContent="Hasło musi mieć od 8 do 1024 znaków."; return; }
          if (password.value !== confirmPassword.value) { message.textContent="Wpisane hasła nie są takie same."; return; }
          const result = await updatePassword(password.value);
          if (result.ok) {
            password.value=""; confirmPassword.value=""; form.hidden=true;
            message.textContent="Hasło zmienione. Zaloguj się ponownie nowym hasłem.";
          } else if (result.status === 401) {
            recoverySession=false; password.value=""; confirmPassword.value=""; renderMode();
            message.textContent="Link został wykorzystany lub stracił ważność. Poproś o nową wiadomość.";
          } else message.textContent = result.error || "Nie udało się zmienić hasła. Spróbuj ponownie.";
        } else {
          const value = (email.value || "").trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { message.textContent="Wpisz prawidłowy adres e-mail."; return; }
          const result = await requestPasswordReset(value);
          message.textContent=result.ok ? "Jeśli adres jest powiązany z kontem, wyślemy wiadomość z instrukcją. Sprawdź też folder Spam." : result.status === 429 ? "Zbyt wiele prób. Spróbuj ponownie później." : "Wysyłka jest chwilowo niedostępna. Spróbuj ponownie później.";
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
    const note = document.querySelector(".device-note"); if (note) note.textContent = "Ulubione zapisane na koncie REXBID.";
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
      const list = document.createElement("ul"); list.className = "cloud-favorites-list";
      for (const car of cars) {
        const li = document.createElement("li"), link = document.createElement("a"), remove = document.createElement("button");
        li.className = "cloud-favorite";
        const vin = text(car.vin), lot = text(car.lot); link.href = storage.detailHref(car);
        link.textContent = text(car.title) || [car.year, car.make, car.model].filter(Boolean).join(" ") || (vin ? "VIN " + vin : "LOT " + lot);
        remove.type = "button"; remove.textContent = "Usuń"; remove.addEventListener("click", async () => { if (await removeFavorite(car.id)) render(); });
        const identity = document.createElement('p'); identity.className = 'cloud-favorite-identity';
        identity.textContent = [text(car.platform).toUpperCase(), lot ? 'LOT ' + lot : '', vin ? 'VIN ' + vin : ''].filter(Boolean).join(' · ');
        const actions = document.createElement('div'); actions.className = 'cloud-favorite-actions';
        const compare = document.createElement('button'); compare.type = 'button'; compare.dataset.compareLot = lot; compare.dataset.comparePlatform = text(car.platform).toLowerCase(); compare.textContent = 'Porównaj'; compare.setAttribute('aria-pressed','false');
        actions.append(compare,remove); li.append(link,identity,actions); list.append(li);
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
    async initialize() { await ready; updateNavigation(); const path = pagePath(); if (path === "/konto") await mountAccountPage(); if (path === "/reset-hasla") await mountRecoveryPage(); },
  };
  root.RexBidAuth = api;
  if (pagePath() === "/rejestracja") mountAuthForm("signup");
  if (pagePath() === "/logowanie") mountAuthForm("login");
  root.addEventListener?.("rexbid:auth-state", updateNavigation);
  ready.then(() => { if (pagePath() === "/reset-hasla") mountRecoveryPage(); if (!enabled) { if (pagePath() === "/konto") mountAccountPage(); return; } consumeCallbackDiagnostic(); updateNavigation(); if (state.status === "authenticated") mergeGuestFavorites().catch(() => {}); if (pagePath() === "/konto") mountAccountPage(); });
})(typeof window !== "undefined" ? window : globalThis);
