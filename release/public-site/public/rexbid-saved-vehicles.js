(function (root) {
  'use strict';
  const PAGE_SIZE = 12, CONCURRENCY = 3, REQUEST_LIMIT = 120, TIMEOUT_MS = 10000;
  const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const number = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const first = (...values) => values.find(value => value !== null && value !== undefined && value !== '');
  function ref(car) {
    const platform = text(car?.platform).toLowerCase(), lot = text(car?.lot || car?.lot_number);
    return ['copart', 'iaai'].includes(platform) && /^\d{1,12}$/.test(lot) && !/\s/.test(lot)
      ? { platform, lot, vin: text(car?.vin).trim().toUpperCase() } : null;
  }
  const key = r => r.platform + ':' + r.lot + ':' + r.vin;
  function identity(car, requested) {
    const actual = ref(car);
    return !!actual && actual.platform === requested.platform && actual.lot === requested.lot
      && (!requested.vin || actual.vin === requested.vin);
  }
  function observed(car) {
    const value = first(car?.read?.last_synced_at, car?.read?.last_seen_at, car?.read?.observed_at, car?.last_synced_at, car?.last_seen_at);
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? value : '';
  }
  const auctionClock = new Intl.DateTimeFormat('pl-PL', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'Europe/Warsaw', timeZoneName:'longOffset' });
  function date(value, auction = false) {
    if (typeof value !== 'string') return 'nieustalona';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split('-').reverse().join('.');
    if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) return 'nieustalona';
    if (auction) {
      if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return 'nieustalona';
      const parts = auctionClock.formatToParts(new Date(value));
      const offset = parts.find(part => part.type === 'timeZoneName')?.value.replace(/^GMT/, 'UTC');
      return parts.filter(part => part.type !== 'timeZoneName').map(part => part.value).join('').trim() + ' · Polska' + (offset ? ' (' + offset + ')' : '');
    }
    return new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }).format(new Date(value));
  }
  const money = value => number(value) === null ? 'Brak danych o ofercie' : new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 }).format(Number(value)) + ' USD';
  function facts(car) {
    const a = car?.auction || {}, p = car?.pricing || {};
    const status = text(a.outcome_status || a.last_sold_status).toLowerCase().replace(/[_-]+/g, ' ');
    const state = text(a.state).toLowerCase();
    const approval = /on approval|approval pending|pending approval|awaiting approval/.test(status);
    const unsold = /not.?sold|no.?sale|unsold/.test(status) || ['not_sold', 'no_sale'].includes(state);
    const sold = !approval && !unsold && (/\bsold\b/.test(status) || state === 'sold' || a.sold_timed === true);
    const terminal = approval || unsold || sold || ['finished', 'closed', 'ended'].includes(state) || !!a.auction_ended_at;
    let label = 'Oferta z zapisu', amount = terminal ? null : (Object.prototype.hasOwnProperty.call(p,'current_bid_usd')?[p.current_bid_usd]:[p.current_bid2_usd]).map(number).find(value=>value!==null&&value>0)??null;
    if (sold) { label = 'Cena sprzedaży'; amount = number(first(p.sale_price_usd, p.final_price_usd)); }
    else if (approval) { label = 'Oferta warunkowa'; amount = number(p.source_price_usd); }
    else if (terminal) label = 'Brak potwierdzonej ceny sprzedaży';
    const missing = sold ? 'Źródło nie podało ceny sprzedaży' : approval ? 'Cena sprzedaży niepotwierdzona' : terminal ? 'Brak potwierdzonej ceny sprzedaży' : 'Brak danych o ofercie';
    return { label, amount, missing, buyNow: !terminal && number(p.buy_now_usd) > 0 ? Number(p.buy_now_usd) : null,
      status: approval ? 'Oferta warunkowa · wynik niepotwierdzony' : unsold ? 'Nie sprzedano' : sold ? 'Sprzedano' : terminal ? 'Zakończona · wynik niepotwierdzony' : 'Dostępność do potwierdzenia',
      approval, date: date(first(a.timed_end_at, a.auction_at, a.full_date, a.date), true), observed: date(observed(car)) };
  }
  async function read(saved, fetchImpl = root.fetch, timeout = TIMEOUT_MS) {
    const requested = ref(saved);
    if (!requested) return { error: 'Brakuje jednoznacznego numeru LOT lub platformy. Zachowano zapis ulubionego.', code: 'identifier' };
    const abort = new root.AbortController();
    let timer;
    const expired = new Promise((_, reject) => { timer = root.setTimeout(() => { abort.abort(); reject(new Error('timeout')); }, timeout); });
    try {
      const response = await Promise.race([fetchImpl('/api/car/' + requested.lot + '?platform=' + requested.platform, { credentials: 'omit', signal: abort.signal }), expired]);
      if (!response.ok) return { error: response.status === 404 ? 'Brak odczytu tej oferty w katalogu. Nie oznacza to sprzedaży; zachowano zapis ulubionego.' : 'Nie udało się odczytać katalogu. Zachowano wcześniejszy zapis ulubionego.', code: 'http', status: response.status };
      const body = await Promise.race([response.json(), expired]);
      if (body?.ok !== true || !identity(body.data, requested)) return { error: 'Odpowiedź nie potwierdza tego samego VIN, LOT-u i platformy. Zachowano zapis ulubionego.', code: 'identity' };
      const priorDate = observed(saved), nextDate = observed(body.data);
      if (priorDate && (!nextDate || Date.parse(nextDate) < Date.parse(priorDate))) return { error: 'Zapis katalogu ma starszą lub nieustaloną datę. Zachowano nowszy zapis ulubionego.', code: 'older' };
      return { car: body.data };
    } catch { return { error: 'Odczyt katalogu nie powiódł się lub trwał zbyt długo. Zachowano zapis ulubionego.', code: 'unavailable' }; }
    finally { root.clearTimeout(timer); }
  }
  function createLoader({ fetchImpl = root.fetch, timeout = TIMEOUT_MS, limit = REQUEST_LIMIT } = {}) {
    const memory = new Map(), queue = []; let running = 0, attempts = 0, stopped = false;
    const closed = { error: 'Odczyt zakończony. Zachowano zapis ulubionego.', code: 'stopped' };
    function pump() {
      while (!stopped && running < CONCURRENCY && queue.length) {
        const job = queue.shift(); running++; attempts++;
        read(job.saved, fetchImpl, timeout).then(job.resolve).finally(() => { running--; pump(); });
      }
    }
    return {
      get attempts() { return attempts; },
      get(saved) {
        const r = ref(saved);
        if (!r) return Promise.resolve({ error: 'Brakuje jednoznacznego LOT-u lub platformy. Zachowano zapis ulubionego.', code: 'identifier' });
        if (stopped) return Promise.resolve(closed);
        if (memory.has(key(r))) return memory.get(key(r));
        if (memory.size >= limit) return Promise.resolve({ error: 'Osiągnięto limit odczytu na tej stronie. Otwórz kartę auta, aby zobaczyć zapis katalogu.', code: 'limit' });
        const result = new Promise(resolve => { queue.push({ saved, resolve }); });
        memory.set(key(r), result); pump(); return result;
      },
      stop() { stopped = true; queue.splice(0).forEach(job => job.resolve(closed)); }
    };
  }
  function mount({ content, storage = root.RexBidStorage, fetchImpl = root.fetch } = {}) {
    if (!content || !storage) return null;
    const doc = content.ownerDocument, loader = createLoader({ fetchImpl });
    const esc = storage.escapeHtml;
    let list = null, generation = 0, cards = [], visible = PAGE_SIZE, page = null, notice = null;
    const source = () => storage.getFavorites();
    function cardSource(node) {
      const link = node.querySelector('a[href]'); if (!link) return null;
      let url; try { url = new URL(link.getAttribute('href'), root.location.origin); } catch { return null; }
      const lot = url.searchParams.get('lot'), platform = url.searchParams.get('platform'), vin = url.searchParams.get('vin');
      return source().find(car => (!lot || text(car.lot) === lot) && (!platform || text(car.platform).toLowerCase() === platform) && (!vin || text(car.vin).toUpperCase() === vin.toUpperCase())) || null;
    }
    function paint(node, car, message, isCatalog) {
      const f = facts(car), title = text(car.title) || [car.year, car.make, car.model].filter(Boolean).join(' ') || 'Zapisany samochód';
      const lot = text(car.lot || car.lot_number), vin = text(car.vin), platform = text(car.platform).toUpperCase();
      const loc = typeof car.location === 'object' ? text(first(car.location.display, car.location.formatted, car.location.name)) : text(car.location);
      const mileage = typeof car.odometer === 'object' ? text(car.odometer.formatted) || (number(car.odometer.value) !== null ? text(car.odometer.value) + ' ' + text(car.odometer.unit) : '') : text(car.odometer);
      const seller = typeof car.seller === 'object' ? text(car.seller.name) : text(car.seller);
      const sourceLabel = isCatalog ? 'Zapis katalogu' : 'Zapis ulubionego';
      const body = node.classList.contains('cloud-favorite') ? (() => { let value = node.querySelector('.saved-catalog-body'); if (!value) { value = doc.createElement('div'); value.className = 'body saved-catalog-body'; node.insertBefore(value, node.querySelector('.cloud-favorite-actions')); } return value; })() : node.querySelector('.body');
      if (!body) return;
      body.innerHTML = (node.classList.contains('cloud-favorite') ? '' : '<div class="platform">' + esc(platform) + '</div><div class="title">' + esc(title) + '</div>')
        + '<p class="saved-view-state' + (isCatalog ? ' saved-view-ready' : '') + '" role="status">' + esc(message) + '</p>'
        + '<div class="info">' + [['VIN', vin], ['LOT', lot], ['Przebieg', mileage], ['Lokalizacja', loc], ['Wynik / dostępność', f.status], ['Termin z zapisu', f.date], ['Sprzedający', seller]].map(([label, value]) => '<div class="info-item"><span class="label">' + esc(label) + '</span><span class="value">' + esc(value || '—') + '</span></div>').join('') + '</div>'
        + '<div class="price"><small>' + esc(f.label) + '</small><br>' + (f.amount === null ? '<span class="saved-price-missing">' + esc(f.missing) + '</span>' : esc(money(f.amount))) + '</div>'
        + (f.buyNow === null ? '' : '<p class="saved-buy-now"><span>Kup teraz · zapis danych</span><strong>' + esc(money(f.buyNow)) + '</strong></p>')
        + (f.approval ? '<p class="saved-observation">Sprzedaż wymagała zatwierdzenia. Oferta warunkowa nie jest ceną sprzedaży.</p>' : '')
        + '<p class="saved-observation">' + esc(sourceLabel + ' · data obserwacji: ' + f.observed + '. ') + 'Cenę, termin i dostępność potwierdź przed zakupem.</p>';
      if (isCatalog) {
        const titleLink = node.classList.contains('cloud-favorite') ? node.querySelector('a[href]') : null;
        if (titleLink) titleLink.textContent = title;
        const rawImage = car.media?.thumbs?.[0] || car.media?.items?.[0];
        const image = storage.safeImageUrl(car.image || (typeof rawImage === 'object' ? rawImage.thumb || rawImage.url || rawImage.src : rawImage));
        const wrap = node.querySelector('.image-wrap');
        if (image && wrap) { const img = wrap.querySelector('img') || doc.createElement('img'); img.src = image; img.alt = title; img.loading = 'lazy'; if (!img.parentNode) wrap.prepend(img); wrap.querySelector('.no-image')?.remove(); }
      }
      node.querySelectorAll('.image-wrap img').forEach(img => { img.onerror = () => { const empty = doc.createElement('div'); empty.className = 'no-image'; empty.textContent = 'Zdjęcie niedostępne'; img.replaceWith(empty); }; });
    }
    function show() {
      const current = generation;
      cards.forEach((node, index) => {
        node.hidden = index >= visible;
        if (node.hidden || node.dataset.savedReadStarted) return;
        node.dataset.savedReadStarted = 'true';
        const saved = cardSource(node);
        if (!saved) return;
        paint(node, saved, 'Sprawdzam zapis katalogu…', false);
        loader.get(saved).then(result => {
          if (current !== generation || !node.isConnected) return;
          paint(node, result.car || saved, result.car ? 'Dane z katalogu REXBID' : result.error, !!result.car);
        });
      });
      if (page) {
        const count = Math.min(visible, cards.length), next = page.querySelector('button');
        page.querySelector('span').textContent = 'Wyświetlono ' + count + ' z ' + cards.length + ' aut';
        next.hidden = count === cards.length;
      }
    }
    function scan() {
      const next = content.querySelector('.grid,.cloud-favorites-list');
      if (next === list) return;
      list = next; generation++; notice?.remove(); page?.remove(); notice = page = null;
      if (!list) return;
      cards = [...list.children].filter(node => node.matches('.card,.cloud-favorite')); visible = PAGE_SIZE;
      notice = doc.createElement('p'); notice.className = 'saved-catalog-note';
      notice.textContent = 'Pokazujemy najnowszy dostępny zapis w katalogu REXBID wraz z datą obserwacji. To nie jest odczyt aukcji na żywo. Twój zapis ulubionych pozostaje zachowany.';
      content.insertBefore(notice, list);
      page = doc.createElement('div'); page.className = 'saved-pagination'; page.innerHTML = '<span></span><button class="btn btn-outline" type="button">Pokaż kolejne 12 aut</button>';
      page.querySelector('button').addEventListener('click', () => { visible += PAGE_SIZE; show(); }); content.append(page); show();
    }
    const observer = new root.MutationObserver(scan);
    observer.observe(content, { childList: true }); scan();
    const stop = () => { generation++; loader.stop(); observer.disconnect(); };
    // Back/forward cache keeps this document alive. Preserve the bounded loader
    // and its deduplication state so pending views can finish after returning.
    // Keep listening: a later definitive navigation must still stop queued work.
    root.addEventListener?.('pagehide', event => { if (event.persisted !== true) stop(); });
    return { stop, scan, loader };
  }
  const api = { PAGE_SIZE, CONCURRENCY, REQUEST_LIMIT, TIMEOUT_MS, ref, identity, observed, date, money, facts, read, createLoader, mount };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RexBidSavedVehicles = api;
})(typeof window !== 'undefined' ? window : globalThis);
