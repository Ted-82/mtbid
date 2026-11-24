(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./rexbid-car-navigation.js") : root?.RexBidCarNavigation);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RexBidInquiry = api;
  if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", () => api.mount(document, root));
})(typeof globalThis !== "undefined" ? globalThis : this, function (navigation) {
  "use strict";
  const clean = (value, max = 120) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  const validObservation = value => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return "";
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return "";
    const canonical = parsed.toISOString();
    return value.slice(0,19) === canonical.slice(0,19) ? canonical : "";
  };
  function normalizeContext(params) {
    const get = key => typeof params?.get === "function" ? params.get(key) : params?.[key];
    const lot = clean(get("lot"), 40).replace(/[^a-zA-Z0-9-]/g, "");
    const rawPlatform = clean(get("platform"), 20).toLowerCase();
    const platform = ["copart", "iaai"].includes(rawPlatform) ? rawPlatform : "";
    const vin = clean(get("vin"), 17).toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
    const rawPrice = clean(get("purchase_usd"), 16);
    const purchase_usd = /^\d+(?:\.\d{1,2})?$/.test(rawPrice) && Number(rawPrice) >= 0 && Number(rawPrice) <= 10000000 ? Number(rawPrice) : null;
    const rawBudget = clean(get("budget_pln"),16), rawFx = clean(get("fx_usd_pln"),16);
    const budget_pln = /^\d+(?:\.\d{1,2})?$/.test(rawBudget) && Number(rawBudget) >= 0 && Number(rawBudget) <= 100000000 ? Number(rawBudget) : null;
    const fx_usd_pln = /^\d+(?:\.\d{1,6})?$/.test(rawFx) && Number(rawFx) > 0 && Number(rawFx) <= 100 ? Number(rawFx) : null;
    const delivery_destination = clean(get("delivery_destination"), 80);
    const rawDelivery = clean(get("delivery_pln"), 16);
    const delivery_pln = /^\d+(?:\.\d{1,2})?$/.test(rawDelivery) && Number(rawDelivery) <= 100000000 ? Number(rawDelivery) : null;
    const budget_status = get("budget_status") === "complete" ? "complete" : "partial";
    const price_kind = ["current","buy-now","custom"].includes(get("price_kind")) ? get("price_kind") : "custom";
    const price_status = ["snapshot", "current"].includes(get("price_status")) ? get("price_status") : "";
    const price_observed_at = validObservation(get("price_observed_at"));
    const return_to = get("return_to") ? navigation?.safeLocalReturnPath?.(get("return_to")) || "" : "";
    return { return_to, lot, platform, vin: vin.length === 17 ? vin : "", title: clean(get("title")), purchase_usd, budget_pln, fx_usd_pln, delivery_destination, delivery_pln, budget_status, price_kind, price_status, price_observed_at };
  }
  function vehiclePath(context, preserveReturn = true) {
    const c = normalizeContext(context), params = new URLSearchParams();
    if (c.lot && c.platform) { params.set("lot", c.lot); params.set("platform", c.platform); }
    else if (c.vin) params.set("vin", c.vin);
    else return "";
    if (preserveReturn && c.return_to) params.set("return_to", c.return_to);
    return "/car.html?" + params.toString();
  }
  function draftOrigin(origin) {
    // Use only application origins; a query parameter cannot choose the host.
    return ["https://rexbid.pl", "https://www.rexbid.pl", "https://rexbid-auth-test.tedn828.workers.dev"].includes(origin)
      ? origin : "https://rexbid.pl";
  }
  function estimateSummary(context) {
    return "Szacunkowa wycena importu: " + context.budget_pln + " PLN (" +
      (context.budget_status === "complete" ? "komplet wskazanych składników" : "wycena częściowa") + ")";
  }
  function deliverySummary(context) {
    if (!context.delivery_destination) return "";
    return "Miejsce dostawy: " + context.delivery_destination +
      (context.delivery_pln === null ? "" : " · " + context.delivery_pln + " PLN za dostawę");
  }
  function buildDraft(context, input = {}, origin) {
    const c = normalizeContext(context);
    const topics = { vehicle:"Sprawdzenie auta i wycena importu", search:"Pomoc w znalezieniu auta", support:"Pytanie o serwis" };
    const budget = clean(input.budget, 30);
    const fields = ["Zapytanie do REXBID", "Temat: " + (topics[input.topic] || topics.vehicle), ""];
    if (c.title) fields.push("Pojazd: " + c.title);
    if (c.lot) fields.push("LOT: " + c.lot);
    if (c.platform) fields.push("Aukcja: " + c.platform.toUpperCase());
    if (c.vin) fields.push("VIN: " + c.vin);
    const path = vehiclePath(c, false);
    if (path) fields.push("Karta auta: " + draftOrigin(origin) + path);
    if (c.purchase_usd !== null) {
      const snapshot = c.price_status === "snapshot";
      fields.push("Cena do kalkulacji: " + c.purchase_usd + " USD (" + ({current:snapshot ? "ostatnia zapisana oferta" : "aktualna oferta",
        "buy-now":snapshot ? "Kup teraz · zapis danych" : "Kup teraz",custom:"własna planowana cena"}[c.price_kind]) + ")");
      if (c.price_kind !== "custom" && c.price_observed_at) fields.push("Dane ceny zapisane: " + c.price_observed_at);
      if (c.price_kind !== "custom" && snapshot) fields.push("Cena pochodzi z zapisu danych. Bieżącą cenę i dostępność należy potwierdzić w oryginalnej aukcji.");
    }
    if (c.budget_pln !== null) fields.push(estimateSummary(c), "Proszę o potwierdzenie kwoty i zakresu wyceny przed zakupem.");
    if (deliverySummary(c)) fields.push(deliverySummary(c));
    if (c.fx_usd_pln !== null) fields.push("Kurs użyty do wyceny: " + c.fx_usd_pln + " PLN / USD");
    if (budget) fields.push("Budżet łączny: " + budget + " PLN");
    fields.push("", "Wiadomość:", String(input.message ?? "").replace(/\r\n?/g,"\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 3000));
    if (clean(input.name, 80)) fields.push("", "Imię: " + clean(input.name, 80));
    if (clean(input.email, 254)) fields.push("Kontakt: " + clean(input.email, 254));
    fields.push("", "Proszę o potwierdzenie stanu pojazdu, możliwości zakupu, opłat aukcyjnych, transportu, odprawy i dostawy.", "To zapytanie nie jest zleceniem licytacji ani zobowiązaniem do zakupu.");
    return fields.join("\n");
  }
  function subject(context, input = {}) {
    const c = normalizeContext(context);
    const topic = {vehicle:"Wycena importu",search:"Poszukiwanie auta",support:"Pomoc w serwisie"}[input.topic] || "Wycena importu";
    return ["REXBID", c.lot && c.platform ? c.platform.toUpperCase() + " LOT " + c.lot : "", topic].filter(Boolean).join(" — ");
  }
  function mailto(email, draft, title = "Zapytanie REXBID") {
    const address = clean(email,254);
    if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(address)) return "";
    return "mailto:" + address + "?subject=" + encodeURIComponent(clean(title,180)) + "&body=" + encodeURIComponent(draft);
  }
  function mount(doc, win) {
    const form = doc.getElementById("inquiryForm");
    if (!form) return;
    const context = normalizeContext(new URLSearchParams(win.location.search));
    const enteredBudget = new URLSearchParams(win.location.hash.slice(1)).get("customer_budget_pln");
    const budgetField = form.elements.namedItem("budget");
    if (!budgetField.value && /^[1-9]\d{0,7}$/.test(enteredBudget || "") && Number(enteredBudget) <= Number(budgetField.max)) {
      budgetField.value = enteredBudget;
    }
    const summary = doc.getElementById("inquiryContext"), path = vehiclePath(context);
    const catalogLink = doc.getElementById("inquiryCatalogReturn");
    if (catalogLink && context.return_to) {
      catalogLink.href = context.return_to;
      if (context.return_to.startsWith('/porownaj')) catalogLink.textContent = 'Wróć do porównania →';
    }
    if (path) {
      summary.hidden = false;
      const title = doc.createElement("strong"); title.textContent = context.title || "Wybrany samochód";
      const identity = doc.createElement("small"); identity.textContent = [context.platform.toUpperCase(),context.lot ? "LOT " + context.lot : "",context.vin].filter(Boolean).join(" · ");
      const link = doc.createElement("a"); link.href = path; link.textContent = "Wróć do karty auta →";
      summary.replaceChildren(title,identity,link);
      if (context.budget_pln !== null) {
        const estimate = doc.createElement("small");
        estimate.setAttribute("data-inquiry-estimate", "");
        estimate.textContent = estimateSummary(context) + ". Kwotę i zakres potwierdzimy przed zakupem.";
        summary.insertBefore(estimate,link);
      }
      const deliveryText = deliverySummary(context);
      if (deliveryText) {
        const delivery = doc.createElement("small");
        delivery.textContent = deliveryText;
        summary.insertBefore(delivery,link);
      }
    }
    const output = doc.getElementById("inquiryOutput"), preview = doc.getElementById("inquiryPreview"), status = doc.getElementById("inquiryStatus"), mail = doc.getElementById("inquiryMail");
    let contactEmail = "kontakt@rexbid.pl";
    let direct=false,sendBusy=false,pendingInquiry=null;
    const submitButton=form.querySelector('button[type="submit"]');
    const values = () => Object.fromEntries(new FormData(form));
    const heading = doc.getElementById("outputHeading");
    const copyStatus = doc.getElementById("inquiryCopyStatus") || doc.createElement("p");
    if (!copyStatus.isConnected) {
      copyStatus.setAttribute("role", "status");
      status.before(copyStatus);
    }
    const payloadFor = (v, draft) => ({
      name: String(v.name || "").trim(), email: String(v.email || "").trim(),
      message: String(v.message || "").trim(), draft, website: String(v.website || "")
    });
    function showReceipt() {
      const matches = pendingInquiry?.fingerprint === JSON.stringify(payloadFor(values(), preview.value));
      heading.textContent = matches ? "Zapytanie przyjęte" : "Zmieniona treść zapytania";
      status.textContent = matches
        ? "Zapytanie zostało przyjęte przez REXBID. Odpowiemy na podany adres e-mail. Numer: " + pendingInquiry.receipt + "."
        : "Poprzednie zapytanie przyjęto pod numerem " + pendingInquiry.receipt + ". Aby przesłać bieżące zmiany, wybierz „Wyślij zapytanie”.";
    }
    const update = () => {
      preview.value = buildDraft(context, values(), win.location.origin);
      const href = mailto(contactEmail,preview.value,subject(context,values()));
      mail.hidden = !href || (direct && !pendingInquiry?.failed);
      if (href) mail.href = href;
      if (direct && pendingInquiry?.receipt) showReceipt();
    };
    const validation = doc.getElementById("inquiryValidation");
    const requiredTextFields = [form.elements.namedItem("name"), form.elements.namedItem("message")];
    const syncRequiredText = () => {
      requiredTextFields.forEach((field, index) => field.setCustomValidity(field.value.trim() ? "" : (index === 0 ? "Wpisz imię." : "Wpisz treść wiadomości.")));
    };
    const clearValidation = () => { if (validation) { validation.hidden = true; validation.textContent = ""; } };
    const validateCurrentForm = () => {
      syncRequiredText();
      const valid = form.reportValidity();
      if (valid) clearValidation();
      else {
        if (validation) { validation.hidden = false; validation.textContent = "Sprawdź wymagane pola: imię, adres e-mail i treść wiadomości."; }
        Array.from(form.elements).find(field => field.willValidate && !field.validity.valid)?.focus();
      }
      return valid;
    };
    // Autofill and browser-restored values may change without an input event.
    // Rebuild the mailto immediately before its native navigation, never send here.
    mail.addEventListener("click", event => {
      if (!validateCurrentForm()) { event.preventDefault(); return; }
      update();
    });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if(sendBusy)return;
      if (!validateCurrentForm()) return;
      update(); output.hidden = false;
      if(direct){
        const payload=payloadFor(values(),preview.value);
        const fingerprint=JSON.stringify(payload);
        if (pendingInquiry?.fingerprint === fingerprint && pendingInquiry.receipt) {
          output.scrollIntoView({behavior:"auto",block:"start"});
          return;
        }
        if(!pendingInquiry||pendingInquiry.fingerprint!==fingerprint)pendingInquiry={fingerprint,id:win.crypto.randomUUID()};
        pendingInquiry.failed=false;
        heading.textContent="Treść zapytania"; copyStatus.textContent=""; mail.hidden=true;
        const requestId=pendingInquiry.id;
        sendBusy=true;submitButton.disabled=true;submitButton.textContent='Wysyłam…';status.textContent='Przekazuję zapytanie do REXBID…';
        const controller=new AbortController(),timer=win.setTimeout(()=>controller.abort(),15000);
        try{
          const r=await win.fetch('/api/contact/send',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,request_id:requestId}),signal:controller.signal});
          const data=await r.json();
          if(!r.ok||data.ok!==true)throw Error(data.error||'unavailable');
          pendingInquiry.receipt=data.id;
          update();
          // Keep the same request ID while the unchanged form remains visible:
          // repeated clicks and a lost HTTP response must not send a duplicate.
        }catch(error){
          pendingInquiry.failed=true;
          status.textContent=error.message==='rate_limited'?'Osiągnięto chwilowy limit formularza. Spróbuj później lub wyślij treść bezpośrednio e-mailem.':
            'Nie otrzymaliśmy potwierdzenia przyjęcia zapytania. Spróbuj ponownie — zachowaliśmy wpisaną treść. Możesz też użyć „Otwórz e-mail”.';
          mail.hidden=!mail.href;
        }finally{win.clearTimeout(timer);sendBusy=false;submitButton.disabled=false;submitButton.textContent='Wyślij zapytanie →';}
        output.scrollIntoView({behavior:'auto',block:'start'});return;
      }
      status.textContent = "Treść gotowa. Nie wysłano wiadomości. Skopiuj ją, pobierz lub otwórz w swoim programie pocztowym.";
      output.scrollIntoView({ behavior: win.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth", block:"start" });
      preview.focus({preventScroll:true});
    });
    const refreshFromForm = () => { syncRequiredText(); clearValidation(); copyStatus.textContent=""; if (!output.hidden) update(); };
    form.addEventListener("input", refreshFromForm);
    form.addEventListener("change", refreshFromForm);
    form.addEventListener("reset", () => {
      requiredTextFields.forEach(field => field.setCustomValidity(""));
      clearValidation(); output.hidden = true; preview.value = ""; status.textContent = "";
      copyStatus.textContent="";
      mail.hidden = true; mail.removeAttribute("href");
    });
    const questions = {
      condition: "Proszę o sprawdzenie stanu pojazdu, dokumentu sprzedaży oraz możliwości eksportu i rejestracji.",
      budget: "Proszę o pełną wycenę zakupu i importu z opłatami aukcyjnymi, transportem, odprawą, podatkami i dostawą oraz wskazanie kosztów nieuwzględnionych w wycenie.",
      delivery: "Proszę o proponowaną trasę transportu, miejsce odbioru oraz potwierdzenie dostępnych terminów dla tego auta."
    };
    form.querySelectorAll("[data-inquiry-question]").forEach(button => button.addEventListener("click", () => {
      const sentence=questions[button.dataset.inquiryQuestion],field=form.elements.namedItem("message"),note=doc.getElementById("inquiryQuestionStatus");
      if (!sentence || !field) return;
      if (field.value.includes(sentence)) { if(note)note.textContent="To pytanie jest już w wiadomości."; return; }
      const next=field.value + (field.value.trim() ? "\n\n" : "") + sentence;
      if(next.length>field.maxLength){if(note)note.textContent="Brak miejsca na całe pytanie. Skróć wiadomość, aby je dodać.";return;}
      field.value=next;
      field.dispatchEvent(new win.Event("input",{bubbles:true}));
      if(note)note.textContent="Dodano pytanie. Możesz zmienić jego treść przed wysłaniem.";
      field.focus();
    }));
    doc.getElementById("inquiryCopy").addEventListener("click", async () => {
      update();
      const feedback = direct ? copyStatus : status;
      try { await win.navigator.clipboard.writeText(preview.value); feedback.textContent = direct ? "Skopiowano treść zapytania." : "Skopiowano treść zapytania. Wiadomość nie została wysłana."; }
      catch { preview.focus(); preview.select(); feedback.textContent = "Zaznaczono treść. Skopiuj ją skrótem klawiaturowym lub pobierz plik."; }
    });
    doc.getElementById("inquiryDownload").addEventListener("click", () => {
      update(); const blob = new Blob([preview.value], {type:"text/plain;charset=utf-8"}), href = URL.createObjectURL(blob);
      const link = doc.createElement("a"); link.href=href; link.download="REXBID_zapytanie" + (context.lot ? "_" + context.lot : "") + ".txt"; link.click();
      win.setTimeout(() => URL.revokeObjectURL(href), 1000);
      if (direct) copyStatus.textContent = "Przygotowano plik zapytania.";
      else status.textContent = "Przygotowano plik zapytania. Wiadomość nie została wysłana.";
    });
    // The public configuration enables direct delivery only when the server's
    // existing mail integration is ready. A draft remains available as fallback.
    const controller = new AbortController();
    const timeout = win.setTimeout(() => controller.abort(), 5000);
    win.fetch("/api/contact/config", {credentials:"omit",signal:controller.signal}).then(response => response.ok ? response.json() : null).then(config => {
      if (!config || !mailto(config.email,"")) return;
      contactEmail = config.email;
      direct=config.mode==='direct'&&config.enabled===true;
      if(direct){
        heading.textContent="Treść zapytania";
        submitButton.textContent='Wyślij zapytanie →';
        const lastStep=doc.querySelector('.contact-progress li:last-child');if(lastStep)lastStep.innerHTML='<span>3</span> Wyślij na stronie';
        const note=doc.getElementById('inquiryPrivacyNote');if(note)note.textContent='Przycisk wysyła zapytanie bezpośrednio do REXBID. Dane auta i wycena zostaną dołączone. Odpowiemy na podany adres e-mail; nie musisz otwierać programu pocztowego. Wysłanie nie zleca licytacji ani płatności.';
        const outputNote=doc.getElementById('contactOutputNote');if(outputNote)outputNote.textContent='Poniżej zachowujemy kopię treści Twojego zapytania. Odpowiedź otrzymasz e-mailem.';
        const title=doc.getElementById('inquiryHeading');if(title)title.textContent='Zapytaj o import';
      }
      const anchor = doc.getElementById("contactEmail"); anchor.href = mailto(contactEmail,""); anchor.textContent = contactEmail; anchor.hidden = false;
      doc.getElementById("contactAvailability").textContent = direct?'Wyślij zapytanie bezpośrednio przez formularz lub napisz na podany adres.':"Możesz wysłać zapytanie na podany adres e-mail. Wysłanie następuje w Twoim programie pocztowym.";
      if (!output.hidden) update();
    }).catch(() => {}).finally(() => win.clearTimeout(timeout));
  }
  return Object.freeze({ normalizeContext, vehiclePath, buildDraft, subject, mailto, mount });
});
