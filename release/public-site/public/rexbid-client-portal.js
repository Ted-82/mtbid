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
    const rawLinkedOrder = new win.URLSearchParams(win.location.search).get('order');
    const linkedOrder = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(rawLinkedOrder || '') ? rawLinkedOrder : null;
    let linkedOrderPending = rawLinkedOrder !== null;
    if (linkedOrder) {
      const returnPath=(ownerPage?'/administracja.html':'/panel.html')+'?order='+encodeURIComponent(linkedOrder)+'#rozmowa';
      find('portalLogin').href='/logowanie.html?return_to='+encodeURIComponent(returnPath);
    }
    const traffic = ownerPage ? find("portalTraffic") : null;
    const trafficResult = ownerPage ? find("portalTrafficResult") : null;
    let trafficRequest = 0;
    const state = { role:null, config:{}, clients:[], orders:[], offset:0, limit:20, hasMore:false, selected:null, detail:null, loadToken:0, accessEpoch:0, listBusy:false, query:"", kind:"all", stage:"", searchRevision:0, reloadQueued:false, summary:null, total:0, searchReady:true, registerView:false };
    const registrationTool=ownerPage?find('ownerRegistrations'):null;
    let registrationRequest=0;
    async function loadRegistrations(offset=0,append=false){
      if(!registrationTool||state.role!=='owner'||!state.config.registrations_enabled)return;
      const epoch=++registrationRequest,host=find('ownerRegistrationsResult');
      if(!append)host.textContent='Pobieram rejestracje…';
      try{const data=await api('/api/portal/registrations?limit=20&offset='+offset);if(epoch!==registrationRequest||state.role!=='owner')return;
        if(!append){host.replaceChildren(node('p','portal-form-note',data.coverage));
          const known=node('div');known.append(node('h3','','Potwierdzone konta klientów'));
          for(const a of data.accounts||[])known.append(node('p','', (a.email||'Adres nie został jeszcze odczytany po zweryfikowanym logowaniu')+' · Konto od '+dateText(a.created_at,true)+' · ID '+a.id));
          host.append(known,node('h3','','Zgłoszenia rejestracji'));}
        for(const r of data.registrations||[]){const item=node('article','portal-event');item.append(node('strong','',r.email),node('p','',r.status==='confirmed'?'Potwierdzone konto':'Zgłoszenie — e-mail niepotwierdzony'),node('small','',dateText(r.requested_at||r.confirmed_at,true)));host.append(item);}
        if(!append&&!(data.registrations||[]).length)host.append(node('p','','Brak zarejestrowanych zgłoszeń w tym mechanizmie.'));
        host.querySelector('[data-registration-more]')?.remove();if(data.pagination?.has_more){const more=button('Kolejne rejestracje',true);more.dataset.registrationMore='1';more.addEventListener('click',()=>loadRegistrations(offset+20,true));host.append(more);}
      }catch(error){if(!authError(error))host.textContent=errorMessage(error);}
    }
    if(registrationTool){registrationTool.addEventListener('toggle',()=>{if(registrationTool.open)loadRegistrations();});find('ownerRegistrationsRefresh').addEventListener('click',()=>loadRegistrations());}
    const sessionBanner = node("section", "portal-session");
    sessionBanner.id = "portalSessionRole"; sessionBanner.hidden = true; sessionBanner.setAttribute("aria-label", "Bieżąca sesja konta");
    find("portalNotice").before(sessionBanner);
    function renderSessionRole() {
      const syncTool=find('ownerSyncHealth');
      if(syncTool){syncTool.hidden=state.role!=='owner';if(state.role!=='owner'){syncTool.open=false;find('ownerSyncResult').replaceChildren();}}
      sessionBanner.replaceChildren(); sessionBanner.hidden = !["owner", "client"].includes(state.role);
      if (sessionBanner.hidden) { delete sessionBanner.dataset.role; return; }
      sessionBanner.dataset.role = state.role;
      sessionBanner.append(node("strong", "portal-session-badge", state.role === "owner" ? "Sesja właściciela REXBID" : "Sesja klienta"));
      sessionBanner.append(node("p", "portal-session-note", state.role === "owner"
        ? "Korzystasz z uprawnień właściciela. Aby sprawdzić widok klienta, wyloguj się i zaloguj na konto klienta."
        : "Widzisz realizacje przypisane do Twojego konta klienta."));
    }
    async function loadSyncHealth(){
      if(state.role!=='owner')return;
      const host=find('ownerSyncResult');
      if(!host)return;host.textContent='Sprawdzam synchronizację…';
      try{
        const data=await api('/api/portal/sync-health');
        if(state.role!=='owner')return;
        const s=data.sync;
        host.replaceChildren(node('strong','',s.status),node('p','','Oczekujące weryfikacje: '+s.pending));
        for(const q of s.queues)host.append(node('p','',q.platform.toUpperCase()+': '+q.pending+' · Najstarszy oczekujący sygnał źródła: '+dateText(q.oldest,true)));
        for(const count of s.stored_active_with_date||[])host.append(node('p','',count.platform.toUpperCase()+' — aktywne wpisy z terminem w bazie: '+count.listings));
        for(const queue of s.other_queues||[])if(queue.family!=='Ponowne wystawienia')host.append(node('p','',queue.family+' · '+queue.status+': '+queue.jobs));
        if(s.last_generation)host.append(node('p','','Ostatnia pełna publikacja: paczka '+s.last_generation.generation_id+' · '+dateText(s.last_generation.updated_at,true)+' · Od odebrania tego pliku: '+s.delay_minutes+' min'));
        if(s.publication_pending&&s.received_generation)host.append(node('p','','Nowsza paczka '+s.received_generation.generation_id+' jest odebrana, lecz jeszcze nie została w pełni opublikowana. Stan: '+s.received_generation.status+'.'));
        if(s.quota)host.append(node('p','','Pozostała pula API przy odczycie: '+s.quota.quota_left+' / '+s.quota.quota_limit+' · Odczyt: '+dateText(s.quota.quota_checked_at,true)));
        for(const b of s.budgets)host.append(node('p','',b.budget_key.startsWith('day:')?'Dziś: '+b.consumed+' / '+b.limit_count:'Miesiąc: '+b.consumed+' / '+b.limit_count));
        if(s.resource_policy?.catchup)host.append(node('p','','Przydział nadrabiania do odnowienia puli: '+s.resource_policy.catchup.remaining+' zapytań. Wykorzystanie nie zeruje się o północy.'));
        if(s.cost_policy)host.append(node('p','','Zatwierdzony dodatkowy budżet miesięczny: do '+s.cost_policy.monthlyTotalUsd+' USD, w tym do '+s.cost_policy.d1WriteUsd+' USD na zapisy D1. To budżet, nie kwota naliczonej faktury.'));
        if(s.observation){
          const o=s.observation;
          if(Number.isFinite(o.net_queue_per_hour))host.append(node('p','','Zmiana kolejki na godzinę: '+Math.round(o.net_queue_per_hour)+' · Pomiar: '+dateText(o.at,true)));
          host.append(node('p','',Number.isFinite(o.estimate_hours)?'Szacowany czas nadrobienia przy zmierzonym tempie: '+o.estimate_hours.toFixed(1)+' godz.':'Czas nadrobienia nieustalony — potrzeba dodatniego tempa nadganiania.'));
        }
        host.append(node('small','',s.completeness));
      }catch(error){if(!authError(error)&&state.role==='owner')host.textContent=errorMessage(error);}
    }
    find('ownerSyncHealth')?.addEventListener('toggle',()=>{if(find('ownerSyncHealth').open)loadSyncHealth();});
    find('ownerSyncRefresh')?.addEventListener('click',loadSyncHealth);
    const notice = (text, tone = "info") => { const box = find("portalNotice"); box.textContent = text; box.dataset.tone = tone; box.hidden = !text; };
    const feedback = (host, text, tone = "info") => { host.textContent = text; host.dataset.tone = tone; if (tone === "error") host.setAttribute("role", "alert"); else host.setAttribute("role", "status"); };
    function gate(title, message, login = false) {
      // Invalidate every pending API response, including requests started before
      // another request expired the session or the page entered the back cache.
      find('ownerRegisterTools')?.setAttribute('hidden',''); find('ownerRegisterPanel')?.setAttribute('hidden','');find('ownerRegisterTable')?.replaceChildren();
      state.searchRevision++; state.summary=null;
      state.accessEpoch++; state.role = null; state.orders = []; state.clients = []; state.selected = null; state.detail = null; state.loadToken++; state.hasMore = false; state.offset = 0;
      registrationRequest++;if(registrationTool){registrationTool.open=false;registrationTool.hidden=true;find('ownerRegistrationsResult').replaceChildren();}
      renderSessionRole();
      find("portalWorkspace").hidden = true; find("portalOwnerLink").hidden = true;
      if (traffic) { trafficRequest++; traffic.open = false; trafficResult.replaceChildren(); }
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
    if (traffic) {
      const channels = {direct:"Bezpośrednie / brak informacji",google:"Google",bing:"Bing",duckduckgo:"DuckDuckGo",
        facebook:"Facebook",instagram:"Instagram",tiktok:"TikTok",youtube:"YouTube",other:"Inne strony"};
      const countries = new Intl.DisplayNames(["pl"], {type:"region"});
      const count = new Intl.NumberFormat("pl-PL");
      const shortDay = new Intl.DateTimeFormat("pl-PL", {timeZone:"Europe/Warsaw",day:"2-digit",month:"short"});
      const forms = new Intl.PluralRules("pl");
      const visitsText = n => count.format(n) + ({one:" wizyta",few:" wizyty"}[forms.select(n)] || " wizyt");
      const viewsText = n => count.format(n) + ({one:" odsłona",few:" odsłony"}[forms.select(n)] || " odsłon");
      function chart(daily, from, through) {
        const figure = node("figure", "portal-traffic-chart");
        figure.append(node("figcaption", "", "Wizyty dzień po dniu · " + daily.length + " dni"));
        const list = node("ol", "portal-traffic-bars");
        list.setAttribute("aria-label", "Dzienna liczba wizyt");
        if (daily.length > 7) { list.classList.add("portal-traffic-bars-long"); list.tabIndex = 0; }
        const max = Math.max(1, ...daily.map(row => row.visits));
        for (const {day,visits} of daily) {
          const row = node("li");
          if (day >= from && day <= through) row.dataset.inRange = "true";
          const label = node("time", "", shortDay.format(new Date(day + "T12:00:00Z")));
          label.dateTime = day;
          const bar = node("meter"); bar.min = 0; bar.max = max; bar.value = visits;
          bar.setAttribute("aria-hidden","true");
          const value = node("span", "", count.format(visits));
          value.setAttribute("aria-label",visitsText(visits));
          row.append(label,bar,value);list.append(row);
        }
        figure.append(list);
        return figure;
      }
      function rows(title, items, label) {
        const section = node("section", "portal-traffic-breakdown");
        section.append(node("h3", "", title));
        if (!items.length) { section.append(node("p", "", "Brak danych w tym okresie.")); return section; }
        const list = node("dl");
        for (const {label:code,n} of items) list.append(node("dt", "", label(code)),node("dd", "", count.format(n)));
        section.append(list); return section;
      }
      async function loadTraffic() {
        if (!traffic.open || state.role !== "owner") return;
        const requestId = ++trafficRequest;
        trafficResult.replaceChildren(node("p", "", "Wczytuję statystyki…"));
        try {
          const data = await api("/api/portal/admin/traffic?days=" + find("portalTrafficDays").value);
          if (requestId !== trafficRequest || !traffic.open) return;
          const totals = node("p", "portal-traffic-totals");
          totals.append(node("strong", "", visitsText(data.visits)), node("strong", "", viewsText(data.views)));
          const breakdown = node("div", "portal-traffic-grid");
          breakdown.append(rows("Skąd trafiają odwiedzający", data.sources, code => channels[code] || "Inne strony"),
            rows("Kraje odwiedzających", data.countries, code => code === "ZZ" ? "Nieustalony" : countries.of(code)));
          const cityCounts = (data.cities || []).map(({city,country,source,n}) => ({
            label: `${city} (${countries.of(country)}) · ${channels[source] || "Inne strony"}`, n
          }));
          const unknownCityCount = data.visits - cityCounts.reduce((sum, item) => sum + item.n, 0);
          if (unknownCityCount > 0) cityCounts.push({label:"Brak danych o mieście", n:unknownCityCount});
          const cities = rows("Miasta i źródła wejść", cityCounts, label => label);
          trafficResult.replaceChildren(totals,node("p", "portal-traffic-note", data.from === data.through ? dateText(data.from) : dateText(data.from) + " – " + dateText(data.through)),breakdown,cities);
          if (Array.isArray(data.daily) && data.daily.length) trafficResult.insertBefore(chart(data.daily,data.from,data.through),breakdown);
        } catch (error) {
          if (requestId !== trafficRequest || authError(error)) return;
          trafficResult.replaceChildren(node("p", "", "Statystyki są chwilowo niedostępne. Spróbuj odświeżyć."));
        }
      }
      traffic.addEventListener("toggle", () => { if (traffic.open) loadTraffic(); });
      find("portalTrafficDays").addEventListener("change",loadTraffic);
      find("portalTrafficRefresh").addEventListener("click",loadTraffic);
    }
    function status(value) { const badge = node("span", "portal-status", stageLabel(value)); badge.dataset.complete = String(value === "delivered"); badge.dataset.statusStage=asText(value); return badge; }
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
    const clientLabel = client => (client.account_type === "owner" ? "Konto właściciela REXBID · " : "") + ([client.profile?.name, client.profile?.email || client.verified_email, client.profile?.phone].filter(Boolean).join(" · ") || "Profil nieuzupełniony · " + dateText(client.created_at) + " · " + asText(client.id).slice(-8));
    function summarize() {
      const summary = find("portalSummary"); summary.replaceChildren();
      if(ownerPage&&state.config.order_register_enabled&&state.summary){
        for(const[label,value,note]of [["Sprawy rzeczywiste",state.summary.real_cases,"Wszystkie strony, bez testów"],["Zakupione auta",state.summary.purchased,"Z potwierdzoną datą zakupu"],["W realizacji",state.summary.ongoing,"Sprawy rzeczywiste, przed wydaniem"],["Wydane klientom",state.summary.delivered,"Zakończone, z datą wydania"]]){const card=node('div','portal-stat');card.append(node('span','portal-stat-label',label),node('strong','',value),node('small','',note));summary.append(card);}return;
      }
      const complete = state.orders.filter(order => order.status === "delivered").length;
      for (const [label, value, note] of [[ownerPage ? "Importy na tej stronie" : "Twoje importy na tej stronie", state.orders.length, state.hasMore ? "Dostępne są kolejne realizacje" : "Lista przypisana do konta"], ["W realizacji", state.orders.length - complete, "Etap aktualizuje zespół REXBID"], ["Zakończone", complete, "Pojazd odebrany"], ["Nowe wiadomości", state.orders.reduce((sum, order) => sum + unreadCount(order), 0), "Nieprzeczytane w realizacjach na tej stronie"]]) { const card = node("div", "portal-stat"); card.append(node("span", "portal-stat-label", label), node("strong", "", value), node("small", "", note)); summary.append(card); }
    }
    function renderList() {
      const list = find("portalOrders"); list.replaceChildren(); summarize();
      if (!state.orders.length) list.append(empty("Brak przypisanych importów", state.role === "owner" ? (state.query||state.kind!=="all"||state.stage?"Zmień lub wyczyść kryteria wyszukiwania.":"Utwórz realizację dla istniejącego konta klienta.") : "Gdy REXBID przypisze realizację do Twojego konta, zobaczysz tutaj jej postęp."));
      for (const order of state.orders) {
        const item = node("button", "portal-order-button"); item.type = "button"; item.dataset.orderId = asText(order.id); item.setAttribute("aria-pressed", String(order.id === state.selected));
        if(ownerPage&&order.register){
          const head=node('span','portal-order-head');head.append(node('span','portal-case-number',order.register.reference));if(order.register.is_test)head.append(node('span','portal-test-badge','TEST'));item.append(head,node('strong','portal-customer-name',order.client_profile?.name||order.client_profile?.email||order.verified_email||'Dane klienta do uzupełnienia'));
          const email=order.client_profile?.email||order.verified_email;if(email&&order.client_profile?.name&&email!==order.client_profile.name)item.append(node('span','portal-order-client',email));
          item.append(node('strong','portal-car-name',order.register.vehicle_label||(!order.register.is_test?order.title:'Samochód do uzupełnienia')),node('span','portal-order-meta',order.vin?'VIN '+order.vin:'VIN do uzupełnienia'),node('span','portal-order-meta',[order.platform?.toUpperCase(),order.lot?'LOT '+order.lot:null].filter(Boolean).join(' · ')),status(order.status));
        }else item.append(node("strong", "", order.title || "Pojazd w realizacji"), node("span", "portal-order-meta", [order.platform ? asText(order.platform).toUpperCase() : "", order.lot ? "LOT " + asText(order.lot) : "", order.vin || ""].filter(Boolean).join(" · ")), status(order.status));
        if (state.role === "owner" && !order.register) item.append(node("span", "portal-order-client", order.client_profile?.name || order.client_profile?.email || "Dane klienta nieuzupełnione"));
        item.append(node("span", "portal-order-location", order.location || "Lokalizacja do potwierdzenia"), node("span", "portal-order-updated", "Aktualizacja: " + dateText(order.updated_at, true)));
        if (order.estimated_arrival_at) item.append(node("span", "portal-order-eta", "ETA orientacyjny: " + dateText(order.estimated_arrival_at)));
        if (unreadCount(order)) { const unread = node("span", "portal-unread-badge", "Nowe wiadomości: " + unreadCount(order)); unread.dataset.portalUnread = asText(order.id); item.append(unread); }
        item.addEventListener("click", () => selectOrder(order.id, true)); list.append(item);
      }
      find("portalPrevious").hidden = state.offset === 0; find("portalNext").hidden = !state.hasMore;
      if(ownerPage&&state.config.order_register_enabled)renderRegister();
    }
    async function loadOrders({ preserveSelection = true } = {}) {
      if (state.listBusy || !state.role) return;
      const revision=state.searchRevision; state.listBusy = true; find("portalRefresh").disabled = true; find("portalNext").disabled = true; find("portalPrevious").disabled = true;
      notice("Pobieram aktualne realizacje…");
      try {
        const extra=ownerPage&&state.config.order_register_enabled?'&q='+encodeURIComponent(state.query)+'&kind='+encodeURIComponent(state.kind)+'&status='+encodeURIComponent(state.stage):'';
        const data = await api("/api/portal/orders?limit=" + state.limit + "&offset=" + state.offset+extra);
        if(revision!==state.searchRevision)return;
        state.summary=data.summary||null;state.total=Number(data.pagination?.total||0);state.searchReady=data.search_ready!==false;
        state.orders = Array.isArray(data.orders) ? data.orders : []; state.hasMore = data.pagination?.has_more === true;
        if (linkedOrderPending) {
          linkedOrderPending=false; state.selected=linkedOrder; renderList(); notice('');
          if (linkedOrder) await selectOrder(linkedOrder,false,true);
          else { find('portalDetail').replaceChildren(empty('Nieprawidłowy odnośnik','Wybierz realizację z listy, aby otworzyć rozmowę.')); notice('Odnośnik do rozmowy jest nieprawidłowy.','error'); }
          return;
        }
        const previous = preserveSelection && state.selected && (state.selected === linkedOrder || state.orders.some(order => order.id === state.selected)) ? state.selected : state.orders[0]?.id;
        state.selected = previous || null; renderList(); notice("");
        if (state.selected) await selectOrder(state.selected);
        else find("portalDetail").replaceChildren(empty("Twój import w jednym miejscu", "Statusy i rozmowa pojawią się po dodaniu realizacji."));
      } catch (error) { if (!authError(error)) notice(errorMessage(error), "error"); }
      finally { state.listBusy = false; find("portalRefresh").disabled = false; find("portalNext").disabled = false; find("portalPrevious").disabled = false; if(state.reloadQueued&&state.role){state.reloadQueued=false;loadOrders({preserveSelection:false});} }
    }
    async function selectOrder(id, moveFocus = false, openConversation = false) {
      if (!fileId(id) || !state.role) return;
      const token = ++state.loadToken; state.selected = asText(id); state.detail = null; renderList(); find("portalDetail").setAttribute("aria-busy", "true");
      notice("Pobieram szczegóły realizacji…");
      try {
        const data = await api("/api/portal/orders/" + encodeURIComponent(id));
        if (token !== state.loadToken || !state.role) return;
        if (!data.order || asText(data.order.id) !== asText(id)) throw new Error("invalid_response");
        const index = state.orders.findIndex(order => order.id === id); if (index >= 0) state.orders[index] = data.order;
        renderList(); renderDetail(data); notice("");
        const address=new win.URL(win.location.href);address.searchParams.set('order',id);
        if(openConversation)address.hash='rozmowa';
        win.history.replaceState(null,'',address.pathname+address.search+address.hash);
        if(openConversation){const conversation=find('rozmowa');conversation?.focus({preventScroll:true});conversation?.scrollIntoView?.({block:'start',behavior:'auto'});}
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
      const top = node("div", "portal-vehicle-top"), title = node("div"); title.append(node("p", "portal-eyebrow", ownerPage ? "Realizacja klienta" : "Twoja realizacja"), node("h2", "", order.register?.vehicle_label || order.title || "Pojazd w realizacji"), node("p", "portal-vehicle-id", [order.vin ? "VIN " + asText(order.vin) : "VIN do uzupełnienia", order.platform ? asText(order.platform).toUpperCase() : "", order.lot ? "LOT " + asText(order.lot) : ""].filter(Boolean).join(" · "))); if(order.register){title.prepend(node("p","portal-case-number",order.register.reference+(order.register.is_test?" · TEST":"")));} top.append(title, status(order.status)); vehicle.append(top);
      const facts = node("dl", "portal-facts");
      for (const [label, value, note] of [["Ostatnia potwierdzona lokalizacja", order.location || "Oczekuje na aktualizację", ""], ["Przewidywany termin dotarcia", dateText(order.estimated_arrival_at), "Termin orientacyjny, może się zmienić"], ["Ostatnia aktualizacja", dateText(order.updated_at, true), ""], ["Statek", order.vessel || "Nie przypisano", ""], ["Kontener", order.container_number || "Nie przypisano", ""], ["Numer sprawy", order.register?.reference || order.id, ""], ...(order.register?[["Data zakupu",order.register.purchased_on?dateText(order.register.purchased_on):"Niepotwierdzona",""],["Wydanie klientowi",order.register.delivered_on?dateText(order.register.delivered_on):"Jeszcze nie wydano",""]]:[])]) { const group = node("div"); const valueNode = node("dd", "", value); if (note) valueNode.append(node("small", "", note)); group.append(node("dt", "", label), valueNode); facts.append(group); } vehicle.append(facts);
      if (state.role === "owner") { const contact = node("div", "portal-assigned-client"); const profile = order.client_profile;
        contact.append(node("strong", "", "Przypisany klient"), node("p", "", [profile?.name, profile?.email || order.verified_email, profile?.phone].filter(Boolean).join(" · ") || "Klient nie uzupełnił profilu kontaktowego.")); if(ownerPage&&state.config.owner_contact_edit_enabled)contact.append(contactForm(order)); vehicle.append(contact); }
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
      let historyRevision = 0;
      if (key === "files") section.addEventListener("portal:file-removed", event => {
        const id = event.detail?.fileId;
        if (!records.some(file => file.id === id)) return;
        historyRevision++; records = records.filter(file => file.id !== id); data[key] = records;
        paging.nextOffset = Math.max(0, paging.nextOffset - 1);
      });
      const token = state.loadToken, current = () => !!state.role && state.selected === order.id && token === state.loadToken && state.detail === data;
      try { if (data.pagination?.[key] !== undefined) paging = historyPage(data.pagination[key], records.length, 0, key === "events" ? 100 : 50); }
      catch { feedback(result, "Nie udało się potwierdzić pełnej historii. Odśwież realizację.", "error"); }
      more.hidden = !paging.hasMore;
      more.addEventListener("click", async () => {
        if (busy || !paging.hasMore || !current()) return;
        if (paging.nextOffset > 10000) { more.hidden = true; feedback(result, "Starsze wpisy wymagają sprawdzenia przez REXBID. Skontaktuj się w sprawie pełnej historii.", "error"); return; }
        busy = true; more.disabled = true; feedback(result, "Pobieram starsze wpisy…"); const offset = paging.nextOffset, revision = historyRevision;
        try {
          const page = await api("/api/portal/orders/" + encodeURIComponent(order.id) + "/" + key + "?limit=50&offset=" + offset);
          if (!current() || revision !== historyRevision) return;
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
        info.append(link, node("small", "", [type, Number.isFinite(size) ? (size / 1024).toFixed(0) + " KB" : "", dateText(file.created_at)].filter(Boolean).join(" · "))); if (state.role === "owner") info.append(node("span", file.visibility === "internal" ? "portal-internal" : "portal-client-visible", file.visibility === "internal" ? "Tylko zespół REXBID" : "Widoczny dla klienta")); item.append(node("span", "portal-file-icon", type), info);
        if (state.role === "owner" && ownerPage && state.config.uploads_enabled === true) {
          const remove = button("Usuń", true); remove.classList.add("portal-file-remove"); remove.setAttribute("aria-label", "Usuń załącznik: " + file.filename);
          const confirmation = node("div", "portal-file-confirm"); confirmation.hidden = true; confirmation.setAttribute("role", "group"); confirmation.setAttribute("aria-label", "Potwierdzenie usunięcia załącznika");
          const question = node("p", "", "Usunąć „" + file.filename + "”? Plik zostanie trwale usunięty i zniknie również z panelu klienta. Tej operacji nie można cofnąć.");
          const confirm = button("Usuń trwale"), cancel = button("Anuluj", true), result = node("p", "portal-form-feedback"); result.setAttribute("aria-live", "polite");
          confirmation.append(question, confirm, cancel, result);
          remove.addEventListener("click", () => { remove.hidden = true; confirmation.hidden = false; cancel.focus(); });
          cancel.addEventListener("click", () => { confirmation.hidden = true; remove.hidden = false; remove.focus(); });
          confirm.addEventListener("click", async () => {
            if (confirm.disabled) return; confirm.disabled = true; cancel.disabled = true; feedback(result, "Usuwam załącznik…");
            try {
              const data = await api(privateFilePath(order.id, file), {method:"DELETE"});
              if (data.deleted !== true || data.file_id !== file.id) throw new Error("invalid_response");
              if (state.selected !== order.id || state.role !== "owner") return;
              if (!content.isConnected) return;
              const remaining = (state.detail?.files || files).filter(entry => entry.id !== file.id);
              if (state.detail) state.detail.files = remaining;
              content.closest('[data-portal-history="files"]')?.dispatchEvent(new win.CustomEvent("portal:file-removed", {detail:{fileId:file.id}}));
              fillFiles(content, order, remaining);
              notice(data.purge_pending ? "Załącznik ukryty. System automatycznie dokończy usuwanie pliku z magazynu." : "Załącznik został trwale usunięty.", data.purge_pending ? "info" : "success");
            } catch (error) { if (!authError(error)) { feedback(result, errorMessage(error), "error"); confirm.disabled = false; cancel.disabled = false; } }
          });
          item.append(remove, confirmation);
        }
        list.append(item); } content.append(list);
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
      const section = box("Rozmowa o pojeździe", "Wiadomości w panelu REXBID"), list = node("div", "portal-message-list"); section.id='rozmowa';section.tabIndex=-1;list.setAttribute("aria-label", "Historia rozmowy"); fillMessages(list, data.messages); section.append(list);
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
      const form = node("form", "portal-form"); form.dataset.portalForm = "message"; const input = field("Twoja wiadomość", "text", { type:"textarea", required:true, maxLength:2000 }); const result = node("p", "portal-form-feedback"); result.setAttribute("aria-live", "polite"); const actions = node("div", "portal-form-actions"), submit = button("Wyślij w panelu"); submit.type = "submit"; actions.append(node("p", "portal-form-note", state.config.notifications_enabled ? "Wiadomość zostanie zapisana w rozmowie. Odbiorca otrzyma powiadomienie e-mail z odnośnikiem do panelu." : "Wiadomość trafi do tej rozmowy. Panel nie wysyła jej automatycznie e-mailem."), submit);
      const sender = node("p", "portal-compose-sender", state.role === "owner" ? "Wysyłasz jako REXBID z konta właściciela." : "Wysyłasz jako Klient.");
      form.append(sender, input.wrapper, actions, result);
      let busy = false, pendingMessage=null; form.addEventListener("submit", async event => { event.preventDefault(); if (busy || !form.checkValidity() || !input.input.value.trim()) { if (!busy) feedback(result, "Wpisz treść wiadomości.", "error"); return; } busy = true; submit.disabled = true; feedback(result, "Zapisuję wiadomość…");
        try { const clear=input.input.value.trim();if(!pendingMessage||pendingMessage.text!==clear)pendingMessage={text:clear,client_request_id:win.crypto.randomUUID()};const saved=await api("/api/portal/orders/" + encodeURIComponent(order.id) + "/messages", { method:"POST", body:JSON.stringify(pendingMessage) });pendingMessage=null; if (state.selected === order.id) await selectOrder(order.id); notice("Wiadomość została zapisana w rozmowie."+(saved.notification==='queued'?' Powiadomienie e-mail czeka na wysłanie.':saved.notification==='recipient_missing'?' Brakuje potwierdzonego adresu odbiorcy powiadomienia.':''), "success"); }
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
      const createTest=field("Sprawa testowa — pomijaj w statystykach", "is_test", {type:"checkbox"});
      form.append(client.wrapper, selectedClient, moreClients, title.wrapper, vin.wrapper, lot.wrapper, platform.wrapper, ...(state.config.order_register_enabled?[createTest.wrapper]:[]), node("p", "portal-form-note", "Wybierz zweryfikowanego klienta i sprawdź dane profilu. Podaj VIN lub numer LOT z domem aukcyjnym. Wystarczy jeden z tych identyfikatorów."), submit, result); let busy = false;
      form.addEventListener("submit", async event => { event.preventDefault(); if (busy || !form.checkValidity()) return; if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(client.input.value.trim())) { feedback(result, "Wybierz istniejące konto klienta.", "error"); client.input.focus(); return; }
        if (!title.input.value.trim() || (!vin.input.value.trim() && !lot.input.value.trim()) || (vin.input.value.trim() && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin.input.value.trim())) || (lot.input.value.trim() && !/^[A-Z0-9-]{1,32}$/i.test(lot.input.value.trim())) || Boolean(lot.input.value.trim()) !== Boolean(platform.input.value)) { feedback(result, "Podaj nazwę pojazdu oraz prawidłowy VIN lub LOT z domem aukcyjnym.", "error"); return; }
        busy = true; submit.disabled = true; feedback(result, "Tworzę realizację…");
        try { const data = await api("/api/portal/orders", { method:"POST", body:JSON.stringify({client_user_id:client.input.value.trim(),title:title.input.value.trim(), ...(state.config.order_register_enabled?{is_test:createTest.input.checked}:{}), ...(vin.input.value.trim() ? {vin:vin.input.value.trim().toUpperCase()} : {}), ...(lot.input.value.trim() ? {lot:lot.input.value.trim().toUpperCase()} : {}), ...(platform.input.value ? {platform:platform.input.value} : {})}) }); state.offset = 0; await loadOrders({preserveSelection:false}); if (data.order?.id) await selectOrder(data.order.id); form.reset(); previewClient(); details.open = false; notice("Realizacja została utworzona i przypisana do konta klienta.", "success"); }
        catch (error) { if (!authError(error)) feedback(result, errorMessage(error), "error"); } finally { busy = false; submit.disabled = false; }
      }); details.append(form); mount.append(details);
    }
    async function renderProfile(mount) {
      let profile = {}, profileRevision;
      try { const data = await api("/api/portal/profile"); profile = data.profile || {}; profileRevision=data.revision; }
      catch (error) { if (!authError(error)) mount.append(empty("Profil kontaktowy niedostępny", "Możesz korzystać z rozmowy przy pojeździe. Dane kontaktowe uzupełnisz później.")); return; }
      const details = node("details", "portal-create"); details.append(node("summary", "", "Twoje dane kontaktowe"));
      const form = node("form", "portal-form"); form.dataset.portalForm = "profile";
      const name = field("Imię i nazwisko", "name", {value:profile.name || "",maxLength:80}), email = field("E-mail do kontaktu", "email", {type:"email",value:profile.email || "",maxLength:254}), phone = field("Telefon (opcjonalnie)", "phone", {type:"tel",value:profile.phone || "",maxLength:40});
      name.input.autocomplete = "name"; email.input.autocomplete = "email"; phone.input.autocomplete = "tel";
      const result = node("p", "portal-form-feedback"); result.setAttribute("aria-live", "polite"); const submit = button("Zapisz dane", true); submit.type = "submit";
      form.append(name.wrapper, email.wrapper, phone.wrapper, node("p", "portal-form-note", "Dane kontaktowe pomagają REXBID przypisać i obsłużyć realizację. Zmiana tutaj nie zmienia adresu logowania."), submit, result); let busy = false;
      form.addEventListener("submit", async event => { event.preventDefault(); if (busy || !form.checkValidity()) return; busy = true; submit.disabled = true; feedback(result, "Zapisuję profil…");
        try { const saved=await api("/api/portal/profile", {method:"POST",body:JSON.stringify({name:name.input.value.trim(),email:email.input.value.trim(),phone:phone.input.value.trim(),...(profileRevision?{expected_revision:profileRevision}:{})})});profileRevision=saved.revision; feedback(result, "Dane kontaktowe zostały zapisane.", "success"); }
        catch (error) { if (!authError(error)) feedback(result, errorMessage(error), "error"); } finally { busy = false; submit.disabled = false; }
      }); details.append(form); mount.append(details);
    }
    function initRegister() {
      const tools=find('ownerRegisterTools');if(!tools||state.role!=='owner'||!state.config.order_register_enabled)return;
      tools.hidden=false;
      for(const[value,label]of STAGES){const option=node('option','',label);option.value=value;find('ownerOrderStage').append(option);}
      state.registerView=new win.URLSearchParams(win.location.search).get('view')==='imports';
      const switchView=registerView=>{state.registerView=registerView;renderRegister();const address=new win.URL(win.location.href);if(registerView)address.searchParams.set('view','imports');else address.searchParams.delete('view');win.history.replaceState(null,'',address.pathname+address.search+address.hash);};
      find('ownerViewService').addEventListener('click',()=>switchView(false));find('ownerViewRegister').addEventListener('click',()=>switchView(true));
      const search=()=>{state.query=find('ownerOrderQuery').value.trim();state.kind=find('ownerOrderKind').value;state.stage=find('ownerOrderStage').value;state.offset=0;state.searchRevision++;if(state.listBusy)state.reloadQueued=true;else loadOrders({preserveSelection:false});};
      find('ownerOrderSearch').addEventListener('submit',event=>{event.preventDefault();search();});
      find('ownerOrderClear').addEventListener('click',()=>{find('ownerOrderQuery').value='';find('ownerOrderKind').value='all';find('ownerOrderStage').value='';search();});
      for(const[id,direction]of [['ownerRegisterPrevious',-1],['ownerRegisterNext',1]])find(id).addEventListener('click',()=>{if(state.listBusy)return;state.offset=Math.max(0,state.offset+direction*state.limit);loadOrders({preserveSelection:false});});
    }
    function renderRegister() {
      if(!find('ownerRegisterTools')||state.role!=='owner'||!state.config.order_register_enabled)return;
      find('ownerServiceWorkspace').hidden=state.registerView;find('ownerRegisterPanel').hidden=!state.registerView;
      find('ownerViewService').setAttribute('aria-pressed',String(!state.registerView));find('ownerViewRegister').setAttribute('aria-pressed',String(state.registerView));
      const testCases=state.summary?.test_cases||0;
      find('ownerRegisterCount').textContent='Wyniki: '+state.total+'. Sprawy testowe w całym rejestrze: '+testCases+'. Statystyki powyżej obejmują wszystkie rzeczywiste sprawy, niezależnie od wyszukiwania.'+(!state.searchReady?' Trwa przygotowanie indeksu klientów. Odśwież listę, aby potwierdzić kompletność wyszukiwania.':'');
      find('ownerRegisterPrevious').hidden=state.offset===0;find('ownerRegisterNext').hidden=!state.hasMore;
      const host=find('ownerRegisterTable');host.replaceChildren();
      if(!state.orders.length){host.append(empty('Brak wyników','Zmień kryteria lub wyczyść wyszukiwanie.'));return;}
      const table=node('table'),caption=node('caption','','Realizacje REXBID — strona '+(Math.floor(state.offset/state.limit)+1));table.append(caption);
      const headers=['Nr sprawy','Klient','Samochód / VIN / LOT','Zakup','Etap / lokalizacja','Aktualizacja','Wydanie klientowi','Obsługa'],thead=node('thead'),tr=node('tr');for(const label of headers){const th=node('th','',label);th.scope='col';tr.append(th);}thead.append(tr);table.append(thead);
      const body=node('tbody');
      for(const order of state.orders){const row=node('tr');row.dataset.orderId=order.id;
        const cell=(label,...children)=>{const td=node('td');td.dataset.label=label;td.append(...children);row.append(td);return td;};
        const number=cell(headers[0],node('strong','portal-case-number',order.register?.reference||'Do nadania'));if(order.register?.is_test)number.append(node('span','portal-test-badge','TEST'));
        const email=order.client_profile?.email||order.verified_email;cell(headers[1],node('strong','portal-customer-name',order.client_profile?.name||email||'Dane do uzupełnienia'),...(order.client_profile?.name&&email?[node('small','',email)]:[]),...(order.client_profile?.phone?[node('small','','tel. '+order.client_profile.phone)]:[]));
        cell(headers[2],node('strong','portal-car-name',order.register?.vehicle_label||(!order.register?.is_test?order.title:'Samochód do uzupełnienia')),node('span','owner-vin',order.vin?'VIN '+order.vin:'VIN do uzupełnienia'),node('small','',[order.platform?.toUpperCase(),order.lot?'LOT '+order.lot:null].filter(Boolean).join(' · ')));
        cell(headers[3],node('span','',order.register?.purchased_on?dateText(order.register.purchased_on):'Niepotwierdzona'));
        cell(headers[4],status(order.status),node('small','',order.location||'Lokalizacja do potwierdzenia'));
        cell(headers[5],node('span','',dateText(order.updated_at,true)));
        cell(headers[6],node('span','',order.register?.delivered_on?dateText(order.register.delivered_on):'Jeszcze nie wydano'));
        const open=button('Otwórz',true);open.setAttribute('aria-label','Otwórz sprawę '+order.register?.reference);open.addEventListener('click',()=>{state.registerView=false;renderRegister();const address=new win.URL(win.location.href);address.searchParams.delete('view');win.history.replaceState(null,'',address.pathname+address.search+address.hash);selectOrder(order.id,true);});cell(headers[7],open);body.append(row);
      }table.append(body);host.append(table);
    }
    function contactForm(order) {
      const details=node('details','portal-record-form portal-contact-editor');details.append(node('summary','','Edytuj dane klienta'));
      const profile=order.client_profile||{},form=node('form','portal-form');form.dataset.portalForm='owner-contact';
      const name=field('Imię i nazwisko','name',{value:profile.name||'',maxLength:80}),email=field('E-mail kontaktowy','email',{type:'email',value:profile.email||'',maxLength:254}),phone=field('Telefon','phone',{type:'tel',value:profile.phone||'',maxLength:40});
      const result=node('p','portal-form-feedback');result.setAttribute('aria-live','polite');const submit=button('Zapisz dane klienta'),reload=button('Wczytaj aktualne dane klienta',true);submit.type='submit';reload.hidden=true;reload.addEventListener('click',()=>selectOrder(order.id));
      form.append(name.wrapper,email.wrapper,phone.wrapper,node('p','portal-form-note','Dane są wspólne dla wszystkich realizacji tego klienta. Zmieniasz dane kontaktowe, bez zmiany loginu, hasła ani adresu powiadomień.'),node('p','portal-form-note',order.verified_email?'Potwierdzony adres powiadomień: '+order.verified_email:'Adres powiadomień pochodzi z potwierdzonego konta klienta.'),submit,reload,result);let busy=false,conflict=false;
      form.addEventListener('submit',async event=>{event.preventDefault();if(busy||conflict||!form.checkValidity())return;busy=true;submit.disabled=true;feedback(result,'Zapisuję dane klienta…');
        try{await api('/api/portal/orders/'+encodeURIComponent(order.id)+'/client',{method:'POST',body:JSON.stringify({expected_revision:order.profile_revision,name:name.input.value.trim(),email:email.input.value.trim(),phone:phone.input.value.trim()})});await loadOrders();notice('Dane kontaktowe klienta zapisano. Wyszukiwarka korzysta już z nowych danych.','success');}
        catch(error){if(!authError(error)){if(error.status===409){conflict=true;reload.hidden=false;feedback(result,'Profil klienta zmienił się w międzyczasie. Wczytaj aktualne dane przed kolejną edycją.','error');}else feedback(result,errorMessage(error),'error');}}
        finally{busy=false;submit.disabled=conflict;}
      });details.append(form);return details;
    }

    function recordForm(order) {
      const details=node('details','portal-record-form'),summary=node('summary','','Dane sprawy '+order.register.reference+' — samochód i daty');details.append(summary);
      const form=node('form','portal-form');form.dataset.portalForm='record';const grid=node('div','portal-form-grid');
      const fields=[field('Samochód — marka, model, rocznik','vehicle_label',{value:order.register.vehicle_label||(!order.register.is_test?order.title:''),maxLength:160}),field('VIN','vin',{value:order.vin||'',maxLength:17}),field('Numer LOT','lot',{value:order.lot||'',maxLength:32}),field('Dom aukcyjny','platform',{value:order.platform||'',options:[['','Wybierz'],['copart','Copart'],['iaai','IAAI']]}),field('Potwierdzona data zakupu','purchased_on',{type:'date',value:order.register.purchased_on||''}),field('Data wydania klientowi','delivered_on',{type:'date',value:order.register.delivered_on||''})];
      const delivered=fields.find(x=>x.input.name==='delivered_on');delivered.input.disabled=order.status!=='delivered';
      for(const f of fields)grid.append(f.wrapper);
      const test=field('Sprawa testowa — pomijaj w statystykach','is_test',{type:'checkbox'});test.input.checked=order.register.is_test;
      const submit=button('Zapisz dane sprawy'),result=node('p','portal-form-feedback');submit.type='submit';result.setAttribute('aria-live','polite');
      form.append(grid,test.wrapper,node('p','portal-form-note','Wpisz faktyczne daty zakupu i wydania. Przy etapie „Wygrana aukcja” lub „Pojazd odebrany” odpowiednia data jest wymagana także w aktualizacji realizacji. Brak daty nie jest zgadywany. Imię i nazwisko pochodzą z profilu klienta; do tego czasu widoczny jest jego e-mail.'),submit,result);let busy=false;
      form.addEventListener('submit',async event=>{event.preventDefault();if(busy||!form.checkValidity())return;busy=true;submit.disabled=true;feedback(result,'Zapisuję dane sprawy…');
        const body={expected_version:order.version,is_test:test.input.checked};for(const f of fields)if(!f.input.disabled)body[f.input.name]=f.input.value.trim()||null;
        try{await api('/api/portal/orders/'+encodeURIComponent(order.id)+'/record',{method:'POST',body:JSON.stringify(body)});await loadOrders();notice('Dane sprawy zapisano. Statystyki rejestru zostały przeliczone.','success');}
        catch(error){if(!authError(error))feedback(result,errorMessage(error),'error');}finally{busy=false;submit.disabled=false;}
      });details.append(form);return details;
    }

    function renderOwnerTools(order) {
      const section = box("Aktualizacja realizacji", "Narzędzia właściciela"); section.classList.add("portal-owner-tools"); section.append(node("p", "portal-owner-note", "Podawaj tylko potwierdzone informacje. Termin dotarcia klient zawsze widzi jako orientacyjny."));
      if(order.register)section.append(recordForm(order));
      const form = node("form", "portal-form"); form.dataset.portalForm = "update"; const grid = node("div", "portal-form-grid");
      const fields = [field("Etap importu", "status", {value:order.status,options:STAGES}), field("Potwierdzona lokalizacja", "location", {value:order.location || ""}), field("Przewidywany termin dotarcia", "estimated_arrival_at", {type:"date",value:asText(order.estimated_arrival_at).slice(0,10)}), field("Statek", "vessel", {value:order.vessel || "",maxLength:120}), field("Numer kontenera", "container_number", {value:order.container_number || "",maxLength:50}), field("Widoczność notatki", "event_visibility", {options:[["client", "Dla klienta"],["internal", "Tylko wewnętrznie"]]})]; if(order.register)fields.push(field('Potwierdzona data zakupu','purchased_on',{type:'date',value:order.register.purchased_on||''}),field('Data wydania klientowi','delivered_on',{type:'date',value:order.register.delivered_on||''})); fields.forEach(item => grid.append(item.wrapper));
      const message = field("Notatka o aktualizacji", "event_message", {type:"textarea",maxLength:2000}); const result = node("p", "portal-form-feedback"); result.setAttribute("aria-live", "polite"); const actions = node("div", "portal-form-actions"), submit = button("Zapisz aktualizację"), reload = button("Odśwież dane", true); submit.type = "submit"; reload.hidden = true; reload.addEventListener("click", () => selectOrder(order.id)); actions.append(reload, submit); form.append(grid, message.wrapper, node("p", "portal-form-note", "Notatka wewnętrzna jest ukryta przed klientem. Główny etap, lokalizacja, statek i termin są widoczne w jego realizacji."), actions, result); let busy = false, conflict = false;
      const visibility = fields.find(item => item.input.name === "event_visibility").input;
      const syncDates=()=>{if(!order.register)return;const internal=visibility.value==='internal',stage=fields.find(x=>x.input.name==='status').input.value,purchase=fields.find(x=>x.input.name==='purchased_on').input,delivered=fields.find(x=>x.input.name==='delivered_on').input;purchase.disabled=internal;purchase.required=!internal&&stage==='auction_won';delivered.disabled=internal||stage!=='delivered';delivered.required=!internal&&stage==='delivered';};
      fields.find(x=>x.input.name==='status').input.addEventListener('change',syncDates);syncDates();
      visibility.addEventListener("change", () => { const internal = visibility.value === "internal"; fields.forEach(item => { if (item.input !== visibility) item.input.disabled = internal; }); submit.textContent = internal ? "Zapisz notatkę wewnętrzną" : "Zapisz aktualizację"; message.input.required = internal; syncDates(); });
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
        state.role = session.role; renderSessionRole(); find("portalGate").hidden = true; find("portalWorkspace").hidden = false; find("portalOwnerLink").hidden = state.role !== "owner" || ownerPage; initRegister(); await renderCreate(); if (state.role) await loadOrders({preserveSelection:false});
        if(registrationTool&&state.role==='owner'&&state.config.registrations_enabled){registrationTool.hidden=false;if(new win.URLSearchParams(win.location.search).get('view')==='accounts'){registrationTool.open=true;registrationTool.scrollIntoView?.({block:'start'});}}
        const delivery=session.mail_delivery;
        if(ownerPage&&state.role==='owner'&&delivery&&(delivery.unavailable||delivery.failed>0||delivery.oldestPending&&Date.now()-Date.parse(delivery.oldestPending)>3600000)){
          const warning=node('p','portal-notice','Powiadomienia e-mail wymagają sprawdzenia. '+(delivery.unavailable?'Nie można odczytać stanu wysyłki.':'Oczekujące: '+delivery.pending+', wymagające sprawdzenia: '+delivery.failed+'.')+' Wiadomości panelu pozostają zapisane.');warning.setAttribute('role','alert');find('portalWorkspace').prepend(warning);
        }
      } catch (error) { if (!authError(error)) gate("Panel chwilowo niedostępny", "Nie udało się potwierdzić dostępu. Spróbuj ponownie później."); }
    })();
  }
  root.RexBidClientPortal = {mount, STAGES, ready:null};
  if (typeof document !== "undefined") { const start = () => { root.RexBidClientPortal.ready = mount(document, root); }; if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once:true}); else start(); }
})(typeof window !== "undefined" ? window : globalThis);
