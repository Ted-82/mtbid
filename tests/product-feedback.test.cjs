const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const samples = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/apibara-live-observations.json'), 'utf8'));
const ownerCases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/owner-data-cases.json'), 'utf8'));
const workerSource = fs.readFileSync(path.join(root, 'worker.js'), 'utf8').replace('export default {', 'globalThis.__worker = {');
const indexSource = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const carSource = fs.readFileSync(path.join(root, 'public/car.html'), 'utf8');

function extractFunctionBlock(source, name, nextName) {
  const start = source.search(new RegExp(`(?:async\\s+)?function ${name}\\(`));
  const end = source.search(new RegExp(`(?:async\\s+)?function ${nextName}\\(`));
  assert.ok(start >= 0 && end > start, `Could not locate ${name}`);
  return source.slice(start, end);
}

function workerHelpers() {
  const context = { URL, URLSearchParams, Request, Response, Headers, AbortController, console, fetch: async () => { throw new Error('network disabled in unit tests'); }, setTimeout, clearTimeout, setInterval, clearInterval, caches: { default: { match: async () => null, put: async () => {} } } };
  vm.createContext(context);
  vm.runInContext(`${workerSource}\nglobalThis.helpers = { normalizeHistoryRecord, normalizeApibaraHistory, normalizeVehicle };`, context);
  return context.helpers;
}

test('live /api/filters shape yields searchable make/model and metadata ranges with manual fallback', () => {
  const pieces = [
    extractFunctionBlock(indexSource, 'escapeHtml', 'getFilterValue'),
    extractFunctionBlock(indexSource, 'metadataRoot', 'metadataOption'),
    extractFunctionBlock(indexSource, 'metadataOption', 'metadataOptions'),
    extractFunctionBlock(indexSource, 'metadataOptions', 'setMetadataOptions'),
    extractFunctionBlock(indexSource, 'setMetadataOptions', 'modelOptionsFor'),
    extractFunctionBlock(indexSource, 'modelOptionsFor', 'metadataRange'),
    extractFunctionBlock(indexSource, 'metadataRange', 'loadFilterMetadata')
  ].join('\n');
  const datalists = new Map([['makes', { innerHTML: '' }], ['models', { innerHTML: '' }]]);
  const make = { tagName: 'INPUT', value: '', placeholder: '', getAttribute: () => 'makes' };
  const model = { tagName: 'INPUT', value: '', placeholder: '', getAttribute: () => 'models' };
  const context = { document: { getElementById: id => datalists.get(id) }, escapeHtml: value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]) };
  vm.createContext(context);
  vm.runInContext(`${pieces}\nglobalThis.parse = { metadataRoot, metadataOptions, setMetadataOptions, modelOptionsFor, metadataRange };`, context);

  const data = context.parse.metadataRoot(samples.filters);
  context.parse.setMetadataOptions(make, context.parse.metadataOptions(data.make_model, ['makes']), 'Wpisz lub wybierz markę');
  make.value = 'BMW';
  context.parse.setMetadataOptions(model, context.parse.modelOptionsFor(data, make.value), 'Wpisz lub wybierz model');
  assert.match(datalists.get('makes').innerHTML, /BMW/);
  assert.match(datalists.get('models').innerHTML, /X5/);
  assert.doesNotMatch(datalists.get('models').innerHTML, /MDX/);
  assert.equal(samples.filters.observed_counts.makes, 678);
  assert.equal(samples.filters.observed_counts.BMW_models, 320);
  assert.match(indexSource, /modelDatalist\) modelDatalist\.replaceChildren\(\)/, 'changing the make clears stale model suggestions before metadata refresh');
  assert.deepEqual(JSON.parse(JSON.stringify(context.parse.metadataRange(data, ['year']))), { min: 1900, max: 2027 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.parse.metadataRange(data, ['price_usd']))), { min: 0, max: 250000 });

  make.value = 'Rivian';
  context.parse.setMetadataOptions(make, [], 'Wpisz markę ręcznie');
  assert.equal(make.value, 'Rivian', 'metadata outage must not disable manual text entry');
});

test('history maps event price only when real event status confirms Sold; preserves unsold and approval prices separately', () => {
  const helpers = workerHelpers();
  const sold = helpers.normalizeApibaraHistory({ data: { history: [samples.history_samples.copart_sold] } }, { vin: 'R75HR72105' })[0];
  assert.equal(sold.final_price, 12500);
  assert.equal(sold.source_price, 12500);
  assert.equal(sold.seller, null, 'no seller field was in the actual history event');
  assert.equal(sold.auction_date, '2026-08-30', 'upstream date is an event date, not an explicitly named sale date');
  assert.equal(sold.sale_date, null);

  const notSold = helpers.normalizeApibaraHistory({ data: { history: [samples.history_samples.copart_not_sold] } }, { vin: 'WDC0G5EB3KF610102' })[0];
  assert.equal(notSold.status, 'Not Sold');
  assert.equal(notSold.final_price, null);
  assert.equal(notSold.source_price, 5200);
  assert.equal(notSold.auction_date, '2026-09-18');

  const approval = helpers.normalizeApibaraHistory({ data: { history: [{ ...samples.history_samples.copart_sold, status: 'Sold on Approval' }] } })[0];
  assert.equal(approval.final_price, null, 'approval is not treated as a completed sale');
  assert.equal(approval.source_price, 12500);
  const legacy = helpers.normalizeHistoryRecord(samples.history_samples.copart_sold);
  assert.equal(legacy.final_price, null, 'legacy/raw normalization does not infer final price');
});

test('seller extraction retains full sourced names and drops masked placeholders', () => {
  const helpers = workerHelpers();
  const named = helpers.normalizeVehicle({ vin: 'TESTVIN', lot_number: '1', platform: 'iaai', seller: samples.seller_samples.named_iaai });
  assert.equal(named.sellerName, 'Progressive Casualty Insurance');
  const masked = helpers.normalizeVehicle({ vin: 'TESTVIN', lot_number: '1', platform: 'iaai', seller: samples.seller_samples.masked_iaai });
  assert.equal(masked.sellerName, '');
  assert.equal(masked.sellerType, '');
  const historyMasked = helpers.normalizeHistoryRecord({ platform: 'iaai', lot_number: '1', status: 'Not Sold', seller: { name: '******', type: 'unknown' } });
  assert.equal(historyMasked.seller, null);
});

test('history table shows untyped source price honestly and never renders masked seller as a name', () => {
  assert.match(carSource, /Kwota z rekordu · typ nieokreślony/);
  assert.match(carSource, /historySellerTypeLabel\(item\.seller_type\)/);
  const blocks = [
    extractFunctionBlock(carSource, 'historyField', 'historyNested'),
    extractFunctionBlock(carSource, 'historyNested', 'normalizeHistoryRecord'),
    extractFunctionBlock(carSource, 'normalizeHistoryRecord', 'historyStatusLabel')
  ].join('\n');
  const context = { displayValue: value => typeof value === 'object' && value ? value.name || value.displayName || '' : value, platformName: () => 'COPART', getLot: () => '', isEmpty: value => value === null || value === undefined || value === '' };
  vm.createContext(context);
  vm.runInContext(`${blocks}\nglobalThis.normalize = normalizeHistoryRecord;`, context);
  const event = context.normalize({ source_price: 5200, final_price: null, status: 'Not Sold', seller: '******', seller_type: null, raw_json: samples.history_samples.copart_not_sold });
  assert.equal(event.seller, '');
  assert.equal(event.source_price, 5200);
  assert.equal(event.final_price, null);
  const typed = context.normalize({ status: 'Not Sold', seller: null, seller_type: 'insurance', raw_json: {} });
  assert.equal(typed.seller, '');
  assert.equal(typed.seller_type, 'insurance');
});

test('Timed IAAI presentation uses timed_end_at and secondary current bid without inventing an offer', () => {
  const dateBlock = [
    extractFunctionBlock(carSource, 'getAuctionStart', 'getAuctionEnd'),
    extractFunctionBlock(carSource, 'getAuctionEnd', 'auctionPhase'),
    extractFunctionBlock(carSource, 'getAuctionDisplayDate', 'fetchAuctionHistory')
  ].join('\n');
  const noBid = samples.timed_iaai_samples.no_bid;
  const context = { car: noBid, first: (...values) => values.find(value => value !== null && value !== undefined && value !== ''), getSale: () => null, valueFrom: () => null, getAuctionStatus: () => noBid.auction.state };
  vm.createContext(context);
  vm.runInContext(`${dateBlock}\nglobalThis.displayDate = getAuctionDisplayDate;`, context);
  assert.equal(context.displayDate(), noBid.auction.timed_end_at);
  assert.equal(noBid.pricing.current_bid_usd, null);
  assert.equal(noBid.pricing.current_bid2_usd, null);

  const pricingBlock = extractFunctionBlock(indexSource, 'getPriceInfo', 'getMileage');
  const priceContext = {};
  vm.createContext(priceContext);
  vm.runInContext(`${pricingBlock}\nglobalThis.price = getPriceInfo;`, priceContext);
  const withBid = priceContext.price(samples.timed_iaai_samples.with_bid);
  assert.deepEqual(JSON.parse(JSON.stringify(withBid)), { value: 7400, label: 'Aktualna oferta · Timed Auction' });
  assert.match(dateBlock, /if \(car\.auction\?\.is_timed === true\) return getAuctionEnd\(\) \|\| null/);
  assert.match(dateBlock, /car\.auction\?\.timed_end_at/);

  const statusBlock = indexSource.match(/function getAuctionStatusLabel\(car\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(statusBlock);
  const statusContext = { getAuctionDate: () => '' };
  vm.createContext(statusContext);
  vm.runInContext(`${statusBlock}\nglobalThis.statusLabel = getAuctionStatusLabel;`, statusContext);
  assert.equal(statusContext.statusLabel({ auction: { state: 'open', is_timed: true, timed_end_at: '2020-01-01T00:00:00Z' } }), 'Zakończona');
  assert.equal(statusContext.statusLabel({ auction: { state: 'upcoming', auction_at: null } }), 'Nadchodząca · termin nieustalony');
});

test('all public product pages use the shared REX.Bid brand and mobile navigation', () => {
  const pages = ['index.html','car.html','ulubione.html','konto.html','logowanie.html','rejestracja.html','jak-to-dziala.html','kontakt.html','o-nas.html'];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, 'public', page), 'utf8');
    assert.match(html, /rexbid-brand\.css/, `${page} includes shared brand styles`);
    assert.match(html, /rexbid-mobile-nav\.js/, `${page} includes mobile navigation`);
    assert.match(html, /class="logo"[\s\S]{0,140}REX[\s\S]{0,120}\.Bid/i, `${page} has the canonical text logo`);
    assert.doesNotMatch(html, /MTBid|MTBID|mtbid\.pl|kontakt@mtbid/i, `${page} has no visible legacy brand/contact`);
  }
  const mobile = fs.readFileSync(path.join(root, 'public/rexbid-mobile-nav.js'), 'utf8');
  const brand = fs.readFileSync(path.join(root, 'public/rexbid-brand.css'), 'utf8');
  for (const label of ['Aukcje','Jak to działa','Ulubione','Konto','Kontakt']) assert.match(mobile, new RegExp(label));
  assert.match(mobile, /aria-expanded/);
  assert.match(mobile, /RexBidStorage\?\.refreshCounts/);
  assert.match(brand, /background: #0f2030 !important/);
  assert.match(brand, /color: #f2ad24 !important/);
  assert.match(brand, /@media \(max-width: 1000px\)/);
});

test('IAAI/Copart seller extraction prefers the full source name, maps INS, and ignores masked placeholders', () => {
  const helpers = workerHelpers();
  const vehicle = helpers.normalizeVehicle({ vin: 'TESTVIN', lot_number: 'LOT-1', platform: 'iaai', ...ownerCases.detail_iaai_seller });
  assert.equal(vehicle.sellerName, 'Progressive Casualty Insurance');
  assert.equal(vehicle.sellerType, 'insurance');
  assert.equal(vehicle.runCondition, 'RUNS AND DRIVES');
  assert.equal(vehicle.hasKey, true);

  const copart = helpers.normalizeVehicle({ vin: 'TESTVIN2', lot_number: 'LOT-2', platform: 'copart', ...ownerCases.detail_copart_seller });
  assert.equal(copart.sellerName, 'Non-insurance Company');
  const maskedThenFull = helpers.normalizeVehicle({ vin: 'TESTVIN4', lot_number: 'LOT-4', platform: 'iaai', ...ownerCases.detail_masked_then_full_seller });
  assert.equal(maskedThenFull.sellerName, 'Verified Source Seller');
  assert.equal(maskedThenFull.sellerType, 'insurance');
  const laterSource = helpers.normalizeVehicle({ vin: 'TESTVIN5', lot_number: 'LOT-5', platform: 'iaai', ...ownerCases.detail_unknown_attribute_full_sale_seller });
  assert.equal(laterSource.sellerName, 'Source Sale Seller');
  assert.equal(laterSource.sellerType, 'insurance');
  const masked = helpers.normalizeVehicle({ vin: 'TESTVIN3', lot_number: 'LOT-3', platform: 'iaai', ...ownerCases.detail_masked_seller });
  assert.equal(masked.sellerName, '');
  assert.equal(masked.sellerType, 'insurance');

  const uiBlocks = [extractFunctionBlock(carSource, 'sellerName', 'platformName'), extractFunctionBlock(carSource, 'sellerProfile', 'titleSourceStatus')].join('\n');
  const uiContext = { car: ownerCases.detail_iaai_seller, first: (...values) => values.find(value => value !== null && value !== undefined && value !== ''), valueFrom: () => null, displayValue: value => value };
  vm.createContext(uiContext);
  vm.runInContext(`${uiBlocks}\nglobalThis.seller = {name:sellerName(),profile:sellerProfile(sellerName())};`, uiContext);
  assert.equal(uiContext.seller.name, 'Progressive Casualty Insurance');
  assert.equal(uiContext.seller.profile.type, 'Insurance');
});

test('title hints combine exact document names with source registration/export flags', () => {
  const block = extractFunctionBlock(carSource, 'titleSourceStatus', 'titleVerdictLabel');
  const context = { car: { sale_document: {} }, displayValue: value => value };
  vm.createContext(context);
  vm.runInContext(`${block}\nglobalThis.classify = titleSourceStatus;`, context);
  for (const doc of ownerCases.documents) {
    context.car.sale_document = { name: doc.name, registration: doc.registration, export: doc.export, is_pending: doc.is_pending };
    assert.equal(context.classify(doc.name, null, null, null, null), doc.expected, doc.name);
  }
  assert.match(carSource, /not a legal|ocena prawna|gwarancja rejestracji/i);
});

test('top vehicle highlights distinguish run state, keys and airbags without inventing missing values', () => {
  assert.match(carSource, /car\.condition\?\.run_condition\?\.value/);
  assert.match(carSource, /car\.condition\?\.has_key === true \? "Present"/);
  assert.match(carSource, /car\.vehicle_specs\?\.airbags/);
  assert.match(carSource, /vehicle-highlight condition-chip/);
  assert.match(carSource, /runDriveLabel \? `/);
  assert.match(carSource, /!isEmpty\(keysLabel\)/);
  assert.match(carSource, /!isEmpty\(airbags\)/);
  const block = extractFunctionBlock(carSource, 'runConditionLabel', 'titleSourceStatus');
  const context = { displayValue: value => value };
  vm.createContext(context);
  vm.runInContext(`${block}\nglobalThis.label = runConditionLabel;`, context);
  assert.equal(context.label('RUNS AND DRIVES'), 'RUN & DRIVE');
  assert.equal(context.label('Starts'), 'STARTS');
  assert.equal(context.label('Stationary'), 'STATIONARY');
  assert.equal(context.label(null), '');
  assert.equal(context.label('Enhanced vehicles'), '', 'non-operational labels do not become positive run states');
});

test('Sold on Approval remains approval-pending, distinct from Not Sold, and never becomes a final sale', () => {
  const helpers = workerHelpers();
  const approval = helpers.normalizeApibaraHistory({ data: { history: [ownerCases.history.approval] } })[0];
  assert.equal(approval.status, 'Sold on Approval');
  assert.equal(approval.source_price, 9225);
  assert.equal(approval.final_price, null);
  assert.equal(approval.seller, null, 'history has no seller; current vehicle seller must not be copied into this event');

  const sold = helpers.normalizeApibaraHistory({ data: { history: [ownerCases.history.sold] } })[0];
  assert.equal(sold.final_price, 12500);
  const pending = helpers.normalizeApibaraHistory({ data: { history: [ownerCases.history.pending] } })[0];
  assert.equal(pending.final_price, null);

  const blocks = [
    extractFunctionBlock(carSource, 'historyField', 'historyNested'),
    extractFunctionBlock(carSource, 'historyNested', 'normalizeHistoryRecord'),
    extractFunctionBlock(carSource, 'normalizeHistoryRecord', 'historyStatusLabel'),
    extractFunctionBlock(carSource, 'historyStatusLabel', 'historyStatusClass'),
    extractFunctionBlock(carSource, 'historyStatusClass', 'historySellerTypeLabel')
  ].join('\n');
  const context = { displayValue: value => value, platformName: () => 'IAAI', getLot: () => '', isEmpty: value => value === null || value === undefined || value === '' };
  vm.createContext(context);
  vm.runInContext(`${blocks}\nglobalThis.map = {normalizeHistoryRecord,historyStatusLabel,historyStatusClass};`, context);
  const uiApproval = context.map.normalizeHistoryRecord({ ...ownerCases.history.approval, final_price: 9225 });
  assert.equal(uiApproval.final_price, null);
  assert.equal(context.map.historyStatusLabel('Sold on Approval'), 'Oczekuje na zatwierdzenie');
  assert.equal(context.map.historyStatusClass('Sold on Approval'), 'pending');
  assert.equal(context.map.historyStatusLabel('Not Sold'), 'Nie sprzedano');
  assert.equal(context.map.historyStatusClass('Sold'), 'sold');
  assert.equal(context.map.historyStatusLabel('Pending'), 'Oczekuje na potwierdzenie');
});

test('Buy Now market aisle shows the confirmed Buy Now price and keeps current bid separate', () => {
  const source = extractFunctionBlock(indexSource, 'marketAislePriceInfo', 'renderMarketAisleCard');
  const context = { getPriceInfo: car => ({ value: car.pricing.current_bid_usd, label: 'Aktualna oferta' }), formatMoney: value => '$' + Number(value).toLocaleString('en-US') };
  vm.createContext(context);
  vm.runInContext(source + '\nglobalThis.marketPrice = marketAislePriceInfo;', context);
  const info = context.marketPrice(samples.buy_now_listing_sample, 'buy-now');
  assert.deepEqual(JSON.parse(JSON.stringify(info)), { value: 1000, label: 'Kup teraz', secondary: 'Aktualna oferta · $150' });
  assert.deepEqual(JSON.parse(JSON.stringify(context.marketPrice(samples.buy_now_listing_sample))), { value: 150, label: 'Aktualna oferta', secondary: '' });
  assert.deepEqual(JSON.parse(JSON.stringify(context.marketPrice({ pricing: { buy_now_usd: 0 } }, 'buy-now'))), { value: null, label: 'Kup teraz', secondary: '' });
  assert.deepEqual(JSON.parse(JSON.stringify(context.marketPrice({ pricing: { current_bid_usd: 850, sale_price_usd: 2200 } }, 'timed'))), { value: 850, label: 'Aktualna oferta', secondary: '' });
  assert.deepEqual(JSON.parse(JSON.stringify(context.marketPrice({ pricing: { sale_price_usd: 2200 } }, 'upcoming'))), { value: null, label: 'Cena niedostępna', secondary: '' });
});
test('home catalog uses four bounded sections backed only by supported Worker filters', () => {
  const sections = [...indexSource.matchAll(/<section class="market-aisle" data-market-aisle data-kind="([^"]+)" data-query="([^"]+)"/g)];
  assert.equal(sections.length, 4);
  assert.deepEqual(sections.map(match => match[1]), ['current', 'buy-now', 'timed', 'upcoming']);
  assert.deepEqual(sections.map(match => match[2]), [
    'lot_sub_status=Open', 'lot_status=Buy%20Now', 'platform=iaai&amp;lot_status=Timed', 'upcoming=only'
  ]);
  assert.match(indexSource, /params\.set\("per_page", "4"\)/);
  assert.match(indexSource, /marketAisleCars\(payload\)\.slice\(0, 4\)/);
  assert.match(indexSource, /href="\$\{escapeHtml\(href\)\}"/);
  assert.equal((indexSource.match(/class="aisle-more" href="\/?\?catalog=1/g) || []).length, 4);
  assert.doesNotMatch(indexSource, /Superauta|Premium|Wyróżnione/);
  assert.match(indexSource, /id="catalogResults"[^>]*hidden/);
  assert.match(indexSource, /params\.get\("catalog"\) === "1" \|\| filterDefinitions\.some/);
  assert.match(indexSource, /if \(catalogMode\) loadCars\(\{ updateUrl: false \}\);\s*else initMarketAisles\(\);/);
  assert.doesNotMatch(indexSource, /<h2>Wszystkie aukcje<\/h2>/);
  assert.match(indexSource, /id="loadMoreButton"[\s\S]*?Załaduj więcej/);
  assert.match(indexSource, /vin \? `\/car\.html\?vin=/);
  assert.match(indexSource, /`\/car\.html\?lot=/);
});

test('upcoming aisle only shows source-confirmed future date and never substitutes historical prices', () => {
  const block = extractFunctionBlock(indexSource, 'getConfirmedUpcomingDate', 'marketAisleCars');
  const context = { Date, DateParse: Date.parse };
  vm.createContext(context);
  vm.runInContext(`${block}\nglobalThis.date = getConfirmedUpcomingDate;`, context);
  assert.equal(context.date({ auction: { state: 'upcoming', formatted: '2026-10-01', sale_price_usd: 9000 } }), '', 'display text alone is not treated as a confirmed date');
  assert.match(context.date({ auction: { auction_at: '2099-05-06T12:30:00Z' } }), /06\.05\.2099/);
  assert.equal(context.date({ auction: { auction_at: '2000-01-01T00:00:00Z' } }), '');
});

test('home puts search and aligned primary filters before the four discovery sections, with separated REX.Bid lockup', () => {
  const filterAt = indexSource.indexOf('class="container filter-section"');
  const aislesAt = indexSource.indexOf('id="marketSections"');
  const catalogAt = indexSource.indexOf('id="catalogResults"');
  assert.ok(filterAt > 0 && filterAt < aislesAt && aislesAt < catalogAt);
  assert.match(indexSource.slice(filterAt, aislesAt), /id="searchForm"/);
  for (const label of ['Platforma', 'Marka', 'Model', 'Rok od', 'Rok do']) assert.ok(indexSource.slice(filterAt, aislesAt).includes(`>${label}</label>`));
  assert.match(indexSource.slice(filterAt, aislesAt), /id="filterButton"/);
  assert.match(indexSource, /<div class="brand-lockup">[\s\S]*class="logo"[\s\S]*class="brand-note"/);
  assert.match(indexSource, /\.brand-lockup\s*\{[^}]*display:grid/);
  assert.match(indexSource, /\.brand-note\s*\{[^}]*white-space:nowrap/);
});
