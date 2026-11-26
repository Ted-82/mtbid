(function (root) {
  "use strict";

  // The server verifies the owner's identity and the signed assurance level.
  // This UI never grants a role or keeps an authentication token in the browser.
  const mounts = new WeakMap();
  const API = "/api/portal/security";
  const MAX_QR_LENGTH = 1572864;
  const factorId = value => typeof value === "string" && /^[A-Za-z0-9_-]{8,160}$/.test(value);
  const text = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160) : "";

  function safeQr(value) {
    if (typeof value !== "string" || !value || value.length > MAX_QR_LENGTH) return null;
    let svg = value;
    if (value.startsWith("data:image/png;base64,")) {
      return /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : null;
    }
    if (value.startsWith("data:image/svg+xml")) {
      const comma = value.indexOf(",");
      if (comma < 0) return null;
      const header = value.slice(0, comma).toLowerCase();
      if (!/^data:image\/svg\+xml(?:;charset=utf-8)?(?:;base64)?$/.test(header)) return null;
      try {
        svg = header.endsWith(";base64") ? root.atob(value.slice(comma + 1)) : decodeURIComponent(value.slice(comma + 1));
      } catch { return null; }
    } else if (!value.trimStart().startsWith("<svg")) return null;
    if (svg.length > 524288 || /<!DOCTYPE|<!ENTITY|<\?/i.test(svg)) return null;
    let parsed;
    try { parsed = new root.DOMParser().parseFromString(svg, "image/svg+xml"); }
    catch { return null; }
    if (parsed.querySelector("parsererror") || parsed.documentElement?.localName !== "svg") return null;
    const tags = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "title", "desc"]);
    const attributes = new Set(["xmlns", "width", "height", "viewBox", "version", "fill", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "rx", "ry", "r", "d", "points", "transform", "shape-rendering", "preserveAspectRatio"]);
    const nodes = [parsed.documentElement, ...parsed.documentElement.querySelectorAll("*")];
    if (nodes.length > 10000) return null;
    for (const node of nodes) {
      if (!tags.has(node.localName) || (node.namespaceURI && node.namespaceURI !== "http://www.w3.org/2000/svg")) return null;
      for (const attribute of [...node.attributes]) {
        // SVGo declares xlink but does not use it for QR rectangles. Remove
        // only this exact namespace; href/use/image remain forbidden.
        if (node === parsed.documentElement && attribute.name === "xmlns:xlink"
          && attribute.value === "http://www.w3.org/1999/xlink") {
          node.removeAttribute(attribute.name); continue;
        }
        // Normalize only the two literal styles emitted by goqrsvg. Do not
        // open the allowlist to arbitrary CSS or external resources.
        if (node.localName === "rect" && attribute.name === "style"
          && /^fill:(?:black|white);stroke:none$/.test(attribute.value)) {
          node.setAttribute("fill", attribute.value.includes("black") ? "black" : "white");
          node.setAttribute("stroke", "none");
          node.removeAttribute("style"); continue;
        }
        if (!attributes.has(attribute.name) || /url\s*\(|javascript:|https?:|data:/i.test(attribute.value) && attribute.name !== "xmlns") return null;
      }
    }
    const normalized = new root.XMLSerializer().serializeToString(parsed.documentElement);
    const result = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(normalized);
    return result.length <= MAX_QR_LENGTH ? result : null;
  }

  function mount(element, options = {}) {
    if (!element || element.nodeType !== 1) return null;
    if (mounts.has(element)) {
      const existing = mounts.get(element);
      existing.setOptions(options);
      return existing;
    }
    const doc = element.ownerDocument;
    let settings = options;
    let generation = 0;
    let busy = false;
    let destroyed = false;
    let activeController = null;
    let activeFactor = null;
    let enrolled = null;
    let verified = false;
    const create = (tag, className, content) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (content !== undefined) node.textContent = content;
      return node;
    };
    const section = create("section", "portal-box portal-owner-tools portal-mfa");
    section.setAttribute("aria-labelledby", "rexbidOwnerMfaTitle");
    const heading = create("h2", "", "Ochrona panelu właściciela");
    heading.id = "rexbidOwnerMfaTitle";
    const description = create("p", "portal-owner-note portal-mfa-description", "Dostęp do obsługi importów wymaga kodu z Twojej aplikacji uwierzytelniającej.");
    const feedback = create("p", "portal-form-feedback", "Sprawdzam zabezpieczenia konta…");
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    const controls = create("div", "portal-form");
    section.append(heading, description, feedback, controls);
    // Only the exact staging host can display the server's bounded, secret-free
    // diagnostic record. Never render upstream error text or response bodies.
    const traceList = create("ol", "portal-mfa-diagnostics");
    if (root.location?.origin === "https://rexbid-auth-test.tedn828.workers.dev") {
      const details = create("details");
      details.append(create("summary", "", "Diagnostyka MFA — staging"), traceList);
      section.append(details);
    }
    const safeCodes = new Set([
      "MFA_ENROLLMENT_PENDING", "MFA_UNAVAILABLE", "MFA_INVALID_ENROLLMENT", "MFA_INVALID_CHALLENGE", "MFA_INVALID_SESSION", "MFA_REQUEST_REJECTED",
      "AUTH_TIMEOUT", "AUTH_UNAVAILABLE", "AUTH_UNEXPECTED_REDIRECT", "AUTH_REJECTED", "AUTH_RATE_LIMITED", "MFA_RESTART_BLOCKED", "MFA_RESTART_UNCERTAIN",
      "mfa_factor_name_conflict", "mfa_factor_not_found", "mfa_factor_limit_reached", "mfa_totp_enroll_not_enabled", "mfa_totp_verify_not_enabled",
      "mfa_challenge_expired", "mfa_verification_failed", "mfa_verification_rejected", "over_request_rate_limit", "over_request_limit",
      "insufficient_aal", "session_not_found", "session_expired", "bad_jwt", "unexpected_failure", "validation_failed"
    ]);
    function recordDiagnostic(value) {
      if (!traceList.isConnected || !value || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.request_id || "")) return;
      if (!["read", "enroll", "challenge", "verify", "restart-pending"].includes(value.operation)
        || !["method", "owner_session", "configuration", "origin", "limiter", "session", "account_lookup", "owner_policy", "factor_state", "input", "enrollment_guard", "upstream_enroll", "enrollment_payload", "upstream_challenge", "challenge_payload", "challenge_receipt", "upstream_verify", "session_verification", "complete", "restart_preflight", "restart_recheck", "upstream_unenroll_pending", "restart_readback"].includes(value.stage)) return;
      const status = n => Number.isInteger(n) && n >= 100 && n <= 599 ? n : "brak";
      const count = n => Number.isInteger(n) && n >= 0 && n <= 20 ? n : "brak";
      const line = `${value.operation} · ${value.stage} · HTTP ${status(value.http_status)} · Supabase ${status(value.upstream_status)} · ${safeCodes.has(value.safe_code) ? value.safe_code : "bez kodu błędu"} · TOTP potwierdzone: ${count(value.verified_totp_count)}, oczekujące: ${count(value.pending_totp_count)} · ID ${value.request_id}`;
      traceList.append(create("li", "", line));
      while (traceList.children.length > 5) traceList.firstElementChild.remove();
    }
    element.replaceChildren(section);
    element.hidden = false;

    const say = (message, tone = "") => {
      feedback.textContent = message;
      feedback.dataset.tone = tone;
    };
    function lock(value) {
      busy = value;
      section.setAttribute("aria-busy", String(value));
      for (const control of controls.querySelectorAll("button,input,select")) control.disabled = value;
    }
    function errorMessage(status, stage, code) {
      if (code === "MFA_RESTART_BLOCKED") return "Stan zabezpieczeń zmienił się lub zgoda na ponowną konfigurację wygasła. Operacja została zatrzymana.";
      if (code === "MFA_RESTART_UNCERTAIN") return "Nie udało się potwierdzić stanu po operacji. Sprawdź istniejącą konfigurację; nie ponawiamy usuwania automatycznie.";
      if (code === "MFA_ENROLLMENT_PENDING" || code === "mfa_factor_name_conflict") return "Istnieje już konfiguracja aplikacji uwierzytelniającej. Sprawdź jej stan i dokończ weryfikację; nie twórz kolejnej.";
      if (code === "mfa_factor_limit_reached") return "Konto osiągnęło limit zabezpieczeń MFA. Nie usuwamy istniejących zabezpieczeń automatycznie.";
      if (code === "mfa_totp_enroll_not_enabled" || code === "mfa_totp_verify_not_enabled") return "Obsługa TOTP jest wyłączona w konfiguracji usługi uwierzytelniania.";
      if (status === 401) return "Sesja wygasła. Zaloguj się ponownie do konta właściciela.";
      if (status === 429) return "Zbyt wiele prób. Odczekaj chwilę przed kolejną weryfikacją.";
      if (status === 503) return "Weryfikacja właściciela nie jest jeszcze dostępna. Dostęp administracyjny pozostaje zamknięty.";
      if (status === 403 && stage === "state") return "To konto nie ma uprawnień właściciela REXBID.";
      if (status === 403) return "Weryfikacja nie została zakończona lub wygasła. Sprawdź kod i spróbuj ponownie.";
      if (status === 400) return "Nie udało się potwierdzić kodu. Wpisz aktualne sześć cyfr z aplikacji.";
      return "Nie udało się połączyć z usługą weryfikacji. Ponów czynność, gdy połączenie będzie dostępne.";
    }
    async function request(path, payload, stage) {
      const controller = typeof root.AbortController === "function" ? new root.AbortController() : null;
      activeController = controller;
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = root.setTimeout(() => { controller?.abort(); reject(new Error("MFA_TIMEOUT")); }, 12000);
      });
      try {
        const response = await Promise.race([root.fetch(path, {
          method: payload === undefined ? "GET" : "POST",
          credentials: "same-origin", cache: "no-store", redirect: "error",
          ...(payload === undefined ? {} : {headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload)}),
          ...(controller ? {signal: controller.signal} : {})
        }), timeout]);
        const body = await Promise.race([response.json().catch(() => null), timeout]);
        recordDiagnostic(body?.diagnostic);
        if (!response.ok || !body || body.ok !== true) {
          throw Object.assign(new Error("MFA_REQUEST_REJECTED"), {status: response.status, stage, code: safeCodes.has(body?.code) ? body.code : null});
        }
        return body;
      } finally {
        root.clearTimeout(timer);
        if (activeController === controller) activeController = null;
      }
    }
    function button(label, callback, secondary = false) {
      const node = create("button", "portal-button" + (secondary ? " portal-button-secondary" : ""), label);
      node.type = "button";
      node.addEventListener("click", () => { if (!busy && !destroyed) callback(); });
      return node;
    }
    function clearEnrollment() {
      enrolled = null;
      controls.replaceChildren();
    }
    function showVerified(notify) {
      verified = true;
      activeFactor = null;
      clearEnrollment();
      say("Konto właściciela zostało zweryfikowane drugim składnikiem.", "success");
      description.textContent = "Możesz teraz bezpiecznie obsługiwać importy klientów w tej sesji.";
      if (notify) {
        doc.dispatchEvent(new root.CustomEvent("rexbid:owner-mfa-verified"));
        if (typeof settings.onVerified === "function") { try { settings.onVerified(); } catch {} }
      }
    }
    function renderCode() {
      controls.replaceChildren();
      if (enrolled) {
        const qr = safeQr(enrolled.qr_code);
        const manualInstruction = "Dodaj konto ręcznie w aplikacji uwierzytelniającej na telefonie. Nadaj mu nazwę REXBID i wpisz poniższy klucz. Jeśli aplikacja pyta o typ, wybierz kod oparty na czasie (TOTP).";
        const instruction = create("p", "portal-form-note", qr
          ? "Dodaj REXBID do aplikacji uwierzytelniającej na telefonie: zeskanuj kod QR lub wprowadź poniższy klucz ręcznie."
          : "Kod QR nie jest dostępny. " + manualInstruction);
        controls.append(instruction);
        if (qr) {
          const image = create("img", "portal-mfa-qr");
          image.src = qr;
          image.alt = "Kod QR do konfiguracji drugiego składnika REXBID";
          image.width = 200; image.height = 200;
          image.addEventListener("error", () => {
            image.remove();
            instruction.textContent = "Nie udało się wyświetlić kodu QR. " + manualInstruction;
          }, {once: true});
          controls.append(image);
        }
        if (enrolled.secret) {
          controls.append(create("strong", "portal-mfa-key-label", "Klucz do wpisania w aplikacji na telefonie"));
          const key = create("code", "portal-mfa-secret", enrolled.secret);
          key.setAttribute("aria-label", "Klucz konfiguracji aplikacji uwierzytelniającej");
          controls.append(key);
        }
        controls.append(create("p", "portal-form-note", "Po dodaniu konta aplikacja pokaże sześciocyfrowy kod. Wpisz go w polu poniżej. Długi klucz służy do konfiguracji aplikacji; nie jest kodem do tego pola. Klucz pokazujemy tylko podczas konfiguracji."));
      }
      const form = create("form", "portal-form");
      form.setAttribute("autocomplete", "off");
      const label = create("label", "", "Kod z aplikacji uwierzytelniającej");
      const input = create("input", "portal-mfa-code");
      input.name = "owner_mfa_code";
      input.type = "text";
      input.inputMode = "numeric";
      input.autocomplete = "one-time-code";
      input.pattern = "[0-9]{6}";
      input.minLength = 6; input.maxLength = 6;
      input.required = true;
      input.placeholder = "000000";
      input.setAttribute("aria-label", "Sześciocyfrowy kod z aplikacji uwierzytelniającej");
      label.append(input);
      const submit = create("button", "portal-button", "Potwierdź dostęp właściciela");
      submit.type = "submit";
      form.append(label, submit);
      form.addEventListener("submit", async event => {
        event.preventDefault();
        const code = input.value.trim();
        input.value = "";
        if (busy || destroyed || verified) return;
        if (!/^[0-9]{6}$/.test(code)) {
          say("Wpisz sześciocyfrowy kod z aplikacji uwierzytelniającej.", "error");
          input.focus();
          return;
        }
        const current = generation;
        lock(true); say("Potwierdzam drugi składnik…");
        try {
          const challenge = await request(API + "/challenge", {factor_id: activeFactor}, "challenge");
          if (destroyed || current !== generation) return;
          if (!factorId(challenge.challenge_id)) throw new Error("MFA_INVALID_CHALLENGE");
          const result = await request(API + "/verify", {factor_id: activeFactor, challenge_id: challenge.challenge_id, code}, "verify");
          if (destroyed || current !== generation) return;
          if (result.assurance_level !== "aal2") throw new Error("MFA_ASSURANCE_NOT_CONFIRMED");
          showVerified(true);
        } catch (error) {
          if (!destroyed && current === generation) say(errorMessage(error.status, error.stage, error.code), "error");
        } finally {
          if (!destroyed && current === generation) lock(false);
        }
      });
      controls.append(form);
    }
    async function enroll() {
      const current = generation;
      lock(true); say("Przygotowuję konfigurację drugiego składnika…");
      try {
        const result = await request(API + "/enroll", {}, "enroll");
        if (destroyed || current !== generation) return;
        const factor = result.factor;
        if (!factor || !factorId(factor.id) || factor.factor_type && factor.factor_type !== "totp") throw new Error("MFA_INVALID_FACTOR");
        const secret = typeof factor.secret === "string" && /^[A-Z2-7 ]{16,128}$/i.test(factor.secret) ? factor.secret : "";
        const qr = safeQr(factor.qr_code);
        if (!secret && !qr) throw new Error("MFA_CONFIGURATION_MISSING");
        activeFactor = factor.id;
        enrolled = {secret, qr_code: qr};
        renderCode();
        say("Dodaj konto REXBID do swojej aplikacji i wpisz kod, aby zakończyć konfigurację.");
      } catch (error) {
        if (!destroyed && current === generation) {
          say(errorMessage(error.status, error.stage, error.code), "error");
          if (error.status === 409) {
            controls.replaceChildren(button("Sprawdź istniejącą konfigurację", refresh));
          }
        }
      } finally {
        if (!destroyed && current === generation) lock(false);
      }
    }
    async function restartPending() {
      const current = generation;
      const selected = activeFactor;
      lock(true); say("Ponownie sprawdzam właściciela i zabezpieczenia przed zmianą…");
      try {
        const result = await request(API + "/restart-pending", {factor_id: selected}, "restart-pending");
        if (destroyed || current !== generation) return;
        if (result.removed_pending !== true) throw new Error("MFA_RESTART_UNCERTAIN");
        activeFactor = null;
        clearEnrollment();
        // Enrollment is a separate guarded operation. The new key/QR is sent
        // only to this browser, never to telemetry or persistent UI storage.
        await enroll();
      } catch (error) {
        if (!destroyed && current === generation) {
          say(errorMessage(error.status, error.stage, error.code), "error");
          controls.replaceChildren(button("Sprawdź istniejącą konfigurację", refresh));
        }
      } finally {
        if (!destroyed && current === generation) lock(false);
      }
    }
    async function refresh() {
      if (busy || destroyed) return;
      const current = ++generation;
      activeFactor = null; verified = false;
      clearEnrollment(); lock(true); say("Sprawdzam zabezpieczenia konta…");
      try {
        const result = await request(API, undefined, "state");
        if (destroyed || current !== generation) return;
        if (result.owner !== true) throw Object.assign(new Error("MFA_OWNER_REQUIRED"), {status: 403, stage: "state"});
        if (result.assurance_level === "aal2") { showVerified(false); return; }
        const factors = Array.isArray(result.factors) ? result.factors : [];
        const confirmed = factors.filter(item => item?.status === "verified");
        const pending = factors.filter(item => item?.status === "unverified" && item.factor_type === "totp" && factorId(item.id));
        const hasVerified = confirmed.length > 0 || result.has_verified_factor === true;
        const usable = confirmed.filter(item => item.factor_type === "totp" && factorId(item.id));
        if (!hasVerified) usable.push(...pending);
        if (usable.length) {
          activeFactor = usable[0].id;
          renderCode();
          if (usable.length > 1) {
            const label = create("label", "", "Aplikacja uwierzytelniająca");
            const select = create("select");
            select.name = "owner_mfa_factor";
            for (const factor of usable) {
              const choice = create("option", "", text(factor.friendly_name) || "Aplikacja uwierzytelniająca");
              choice.value = factor.id; select.append(choice);
            }
            select.addEventListener("change", () => { activeFactor = select.value; });
            label.append(select); controls.prepend(label);
          }
          say(hasVerified ? "Wpisz aktualny kod z aplikacji przypisanej do konta właściciela."
            : "Konfiguracja TOTP została rozpoczęta, ale nie jest jeszcze potwierdzona. Jeśli REXBID jest już dodany w aplikacji, wpisz jej aktualny kod. Poprzedniego QR ani klucza nie można odczytać ponownie. Jeśli nie dodano konta w aplikacji, potrzebna jest osobna decyzja o ponownej konfiguracji. Niczego nie resetujemy automatycznie.");
          if (!hasVerified && pending.length === 1 && result.restart_pending_available === true
            && root.location?.origin === "https://rexbid-auth-test.tedn828.workers.dev") {
            controls.prepend(button("Rozpocznij konfigurację QR od nowa", restartPending, true));
            controls.prepend(create("p", "portal-form-note", "Zatwierdzona jednorazowa operacja: usuń wyłącznie poprzednią, niepotwierdzoną konfigurację TOTP i pokaż nowy QR. Jeśli istnieje jakiekolwiek potwierdzone zabezpieczenie, operacja zostanie zatrzymana. Nie wykonuj równolegle weryfikacji w innej karcie."));
          }
        } else if (hasVerified) {
          say("Konto ma już drugi składnik. Zaloguj się z jego użyciem; konfiguracja kolejnego składnika wymaga zweryfikowanej sesji.", "error");
        } else {
          say("Skonfiguruj aplikację uwierzytelniającą, aby odblokować obsługę importów.");
          controls.append(button("Skonfiguruj ochronę konta", enroll));
        }
      } catch (error) {
        if (!destroyed && current === generation) {
          clearEnrollment();
          say(errorMessage(error.status, error.stage, error.code), "error");
          if (error.status === 401) {
            const login = create("a", "portal-button", "Zaloguj się ponownie");
            login.href = "/logowanie.html?return_to=%2Fadministracja.html";
            controls.append(login);
          }
          controls.append(button("Sprawdź dostęp ponownie", refresh, true));
        }
      } finally {
        if (!destroyed && current === generation) lock(false);
      }
    }
    const controller = {
      refresh,
      setOptions(next) { settings = {...settings, ...next}; },
      destroy() {
        destroyed = true; generation += 1;
        activeController?.abort(); activeController = null;
        activeFactor = null; enrolled = null;
        element.replaceChildren(); mounts.delete(element);
      }
    };
    mounts.set(element, controller);
    refresh();
    return controller;
  }
  root.RexbidOwnerMfa = Object.freeze({mount});
  const autoMount = () => {
    const element = root.document?.getElementById("rexbid-owner-mfa");
    if (element) mount(element);
  };
  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", autoMount, {once: true});
  else autoMount();
})(typeof window !== "undefined" ? window : globalThis);
