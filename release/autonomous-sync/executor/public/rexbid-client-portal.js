/* REXBID private import workspace. The server authorizes every operation.
   Private orders, files and messages stay in page memory, never web storage. */
(function (root) {
  "use strict";
  const STAGES = [
    ["preparation", "Przygotowanie"], ["auction_won", "Wygrana aukcja"],
    ["payment_confirmed", "Płatność potwierdzona"], ["pickup_planned", "Odbiór zaplanowany"],
    ["at_us_terminal", "Terminal w USA"], ["loaded", "Załadunek"],
    ["at_sea", "Transport morski"], ["at_eu_port", "Port w Europie"],
    ["customs", "Odprawa celna"], ["delivery", "Dostawa"], ["delivered", "Pojazd odebrany"]
  ];
  const stageLabel = value => STAGES.find(item => item[0] === value)?.[1] || "Etap do potwierdzenia";
  const asText = value => typeof value === "string" || typeof value === "number" ? String(value) : "";
  const fileId = value => /^[A-Za-z0-9_-]{1,100}$/.test(asText(value));
  const dateText = (value, withTime = false) => {
    if (!value) return "Nie ustalono";
    const input = asText(value);
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(input) ? input + "T12:00:00Z" : input);
    if (!Number.isFinite(date.getTime())) return "Nie ustalono";
    return date.toLocaleString("pl-PL", { timeZone:"Europe/Warsaw", day:"2-digit", month:"short", year:"numeric", ...(withTime ? { hour:"2-digit", minute:"2-digit" } : {}) });
  };
  function mount(doc, win) {
    if (!doc.getElementById("portalWorkspace")) return Promise.resolve();
    if (doc.documentElement.dataset.portalMounted) return win.RexBidClientPortal.ready;
    doc.documentElement.dataset.portalMounted = "true";
    const node = (tag, className, text) => { const element = doc.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = asText(text); return element; };
    const find = id => doc.getElementById(id);
    const ownerPage = doc.body.dataset.portalView === "owner";
    const state = { role:null, config:{}, clients:[], orders:[], offset:0, limit:20, hasMore:false, selected:null, detail:null, loadToken:0, accessEpoch:0, listBusy:false };
    const sessionBanner = node("section", "portal-session");
    sessionBanner.id = "portalSessionRole"; sessionBanner.hidden = true; sessionBanner.setAttribute("aria-label", "Bieżąca sesja konta");
    find("portalNotice").before(sessionBanner);
    function renderSessionRole() {
      sessionBanner.replaceChildren(); sessionBanner.hidden = !["owner", "client"].includes(state.role);
      if (sessionBanner.hidden) { delete sessionBanner.dataset.role; return; }
      sessionBanner.dataset.role = state.role;
      sessionBanner.append(node("strong", "portal-session-badge", state.role === "owner" ? "Sesja właściciela REXBID" : "Sesja klienta"));
      sessionBanner.append(node("p", "portal-session-note", state.role === "owner"
        ? "Korzystasz z uprawnień właściciela. Aby sprawdzić widok klienta, wyloguj się i zaloguj na konto klienta."
        : "Widzisz realizacje przypisane do Twojego konta klienta."));
    }
    const notice = (text, tone = "info") => { const box = find("portalNotice"); box.textContent = text; box.dataset.tone = tone; box.hidden = !text; };
    const feedback = (host, text, tone = "info") => { host.textContent = text; host.dataset.tone = tone; if (tone === "error") host.setAttribute("role", "alert"); else host.setAttribute("role", "status"); };
    function gate(title, message, login = false) {
      // Invalidate every pending API response, including requests started before
      // another request expired the session or the page entered the back cache.
      state.accessEpoch++; state.role = null; state.orders = []; state.clients = []; state.selected = null; state.detail = null; state.loadToken++; state.hasMore = false; state.offset = 0;
      renderSessionRole();
      find("portalWorkspace").hidden = true; find("portalOwnerLink").hidden = true;
      find("portalOrders").replaceChildren(); find("portalSummary").replaceChildren(); find("portalDetail").replaceChildren(); find("portalCreateMount").replaceChildren();
      find("portalGate").querySelectorAll("[data-portal-gate-action]").forEach(element => element.remove());
      find("portalGateTitle").textContent = title; find("portalGateText").textContent = message;
      find("portalLogin").hidden = !login; find("portalGate").hidden = false; notice("");
    }
    async function api(path, options = {}) {
      const epoch = state.accessEpoch;
      const stale = () => { const error = new Error("stale_request"); error.stale = true; return error; };
      let response, data;
      try {
        response = await win.fetch(path, { credentials:"same-origin", cache:"no-store", ...options, headers:{ ...(options.body && typeof options.body === "string" ? { "Content-Type":"application/json" } : {}), ...(options.headers || {}) } });
        data = await response.json();
      } catch { if (epoch !== state.accessEpoch) throw stale(); const error = new Error("network"); error.status = 0; throw error; }
      if (epoch !== state.accessEpoch) throw stale();
      if (!response.ok || data.ok !== true) { const error = new Error(asText(data.error) || "unavailable"); error.status = response.status; throw error; }
      return data;
    }
    function errorMessage(error) {
      if (error.status === 409 || error.message === "conflict") return "Dane zostały zmienione w międzyczasie. Odśwież realizację i sprawdź aktualny etap przed ponownym zapisem.";
      if (error.status === 413) return "Plik jest za duży. Maksymalny rozmiar to 8 MiB.";
      if (error.status === 415) return "Ten format pliku nie jest obsługiwany. Wybierz PDF, JPG lub PNG.";
      if (error.status === 400 || error.message === "invalid_request") return "Sprawdź wprowadzone dane. Operacja nie została potwierdzona.";
      if (error.status === 404) return "Nie znaleziono realizacji lub nie masz do niej dostępu.";
      if (error.status === 429) return "Zbyt wiele prób. Odczekaj chwilę przed kolejną operacją.";
      if (!error.status) return "Połączenie zostało przerwane. Wynik operacji nie jest potwierdzony — odśwież realizację przed ponowną próbą.";
      return "Usługa jest chwilowo niedostępna. Operacja nie została potwierdzona.";
    }
    function authError(error) {
      // A superseded response must neither restore data nor replace the gate
      // with a delayed success, authentication error or connection warning.
      if (error.stale === true) return true;
      if (error.status === 401 || error.message === "unauthorized") { gate("Zaloguj się do swojego konta", "Tutaj zobaczysz realizacje przypisane do Twojego konta REXBID, ich etapy i wiadomości.", true); return true; }
      if (error.message === "owner_mfa_required") {
        gate("Potwierdź dostęp właściciela", "Panel właściciela wymaga uwierzytelnienia wieloskładnikowego. Dokończ weryfikację kodem z aplikacji uwierzytelniającej.");
        if (!ownerPage) { const link = node("a", "portal-button", "Potwierdź konto właściciela"); link.href = "/administracja.html"; link.dataset.portalGateAction = "mfa"; find("portalGate").append(link); }
        return true;
      }
      if (error.status === 403) { gate("Dostęp niedostępny", "To konto nie ma uprawnień do tej części panelu."); return true; }
      return false;
    }
    function status(value) { const badge = node("span", "portal-status", stageLabel(value)); badge.dataset.complete = String(value === "delivered"); return badge; }
    function empty(title, text) { const box = node("div", "portal-empty"); if (title) box.append(node("strong", "", title)); if (text) box.append(node("span", "", text)); return box; }
    function box(title, subtitle) { const section = node("section", "portal-box"); const heading = node("div", "portal-box-heading"); const titleGroup = node("div"); titleGroup.append(node("h2", "", title)); if (subtitle) titleGroup.append(node("p", "portal-box-subtitle", subtitle)); heading.append(titleGroup); section.append(heading); return section; }
    function button(text, secondary = false) { const item = node("button", "portal-button" + (secondary ? " portal-button-secondary" : ""), text); item.type = "button"; return item; }
    function field(label, name, { value = "", type = "text", required = false, maxLength = 240, options = null } = {}) {
      const wrapper = node("label", "", label); const input = node(options ? "select" : type === "textarea" ? "textarea" : "input"); input.name = name;
      if (options) for (const [key, title] of options) { const option = node("option", "", title); option.value = key; input.append(option); }
      else if (type !== "textarea") input.type = type;
      if (!options && !["date", "file"].includes(type)) input.maxLength = maxLength;
      input.required = required;
      if (!options || options.some(([key]) => key === asText(value))) input.value = asText(value);
      wrapper.append(input); return { wrapper, input };
    }
    const unreadCount = order => Number.isSafeInteger(order?.unread_count) && order.unread_count > 0 ? order.unread_count : 0;
    const clientLabel = client => (client.account_type === "owner" ? "Konto właściciela REXBID · " : "") + ([client.profile?.name, client.profile?.email, client.profile?.phone].filter(Boolean).join(" · ") || "Profil nieuzupełniony · " + dateText(client.created_at) + " · " + asText(client.id).slice(-8));
    function summarize() {
      const summary = find("portalSummary"); summary.replaceChildren();
      const complete = state.orders.filter(order => order.status === "delivered").length;
      for (const [label, value, note] of [[ownerPage ? "Importy na tej stronie" : "Twoje importy na tej stronie", state.orders.length, state.hasMore ? "Dostępne są kolejne realizacje" : "Lista przypisana do konta"], ["W realizacji", state.orders.length - complete, "Etap aktualizuje zespół REXBID"], ["Zakończone", complete, "Pojazd odebrany"], ["Nowe wiadomości", state.orders.reduce((sum, order) => sum + unreadCount(order), 0), "Nieprzeczytane w realizacjach na tej stronie"]]) { const card = node("div", "portal-stat"); card.append(node("span", "portal-stat-label", label), node("strong", "", value), node("small", "", note)); summary.append(card); }
    }
    function renderList() {
      const list = find("portalOrders"); list.replaceChildren(); summarize();
      if (!state.orders.length) list.append(empty("Brak przypisanych importów", state.role === "owner" ? "Utwórz realizację dla istniejącego konta klienta." : "Gdy REXBID przypisze realizację do Twojego konta, zobaczysz tutaj jej postęp."));
      for (const order of state.orders) {
        const item = node("button", "portal-order-button"); item.type = "button"; item.dataset.orderId = asText(order.id); item.setAttribute("aria-pressed", String(order.id === state.selected));
        item.append(node("strong", "", order.title || "Pojazd w realizacji"), node("span", "portal-order-meta", [order.platform ? asText(order.platform).toUpperCase() : "", order.lot ? "LOT " + asText(order.lot) : "", order.vin || ""].filter(Boolean).join(" · ")), status(order.status));
        if (state.role === "owner") item.append(node("span", "portal-order-client", order.client_profile?.name || order.client_profile?.email || "Dane klienta nieuzupełnione"));
        item.append(node("span", "portal-order-location", order.location || "Lokalizacja do potwierdzenia"), node("span", "portal-order-updated", "Aktualizacja: " + dateText(order.updated_at, true)));
        if (order.estimated_arrival_at) item.append(node("span", "portal-order-eta", "ETA orientacyjny: " + dateText(order.estimated_arrival_at)));
        if (unreadCount(order)) { const unread = node("span", "portal-unread-badge", "Nowe wiadomości: " + unreadCount(order)); unread.dataset.portalUnread = asText(order.id); item.append(unread); }
        item.addEventListener("click", () => selectOrder(order.id, true)); list.append(item);
      }
      find("portalPrevious").hidden = state.offset === 0; find("portalNext").hidden = !state.hasMore;
    }
    async function loadOrders({ preserveSelection = true } = {}) {
      if (state.listBusy || !state.role) return;
      state.listBusy = true; find("portalRefresh").disabled = true; find("portalNext").disabled = true; find("portalPrevious").disabled = true;
      notice("Pobieram aktualne realizacje…");
      try {
        const data = await api("/api/portal/orders?limit=" + state.limit + "&offset=" + state.offset);
        state.orders = Array.isArray(data.orders) ? data.orders : []; state.hasMore = data.pagination?.has_more === true;
        const previous = preserveSelection && state.orders.some(order => order.id === state.selected) ? state.selected : state.orders[0]?.id;
        state.selected = previous || null; renderList(); notice("");
        if (state.selected) await selectOrder(state.selected);
        else find("portalDetail").replaceChildren(empty("Twój import w jednym miejscu", "Statusy i rozmowa pojawią się po dodaniu realizacji."));
      } catch (error) { if (!authError(error)) notice(errorMessage(error), "error"); }
      finally { state.listBusy = false; find("portalRefresh").disabled = false; find("portalNext").disabled = false; find("portalPrevious").disabled = false; }
    }
    async function selectOrder(id, moveFocus = false) {
      if (!fileId(id) || !state.role) return;
      const token = ++state.loadToken; state.selected = asText(id); state.detail = null; renderList(); find("portalDetail").setAttribute("aria-busy", "true");
      notice("Pobieram szczegóły realizacji…");
      try {
        const data = await api("/api/portal/orders/" + encodeURIComponent(id));
        if (token !== state.loadToken || !state.role) return;
        if (!data.order || asText(data.order.id) !== asText(id)) throw new Error("invalid_response");
        const index = state.orders.findIndex(order => order.id === id); if (index >= 0) state.orders[index] = data.order;
        renderList(); renderDetail(data); notice("");
        if (moveFocus) find("portalDetail").focus({ preventScroll:true });
      } catch (error) { if (token === state.loadToken && !authError(error)) { find("portalDetail").replaceChildren(empty("Szczegóły niedostępne", errorMessage(error))); notice(errorMessage(error), "error"); } }
      finally { if (token === state.loadToken) find("portalDetail").setAttribute("aria-busy", "false"); }
    }
    function privateFilePath(orderId, item) {
      if (!fileId(orderId) || !fileId(item.id)) return null;
      const expected = "/api/portal/orders/" + encodeURIComponent(orderId) + "/files/" + encodeURIComponent(item.id);
      // A DTO may include a download URL. Never follow a provider-supplied or external path.
      if (item.download_url && item.download_url !== expected) return null;
      return expected;
    }
    function renderDetail(data) {
      state.detail = data;
      const order = data.order, detail = find("portalDetail"); detail.replaceChildren();
      const vehicle = box("", ""); vehicle.classList.add("portal-vehicle-card"); vehicle.replaceChildren();
      const top = node("div", "portal-vehicle-top"), title = node("div"); title.append(node("p", "portal-eyebrow", ownerPage ? "Realizacja klienta" : "Twoja realizacja"), node("h2", "", order.title || "Pojazd w realizacji"), node("p", "portal-vehicle-id", [order.vin ? "VIN " + asText(order.vin) : "VIN do uzupełnienia", order.platform ? asText(order.platform).toUpperCase() : "", order.lot ? "LOT " + asText(order.lot) : ""].filter(Boolean).join(" · "))); top.append(title, status(order.status)); vehicle.append(top);
      const facts = node("dl", "portal-facts");
      for (const [label, value, note] of [["Ostatnia potwierdzona lokalizacja", order.location || "Oczekuje na aktualizację", ""], ["Przewidywany termin dotarcia", dateText(order.estimated_arrival_at), "Termin orientacyjny, może się zmienić"], ["Ostatnia aktualizacja", dateText(order.updated_at, true), ""], ["Statek", order.vessel || "Nie przypisano", ""], ["Kontener", order.container_number || "Nie przypisano", ""], ["Numer realizacji", order.id, ""]]) { const group = node("div"); const valueNode = node("dd", "", value); if (note) valueNode.append(node("small", "", note)); group.append(node("dt", "", label), valueNode); facts.append(group); } vehicle.append(facts);
      if (state.role === "owner") { const contact = node("div", "portal-assigned-client"); const profile = order.client_profile;
        contact.append(node("strong", "", "Przypisany klient"), node("p", "", [profile?.name, profile?.email, profile?.phone].filter(Boolean).join(" · ") || "Klient nie uzupełnił profilu kontaktowego.")); vehicle.append(contact); }
      detail.append(vehicle);
      const progress = box("Postęp importu", "Aktualny etap potwierdzony przez REXBID"); progress.classList.add("portal-stages"); const stages = node("ol", "portal-stage-list");
      const confirmed = new Set(Array.isArray(data.confirmed_stages) ? data.confirmed_stages : (Array.isArray(data.events) ? data.events : []).filter(event => event.visibility !== "internal" && ["created", "update", undefined].includes(event.event_type)).map(event => event.status));
      const current = confirmed.has(order.status) ? STAGES.findIndex(item => item[0] === order.status) : -1;
      STAGES.forEach(([key, label], index) => { const item = node("li"); item.dataset.stage = key; item.dataset.state = index === current ? "current" : confirmed.has(key) ? "done" : "upcoming"; if (index === current) item.setAttribute("aria-current", "step"); const dot = node("span", "portal-stage-dot", index + 1); dot.setAttribute("aria-hidden", "true"); item.append(dot, node("span", "", label)); stages.append(item); });
      progress.append(stages, node("p", "portal-stage-note", "Kolor oznacza etap zapisany w potwierdzonej historii. Pozostałe etapy oczekują na potwierdzenie; kolejność nie oznacza ich wykonania.")); detail.append(progress);
      const columns = node("div", "portal-two-columns"); columns.append(renderTimeline(order, data), renderFiles(order, data)); detail.append(columns, renderConversation(order, data));
      if (state.role === "owner" && ownerPage) detail.append(renderOwnerTools(order));
    }
    function mergeRecords(existing, incoming) {
      const result = existing.slice(), ids = new Set(existing.map(item => asText(item.id)));
      for (const item of incoming) if (!ids.has(asText(item.id))) { result.push(item); ids.add(asText(item.id)); }
      return result;
    }
    function historyPage(raw, count, offset, limit) {
      if (!raw || !Number.isSafeInteger(raw.limit) || raw.limit !== limit || !Number.isSafeInteger(raw.offset) || raw.offset !== offset
        || offset < 0 || offset > 10000 || typeof raw.has_more !== "boolean" || count > limit || (raw.has_more && count !== limit)) throw new Error("invalid_response");
      return { nextOffset:offset + limit, hasMore:raw.has_more };
    }
    function historyControls(section, order, data, key, renderRows) {
      const labels = {events:"Wczytaj starsze aktualizacje",messages:"Wczytaj starsze wiadomości",files:"Wczytaj starsze materiały"};
      section.dataset.portalHistory = key;
      const more = button(labels[key], true), result = node("p", "portal-form-feedback"); more.dataset.portalMore = key; result.setAttribute("aria-live", "polite");
      let records = mergeRecords([], Array.isArray(data[key]) ? data[key] : []), paging = {hasMore:false,nextOffset:records.length}, busy = false;
      const token = state.loadToken, current = () => !!state.role && state.selected === order.id && token === state.loadToken && state.detail === data;
      try { if (data.pagination?.[key] !== undefined) paging = historyPage(data.pagination[key], records.length, 0, key === "events" ? 100 : 50); }
      catch { feedback(result, "Nie udało się potwierdzić pełnej historii. Odśwież realizację.", "error"); }
      more.hidden = !paging.hasMore;
      more.addEventListener("click", async () => {
        if (busy || !paging.hasMore || !current()) return;
        if (paging.nextOffset > 10000) { more.hidden = true; feedback(result, "Starsze wpisy wymagają sprawdzenia przez REXBID. Skontaktuj się w sprawie pełnej historii.", "error"); return; }
        busy = true; more.disabled = true; feedback(result, "Pobieram starsze wpisy…"); const offset = paging.nextOffset;
        try {
          const page = await api("/api/portal/orders/" + encodeURIComponent(order.id) + "/" + key + "?limit=50&offset=" + offset);
          if (!current()) return;
          if (!Array.isArray(page[key]) || page[key].some(item => !item || typeof item !== "object" || !fileId(item.id))) throw new Error("invalid_response");
          const next = historyPage(page.pagination, page[key].length, offset, 50);
          records = mergeRecords(records, page[key].filter(item => state.role === "owner" || item.visibility !== "internal"));
          data[key] = records; data.pagination = {...data.pagination,[key]:{limit:50,offset,has_more:next.hasMore}}; paging = next;
          renderRows(records); if (key === "messages") section.dispatchEvent(new win.Event("portal:messages-updated")); more.hidden = !paging.hasMore; feedback(result, "Starsze wpisy zostały wczytane.");
        } catch (error) { if (current() && !authError(error)) feedback(result, error.message === "invalid_response" ? "Nie udało się potwierdzić starszych wpisów. Odśwież realizację." : errorMessage(error), "error"); }
        finally { busy = false; if (current()) more.disabled = false; }
      });
      section.append(more, result);
    }
    function fillTimeline(content, events) {
      content.replaceChildren(); const list = node("ol", "portal-timeline");
      const visible = (Array.isArray(events) ? events : []).filter(event => state.role === "owner" || event.visibility !== "internal");
      if (!visible.length) content.append(empty("Jeszcze bez aktualizacji", "Pierwsza informacja pojawi się po aktualizacji realizacji."));
      for (const event of visible.slice().sort((a, b) => asText(b.created_at).localeCompare(asText(a.created_at)))) {
        const item = node("li"); if (event.visibility === "internal" && state.role === "owner") item.append(node("span", "portal-internal", "Notatka wewnętrzna"));
        item.append(node("strong", "", event.status ? stageLabel(event.status) : "Aktualizacja realizacji")); if (event.message) item.append(node("p", "", event.message));
        if (event.location) item.append(node("small", "", "Lokalizacja: " + asText(event.location)));
        if (event.estimated_arrival_at) item.append(node("small", "", "Przewidywany termin: " + dateText(event.estimated_arrival_at)));
        const time = node("time", "", dateText(event.created_at, true)); if (event.created_at) time.dateTime = asText(event.created_at); item.append(time); list.append(item);
      } content.append(list);
    }
    function renderTimeline(order, data) {
      const section = box("Historia realizacji", "Aktualizacje od zespołu REXBID"), content = node("div"); fillTimeline(content, data.events); section.append(content);
      historyControls(section, order, data, "events", records => fillTimeline(content, records)); return section;
    }
    function fillFiles(content, order, files) {
      content.replaceChildren();
      const visible = (Array.isArray(files) ? files : []).filter(item => (state.role === "owner" || item.visibility !== "internal") && privateFilePath(order.id, item));
      if (!visible.length) content.append(empty("Materiały wkrótce", "Zdjęcia i dokumenty pojawią się po dodaniu ich przez REXBID."));
      const photos = visible.filter(item => ["image/jpeg", "image/png"].includes(item.content_type));
      if (photos.length) { const gallery = node("div", "portal-photo-grid"); for (const photo of photos) { const link = node("a", "portal-photo"); link.href = privateFilePath(order.id, photo); link.target = "_blank"; link.rel = "noopener"; const img = node("img"); img.src = link.getAttribute("href"); img.alt = asText(photo.filename) || "Zdjęcie pojazdu"; img.loading = "lazy"; link.append(img, node("span", "", photo.filename || "Zdjęcie")); gallery.append(link); } content.append(gallery); }
      const list = node("ul", "portal-files");
      for (const file of visible) { const item = node("li"), info = node("div", "portal-file-info"), link = node("a", "", file.filename || "Dokument"); link.href = privateFilePath(order.id, file); link.target = "_blank"; link.rel = "noopener"; const size = Number(file.size_bytes); const type = file.content_type === "application/pdf" ? "PDF" : file.content_type === "image/png" ? "PNG" : "JPG";
        info.append(link, node("small", "", [type, Number.isFinite(size) ? (size / 1024).toFixed(0) + " KB" : "", dateText(file.created_at)].filter(Boolean).join(" · "))); if (state.role === "owner") info.append(node("span", file.visibility === "internal" ? "portal-internal" : "portal-client-visible", file.visibility === "internal" ? "Tylko zespół REXBID" : "Widoczny dla klienta")); item.append(node("span", "portal-file-icon", type), info); list.append(item); } content.append(list);
    }
    function renderFiles(order, data) {
      const section = box("Zdjęcia i dokumenty", "Materiały przypisane do tej realizacji"), content = node("div"); fillFiles(content, order, data.files); section.append(content);
      historyControls(section, order, data, "files", records => fillFiles(content, order, records));
      if (state.role === "owner" && ownerPage && state.config.uploads_enabled === true) section.append(uploadForm(order));
      return section;
    }
    function fillMessages(list, messages) {
      list.replaceChildren();
      const visible = (Array.isArray(messages) ? messages : []).filter(message => state.role === "owner" || message.visibility !== "internal");
      if (!visible.length) list.append(empty("Masz pytanie o realizację?", "Napisz tutaj. Wiadomość zostanie przypisana do tego pojazdu."));
      for (const message of visible.slice().sort((a,b) => asText(a.created_at).localeCompare(asText(b.created_at)))) {
        // The stored sender comes from the server. Page/viewer role and message
        // contents must never reclassify an existing message.
        const author = ["client", "owner"].includes(message.author) ? message.author : "unknown";
        const label = author === "client" ? "Klient" : author === "owner" ? "REXBID" : "Nadawca nieustalony";
        const item = node("article", "portal-message"); item.dataset.author = author; item.setAttribute("aria-label", "Wiadomość: " + label);
        const top = node("div", "portal-message-top"), time = node("time", "", dateText(message.created_at, true));
        if (message.created_at) time.dateTime = asText(message.created_at);
        top.append(node("strong", "portal-message-author", label), time); item.append(top, node("p", "", message.text)); if (message.unread === true) { item.dataset.unread = "true"; item.append(node("span", "portal-message-unread", "Nieprzeczytana")); }
        if (message.visibility === "internal" && state.role === "owner") item.prepend(node("span", "portal-internal", "Notatka wewnętrzna"));
        list.append(item);
      }
    }
    function renderConversation(order, data) {
      const section = box("Rozmowa o pojeździe", "Wiadomości w panelu REXBID"), list = node("div", "portal-message-list"); list.setAttribute("aria-label", "Historia rozmowy"); fillMessages(list, data.messages); section.append(list);
      historyControls(section, order, data, "messages", records => fillMessages(list, records));
      const read = button("Oznacz wczytane wiadomości jako przeczytane", true), readResult = node("p", "portal-form-feedback"); read.dataset.portalRead = "true"; readResult.setAttribute("aria-live", "polite");
      let readBusy = false;
      const incoming = () => (Array.isArray(data.messages) ? data.messages : []).filter(message => message.unread === true && message.author === (state.role === "owner" ? "client" : "owner") && fileId(message.id));
      const updateReadButton = () => { read.hidden = incoming().length === 0; }; updateReadButton();
      section.addEventListener("portal:messages-updated", updateReadButton);
      read.addEventListener("click", async () => {
        if (readBusy || state.detail !== data || !state.role) return;
        const ids = incoming().map(message => message.id), token = state.loadToken; if (!ids.length) return;
        readBusy = true; read.disabled = true; feedback(readResult, "Zapisuję stan przeczytania…");
        try {
          for (let index = 0; index < ids.length; index += 50) {
            const batch = ids.slice(index, index + 50);
            const result = await api("/api/portal/orders/" + encodeURIComponent(order.id) + "/read", {method:"POST",body:JSON.stringify({message_ids:batch})});
            if (token !== state.loadToken || state.detail !== data || !state.role) return;
            if (!Array.isArray(result.read_message_ids) || result.read_message_ids.length !== batch.length || batch.some(id => !result.read_message_ids.includes(id)) || !Number.isSafeInteger(result.unread_count) || result.unread_count < 0) throw new Error("invalid_response");
            data.messages.forEach(message => { if (batch.includes(message.id)) message.unread = false; }); order.unread_count = result.unread_count;
            const row = state.orders.find(item => item.id === order.id); if (row) row.unread_count = result.unread_count;
            fillMessages(list, data.messages); renderList(); updateReadButton();
          }
          feedback(readResult, "Stan przeczytania został zapisany. Nowe wiadomości sprawdzisz po odświeżeniu.", "success");
        } catch (error) { if (token === state.loadToken && !authError(error)) feedback(readResult, errorMessage(error), "error"); }
        finally { readBusy = false; if (token === state.loadToken) read.disabled = false; }
      });
      section.append(read, readResult);
      const form = node("form", "portal-form"); form.dataset.portalForm = "message"; const input = field("Twoja wiadomość", "text", { type:"textarea", required:true, maxLength:2000 }); const result = node("p", "portal-form-feedback"); result.setAttribute("aria-live", "polite"); const actions = node("div", "portal-form-actions"), submit = button("Wyślij w panelu"); submit.type = "submit"; actions.append(node("p", "portal-form-note", "Wiadomość trafi do tej rozmowy. Panel nie wysyła jej automatycznie e-mailem."), submit);
      const sender = node("p", "portal-compose-sender", state.role === "owner" ? "Wysyłasz jako REXBID z konta właściciela." : "Wysyłasz jako Klient.");
      form.append(sender, input.wrapper, actions, result);
      let busy = false; form.addEventListener("submit", async event => { event.preventDefault(); if (busy || !form.checkValidity() || !input.input.value.trim()) { if (!busy) feedback(result, "Wpisz treść wiadomości.", "error"); return; } busy = true; submit.disabled = true; feedback(result, "Zapisuję wiadomość…");
        try { await api("/api/portal/orders/" + encodeURIComponent(order.id) + "/messages", { method:"POST", body:JSON.stringify({text:input.input.value.trim()}) }); if (state.selected === order.id) await selectOrder(order.id); notice("Wiadomość została zapisana w rozmowie.", "success"); }
        catch (error) { if (!authError(error)) feedback(result, errorMessage(error), "error"); } finally { busy = false; submit.disabled = false; }
      }); section.append(form); return section;
    }
    async function renderCreate() {
      const mount = find("portalCreateMount"); mount.replaceChildren();
      if (state.role === "client" && !ownerPage) { await renderProfile(mount); return; }
      if (state.role !== "owner" || !ownerPage) return;
      let clientHasMore = false, clientOffset = 0;
      try { const data = await api("/api/portal/clients"); state.clients = Array.isArray(data.clients) ? data.clients : []; clientHasMore = data.pagination?.has_more === true; clientOffset = Number(data.pagination?.offset || 0) + Number(data.pagination?.limit || state.clients.length); }
      catch (error) { if (!authError(error)) { mount.append(empty("Lista klientów niedostępna", errorMessage(error))); } return; }
      const details = node("details", "portal-create"); details.append(node("summary", "", "＋ Dodaj realizację klienta")); const form = node("form", "portal-form"); form.dataset.portalForm = "create";
      const client = field("Zarejestrowany klient", "client_user_id", {required:true,options:[["", "Wybierz konto klienta"], ...state.clients.map(client => [asText(client.id), clientLabel(client)])]}), title = field("Pojazd", "title", {required:true,maxLength:160}), vin = field("VIN (wymagany, jeśli brak LOT)", "vin", {maxLength:17}), lot = field("LOT (wymagany, jeśli brak VIN)", "lot", {maxLength:32}), platform = field("Dom aukcyjny dla LOT", "platform", {options:[["", "Nie wybrano"],["copart","Copart"],["iaai","IAAI"]]});
      title.input.placeholder = "Marka, model, rok"; vin.input.placeholder = "17 znaków VIN"; lot.input.placeholder = "Numer LOT";
      const selectedClient = node("div", "portal-client-preview"); selectedClient.setAttribute("aria-live", "polite");
      const previewClient = () => { selectedClient.replaceChildren(); const selected = state.clients.find(item => item.id === client.input.value); if (!selected) return;
        selectedClient.append(node("strong", "", selected.profile?.name || "Profil klienta nieuzupełniony"), node("p", "", [selected.profile?.email, selected.profile?.phone].filter(Boolean).join(" · ") || "Klient nie podał danych kontaktowych."));
        if (selected.account_type === "owner") selectedClient.append(node("p", "portal-internal", "Wybrane jest konto właściciela REXBID."));
        const identity = node("details"); identity.append(node("summary", "", "Identyfikator konta i data rejestracji"), node("small", "", asText(selected.id) + " · " + dateText(selected.created_at, true))); selectedClient.append(identity);
      }; client.input.addEventListener("change", previewClient); const submit = button("Utwórz realizację"); submit.type = "submit"; const result = node("p", "portal-form-feedback"); result.setAttribute("aria-live", "polite"); const moreClients = button("Wczytaj kolejnych klientów", true); moreClients.hidden = !clientHasMore; let clientsBusy = false;
      moreClients.addEventListener("click", async () => { if (clientsBusy) return; clientsBusy = true; moreClients.disabled = true;
        try { const data = await api("/api/portal/clients?limit=50&offset=" + clientOffset); const incoming = Array.isArray(data.clients) ? data.clients : []; for (const entry of incoming) { if (state.clients.some(item => item.id === entry.id)) continue; state.clients.push(entry); const option = node("option", "", clientLabel(entry)); option.value = asText(entry.id); client.input.append(option); } clientOffset += 50; clientHasMore = data.pagination?.has_more === true; moreClients.hidden = !clientHasMore; feedback(result, "Lista klientów została uzupełniona."); }
        catch (error) { if (!authError(error)) feedback(result, errorMessage(error), "error"); } finally { clientsBusy = false; moreClients.disabled = false; }
      });
      form.append(client.wrapper, selectedClient, moreClients, title.wrapper, vin.wrapper, lot.wrapper, platform.wrapper, node("p", "portal-form-note", "Wybierz zweryfikowanego klienta i sprawdź dane profilu. Podaj VIN lub numer LOT z domem aukcyjnym. Wystarczy jeden z tych identyfikatorów."), submit, result); let busy = false;
      form.addEventListener("submit", async event => { event.preventDefault(); if (busy || !form.checkValidity()) return; if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(client.input.value.trim())) { feedback(result, "Wybierz istniejące konto klienta.", "error"); client.input.focus(); return; }
        if (!title.input.value.trim() || (!vin.input.value.trim() && !lot.input.value.trim()) || (vin.input.value.trim() && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin.input.value.trim())) || (lot.input.value.trim() && !/^[A-Z0-9-]{1,32}$/i.test(lot.input.value.trim())) || Boolean(lot.input.value.trim()) !== Boolean(platform.input.value)) { feedback(result, "Podaj nazwę pojazdu oraz prawidłowy VIN lub LOT z domem aukcyjnym.", "error"); return; }
        busy = true; submit.disabled = true; feedback(result, "Tworzę realizację…");
        try { const data = await api("/api/portal/orders", { method:"POST", body:JSON.stringify({client_user_id:client.input.value.trim(),title:title.input.value.trim(), ...(vin.input.value.trim() ? {vin:vin.input.value.trim().toUpperCase()} : {}), ...(lot.input.value.trim() ? {lot:lot.input.value.trim().toUpperCase()} : {}), ...(platform.input.value ? {platform:platform.input.value} : {})}) }); state.offset = 0; await loadOrders({preserveSelection:false}); if (data.order?.id) await selectOrder(data.order.id); form.reset(); previewClient(); details.open = false; notice("Realizacja została utworzona i przypisana do konta klienta.", "success"); }
        catch (error) { if (!authError(error)) feedback(result, errorMessage(error), "error"); } finally { busy = false; submit.disabled = false; }
      }); details.append(form); mount.append(details);
    }
    async function renderProfile(mount) {
      let profile = {};
      try { const data = await api("/api/portal/profile"); profile = data.profile || {}; }
      catch (error) { if (!authError(error)) mount.append(empty("Profil kontaktowy niedostępny", "Możesz korzystać z rozmowy przy pojeździe. Dane kontaktowe uzupełnisz później.")); return; }
      const details = node("details", "portal-create"); details.append(node("summary", "", "Twoje dane kontaktowe"));
      const form = node("form", "portal-form"); form.dataset.portalForm = "profile";
      const name = field("Imię i nazwisko", "name", {value:profile.name || "",maxLength:80}), email = field("E-mail do kontaktu", "email", {type:"email",value:profile.email || "",maxLength:254}), phone = field("Telefon (opcjonalnie)", "phone", {type:"tel",value:profile.phone || "",maxLength:40});
      name.input.autocomplete = "name"; email.input.autocomplete = "email"; phone.input.autocomplete = "tel";
      const result = node("p", "portal-form-feedback"); result.setAttribute("aria-live", "polite"); const submit = button("Zapisz dane", true); submit.type = "submit";
      form.append(name.wrapper, email.wrapper, phone.wrapper, node("p", "portal-form-note", "Dane kontaktowe pomagają REXBID przypisać i obsłużyć realizację. Zmiana tutaj nie zmienia adresu logowania."), submit, result); let busy = false;
      form.addEventListener("submit", async event => { event.preventDefault(); if (busy || !form.checkValidity()) return; busy = true; submit.disabled = true; feedback(result, "Zapisuję profil…");
        try { await api("/api/portal/profile", {method:"POST",body:JSON.stringify({name:name.input.value.trim(),email:email.input.value.trim(),phone:phone.input.value.trim()})}); feedback(result, "Dane kontaktowe zostały zapisane.", "success"); }
        catch (error) { if (!authError(error)) feedback(result, errorMessage(error), "error"); } finally { busy = false; submit.disabled = false; }
      }); details.append(form); mount.append(details);
    }
    function renderOwnerTools(order) {
      const section = box("Aktualizacja realizacji", "Narzędzia właściciela"); section.classList.add("portal-owner-tools"); section.append(node("p", "portal-owner-note", "Podawaj tylko potwierdzone informacje. Termin dotarcia klient zawsze widzi jako orientacyjny."));
      const form = node("form", "portal-form"); form.dataset.portalForm = "update"; const grid = node("div", "portal-form-grid");
      const fields = [field("Etap importu", "status", {value:order.status,options:STAGES}), field("Potwierdzona lokalizacja", "location", {value:order.location || ""}), field("Przewidywany termin dotarcia", "estimated_arrival_at", {type:"date",value:asText(order.estimated_arrival_at).slice(0,10)}), field("Statek", "vessel", {value:order.vessel || "",maxLength:120}), field("Numer kontenera", "container_number", {value:order.container_number || "",maxLength:50}), field("Widoczność notatki", "event_visibility", {options:[["client", "Dla klienta"],["internal", "Tylko wewnętrznie"]]})]; fields.forEach(item => grid.append(item.wrapper));
      const message = field("Notatka o aktualizacji", "event_message", {type:"textarea",maxLength:2000}); const result = node("p", "portal-form-feedback"); result.setAttribute("aria-live", "polite"); const actions = node("div", "portal-form-actions"), submit = button("Zapisz aktualizację"), reload = button("Odśwież dane", true); submit.type = "submit"; reload.hidden = true; reload.addEventListener("click", () => selectOrder(order.id)); actions.append(reload, submit); form.append(grid, message.wrapper, node("p", "portal-form-note", "Notatka wewnętrzna jest ukryta przed klientem. Główny etap, lokalizacja, statek i termin są widoczne w jego realizacji."), actions, result); let busy = false, conflict = false;
      const visibility = fields.find(item => item.input.name === "event_visibility").input;
      visibility.addEventListener("change", () => { const internal = visibility.value === "internal"; fields.forEach(item => { if (item.input !== visibility) item.input.disabled = internal; }); submit.textContent = internal ? "Zapisz notatkę wewnętrzną" : "Zapisz aktualizację"; message.input.required = internal; });
      form.addEventListener("submit", async event => { event.preventDefault(); if (busy || conflict || !form.checkValidity()) return; busy = true; submit.disabled = true; feedback(result, "Zapisuję aktualizację…"); const body = {expected_version:order.version}; fields.forEach(item => { if (!item.input.disabled) body[item.input.name] = item.input.name === "estimated_arrival_at" ? (item.input.value ? item.input.value + "T12:00:00.000Z" : null) : item.input.value || null; }); body.event_message = message.input.value.trim() || null;
        try { await api("/api/portal/orders/" + encodeURIComponent(order.id), {method:"PATCH",body:JSON.stringify(body)}); if (state.selected === order.id) await selectOrder(order.id); notice("Aktualizacja została zapisana.", "success"); }
        catch (error) { if (!authError(error)) { feedback(result, errorMessage(error), "error"); if (error.status === 409) { conflict = true; reload.hidden = false; reload.focus(); } } } finally { busy = false; submit.disabled = conflict; }
      }); section.append(form, replyDraftForm(order)); return section;
    }
    function replyDraftForm(order) {
      const section = node("section", "portal-upload-form"); section.append(node("h3", "", "Przygotuj odpowiedź")); const form = node("form", "portal-form"); form.dataset.portalForm = "draft"; const kind = field("Rodzaj odpowiedzi", "kind", {options:[["status_update","Aktualny etap"],["documents_ready","Dodane dokumenty"],["delay","Zmiana terminu"],["payment_received","Potwierdzenie płatności"]]}); const submit = button("Przygotuj szkic", true); submit.type = "submit"; const result = node("p", "portal-form-feedback"); result.setAttribute("aria-live", "polite"); const output = node("div", "portal-draft-output"); output.hidden = true; let busy = false;
      form.append(kind.wrapper, submit, result); form.addEventListener("submit", async event => { event.preventDefault(); if (busy) return; busy = true; submit.disabled = true; output.hidden = true; feedback(result, "Przygotowuję szkic…");
        try { const data = await api("/api/portal/orders/" + encodeURIComponent(order.id) + "/reply-draft?kind=" + encodeURIComponent(kind.input.value)); if (!data.draft?.body) throw new Error("invalid_response"); output.replaceChildren(node("strong", "", data.draft.subject || "Odpowiedź REXBID"), node("p", "", data.draft.body)); for (const warning of Array.isArray(data.draft.warnings) ? data.draft.warnings : []) output.append(node("small", "", warning)); if (data.source_complete === false) output.append(node("small", "", "Szkic korzysta z części dostępnej historii; sprawdź starsze wpisy.")); const use = button("Wstaw do wiadomości", true); use.addEventListener("click", () => { const input = find("portalDetail").querySelector('[data-portal-form="message"] textarea'); if (input) { input.value = asText(data.draft.body); input.focus(); feedback(result, "Szkic wstawiono do pola wiadomości. Sprawdź treść i wyślij, gdy będzie gotowa."); } }); output.append(use, node("small", "", "To tylko szkic do sprawdzenia. Nic nie zostało wysłane klientowi.")); output.hidden = false; feedback(result, "Szkic gotowy do sprawdzenia."); }
        catch (error) { if (!authError(error)) feedback(result, errorMessage(error), "error"); } finally { busy = false; submit.disabled = false; }
      }); section.append(form, output); return section;
    }
    function uploadForm(order) {
      const form = node("form", "portal-form portal-upload-form"); form.dataset.portalForm = "upload"; const file = field("Dodaj zdjęcie lub dokument", "file", {type:"file",required:true}); file.input.accept = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"; const visibility = field("Widoczność materiału", "visibility", {options:[["client","Dla klienta"],["internal","Tylko wewnętrznie"]]}); const result = node("p", "portal-form-feedback"); result.setAttribute("aria-live", "polite"); const submit = button("Dodaj materiał", true); submit.type = "submit"; form.append(file.wrapper, visibility.wrapper, node("p", "portal-form-note", "PDF, JPG lub PNG. Maksymalnie 8 MiB. Materiał udostępniamy w ramach tej realizacji."), submit, result); let busy = false;
      form.addEventListener("submit", async event => { event.preventDefault(); if (busy) return; const selected = file.input.files?.[0]; if (!selected) { feedback(result, "Wybierz plik.", "error"); return; } if (!["application/pdf","image/jpeg","image/png"].includes(selected.type) || selected.size > 8 * 1024 * 1024 || selected.size < 1) { feedback(result, "Wybierz PDF, JPG lub PNG o rozmiarze do 8 MiB.", "error"); return; } busy = true; submit.disabled = true; feedback(result, "Dodaję materiał…");
        try { await api("/api/portal/orders/" + encodeURIComponent(order.id) + "/files", {method:"POST",headers:{"Content-Type":selected.type,"X-File-Name":encodeURIComponent(selected.name),"X-Visibility":visibility.input.value},body:selected}); if (state.selected === order.id) await selectOrder(order.id); notice("Materiał został dodany do realizacji.", "success"); }
        catch (error) { if (!authError(error)) feedback(result, errorMessage(error), "error"); } finally { busy = false; submit.disabled = false; }
      }); return form;
    }
    find("portalRefresh").addEventListener("click", () => loadOrders()); find("portalNext").addEventListener("click", () => { if (state.listBusy) return; state.offset += state.limit; loadOrders({preserveSelection:false}); }); find("portalPrevious").addEventListener("click", () => { if (state.listBusy) return; state.offset = Math.max(0, state.offset - state.limit); loadOrders({preserveSelection:false}); });
    // Do not retain private content after browser back/forward cache restores a page.
    win.addEventListener("pagehide", () => { state.loadToken++; gate("Sprawdzam dostęp", "Odśwież panel, aby ponownie sprawdzić dostęp do realizacji."); });
    win.addEventListener("pageshow", event => { if (event.persisted) win.location.reload(); });
    win.addEventListener("rexbid:logout-start", () => gate("Zaloguj się do swojego konta", "Dostęp do panelu został zamknięty. Zaloguj się ponownie, aby sprawdzić realizacje.", true));
    doc.addEventListener("rexbid:owner-mfa-verified", () => win.location.reload());
    return (async () => {
      try {
        state.config = await api("/api/portal/config");
        if (state.config.enabled !== true) { gate("Panel przygotowywany do uruchomienia", "Obsługa importów nie jest jeszcze uruchomiona w tym środowisku. Skontaktuj się z REXBID w sprawie swojej realizacji."); return; }
        const session = await api("/api/portal/me");
        if (!["owner","client"].includes(session.role)) { gate("Dostęp niedostępny", "Nie udało się potwierdzić uprawnień tego konta."); return; }
        if (ownerPage && session.role !== "owner") { gate("Panel właściciela", "Ten panel jest dostępny dla właściciela REXBID. Swoje realizacje znajdziesz w panelu Moje importy."); const link = node("a", "portal-button", "Przejdź do moich importów"); link.href = "/panel.html"; link.dataset.portalGateAction = "client"; find("portalGate").append(link); return; }
        state.role = session.role; renderSessionRole(); find("portalGate").hidden = true; find("portalWorkspace").hidden = false; find("portalOwnerLink").hidden = state.role !== "owner" || ownerPage; await renderCreate(); if (state.role) await loadOrders({preserveSelection:false});
      } catch (error) { if (!authError(error)) gate("Panel chwilowo niedostępny", "Nie udało się potwierdzić dostępu. Spróbuj ponownie później."); }
    })();
  }
  root.RexBidClientPortal = {mount, STAGES, ready:null};
  if (typeof document !== "undefined") { const start = () => { root.RexBidClientPortal.ready = mount(document, root); }; if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once:true}); else start(); }
})(typeof window !== "undefined" ? window : globalThis);
