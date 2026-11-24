const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const samples = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/apibara-live-observations.json'), 'utf8'));
const ownerCases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/owner-data-cases.json'), 'utf8'));
const workerSource = fs.readFileSync(path.join(root, 'worker.js'), 'utf8')
  .replace('import apibaraModule from "./providers/apibara.js";', 'const apibaraModule = globalThis.__apibaraModule;')
  .replace('import contract from "./providers/contract.js";', 'const contract = globalThis.__providerContract;')
  .replace('import authProviderModule from "./auth/supabase.js";', 'const authProviderModule = globalThis.__authProviderModule;')
  .replace('import accountsModule from "./auth/routes.js";', 'const accountsModule = globalThis.__accountsModule;')
  .replace('import providerBudgetModule from "./providers/request-budget.js";', 'const providerBudgetModule = globalThis.__providerBudgetModule;')
  .replace('export default {', 'globalThis.__worker = {');
const indexSource = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const carSource = fs.readFileSync(path.join(root, 'public/car.html'), 'utf8');

function extractFunctionBlock(source, name, nextName) {
  const start = source.search(new RegExp(`(?:async\\s+)?function ${name}\\(`));
  const end = source.search(new RegExp(`(?:async\\s+)?function ${nextName}\\(`));
  assert.ok(start >= 0 && end > start, `Could not locate ${name}`);
  return source.slice(start, end);
}

function workerHelpers() {
  const context = { URL, URLSearchParams, Request, Response, Headers, AbortController, crypto: require('node:crypto').webcrypto, __apibaraModule: require('../providers/apibara.js'), __providerContract: require('../providers/contract.js'), __authProviderModule: require('../auth/supabase.js'), __accountsModule: require('../auth/routes.js'), __providerBudgetModule: require('../providers/request-budget.js'), console, fetch: async () => { throw new Error('network disabled in unit tests'); }, setTimeout, clearTimeout, setInterval, clearInterval, caches: { default: { match: async () => null, put: async () => {} } } };
  context.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(context);
  vm.runInContext(`${workerSource}\nglobalThis.helpers = { normalizeHistoryRecord, normalizeApibaraHistory: normalizeProviderHistory, normalizeVehicle };`, context);
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
  context.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(context);
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
  assert.match(indexSource, /document\.getElementById\(model\.getAttribute\("list"\)\)\?\.replaceChildren\(\)/, 'changing the make clears stale model suggestions before metadata refresh');
  assert.deepEqual(JSON.parse(JSON.stringify(context.parse.metadataRange(data, ['year']))), { min: 1900, max: 2027 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.parse.metadataRange(data, ['price_usd']))), { min: 0, max: 250000 });

  make.value = 'Rivian';
  context.parse.setMetadataOptions(make, [], 'Wpisz markę ręcznie');
  assert.equal(make.value, 'Rivian', 'metadata outage must not disable manual text entry');
});

test('Home Timed Auction queries and renders timed listings from both supported platforms', async () => {
  const sectionHtml = indexSource.match(/<section class="market-aisle" data-market-aisle data-kind="timed"[^>]*>/)?.[0];
  assert.ok(sectionHtml, 'Home exposes one Timed Auction aisle');
  const query = sectionHtml.match(/data-query="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&');
  assert.equal(query, 'lot_status=Timed', 'Timed Auction is not restricted to IAAI');
  const cars = [
    { platform: 'copart', lot_number: 'C-1', auction: { state: 'open', is_timed: true } },
    { platform: 'iaai', lot_number: 'I-1', auction: { state: 'open', is_timed: true } }
  ];
  const requested = [];
  const target = { innerHTML: '', querySelector: () => null };
  const section = { dataset: { query, kind: 'timed' }, querySelector: () => target };
  const pieces = [
    extractFunctionBlock(indexSource, 'parseConfirmedAuctionDate', 'getConfirmedUpcomingDate'),
    extractFunctionBlock(indexSource, 'marketAisleCars', 'loadMarketAisle'),
    extractFunctionBlock(indexSource, 'loadMarketAisle', 'initMarketAisles')
  ].join('\n');
  const context = {
    URLSearchParams, Date, API_BASE: '/api', homeAisleImageReserves:new WeakMap(),
    updateCatalogCoverage(){}, selectHomeAisleCars:rows=>rows,
    fetch: async url => {
      requested.push(new URL(url, 'https://staging.test'));
      return { ok: true, status: 200, json: async () => ({ ok: true, data: cars }) };
    },
    renderMarketAisleCard: car => car.platform,
    console
  };
  context.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(context);
  vm.runInContext(`${pieces}\nrenderMarketAisleCard=car=>car.platform;globalThis.loadAisle=loadMarketAisle;`, context);
  await context.loadAisle(section);
  assert.equal(requested.length, 1);
  assert.equal(requested[0].searchParams.get('lot_status'), 'Timed');
  assert.equal(requested[0].searchParams.has('platform'), false);
  assert.equal(target.innerHTML, 'copartiaai', 'both Copart and IAAI timed records reach the aisle renderer');
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
  context.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(context);
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
    extractFunctionBlock(carSource, 'confirmedAuctionTimestamp', 'formatAuctionDate'),
    extractFunctionBlock(carSource, 'getAuctionStart', 'getAuctionEnd'),
    extractFunctionBlock(carSource, 'getAuctionEnd', 'auctionPhase'),
    extractFunctionBlock(carSource, 'getAuctionDisplayDate', 'fetchAuctionHistory')
  ].join('\n');
  const noBid = samples.timed_iaai_samples.no_bid;
  const context = { car: noBid, first: (...values) => values.find(value => value !== null && value !== undefined && value !== ''), getSale: () => null, valueFrom: () => null, getAuctionStatus: () => noBid.auction.state };
  context.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(context);
  vm.runInContext(`${dateBlock}\nglobalThis.displayDate = getAuctionDisplayDate;`, context);
  assert.equal(context.displayDate(), noBid.auction.timed_end_at);
  assert.equal(noBid.pricing.current_bid_usd, null);
  assert.equal(noBid.pricing.current_bid2_usd, null);

  const pricingBlock = [extractFunctionBlock(indexSource, 'hasApprovalPendingOutcome', 'getPriceInfo'), extractFunctionBlock(indexSource, 'getPriceInfo', 'getMileage')].join('\n');
  const priceContext = {};
  priceContext.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(priceContext);
  vm.runInContext(`${pricingBlock}\nglobalThis.price = getPriceInfo;`, priceContext);
  const withBid = priceContext.price(samples.timed_iaai_samples.with_bid);
  assert.deepEqual(JSON.parse(JSON.stringify(withBid)), { value: 7400, label: 'Aktualna oferta · Timed Auction' });
  assert.match(dateBlock, /if \(car\.auction\?\.is_timed === true\) return getAuctionEnd\(\) \|\| null/);
  assert.match(dateBlock, /car\.auction\?\.timed_end_at/);

  const statusBlock = [extractFunctionBlock(indexSource, 'parseConfirmedAuctionDate', 'getConfirmedUpcomingDate'), extractFunctionBlock(indexSource, 'hasApprovalPendingOutcome', 'getAuctionStatusLabel'), indexSource.match(/function getAuctionStatusLabel\(car\) \{[\s\S]*?\n  \}/)?.[0]].filter(Boolean).join('\n');
  assert.ok(statusBlock);
  const statusContext = { getAuctionDate: () => '' };
  statusContext.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(statusContext);
  vm.runInContext(`${statusBlock}\nglobalThis.statusLabel = getAuctionStatusLabel;`, statusContext);
  assert.equal(statusContext.statusLabel({ auction: { state: 'open', is_timed: true, timed_end_at: '2020-01-01T00:00:00Z' } }), 'Zakończona');
  assert.equal(statusContext.statusLabel({ auction: { state: 'upcoming', auction_at: null } }), 'Nadchodząca · termin nieustalony');
  assert.equal(statusContext.statusLabel({ auction: { state: 'upcoming', auction_at: '2020-01-01T00:00:00Z' } }), 'Nadchodząca · termin nieustalony', 'an unsupported helper timestamp is not evidence of a missed auction');
});

test('past auction time with only OPEN status is unconfirmed and does not trigger live polling', () => {
  const phaseBlock = extractFunctionBlock(carSource, 'auctionPhase', 'auctionStatusLabel');
  const intervalBlock = extractFunctionBlock(carSource, 'auctionRefreshIntervalMs', 'startAuctionRefresh');
  const context = {
    car: { auction: { state: 'open', auction_at: '2020-01-01T00:00:00Z' } },
    getAuctionStatus: () => 'open',
    getAuctionStart: () => '2020-01-01T00:00:00Z',
    getAuctionEnd: () => null,
    getFinalBid: () => null,
    isEmpty: value => value === null || value === undefined || value === ''
  };
  context.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(context);
  vm.runInContext(`${phaseBlock}\n${intervalBlock}\nglobalThis.phase = auctionPhase; globalThis.refreshMs = auctionRefreshIntervalMs;`, context);
  assert.equal(context.phase(), 'unconfirmed');
  assert.equal(context.refreshMs(context.phase()), null);
});

test('car shipping section reads branch state only from location fields, not the auction state', () => {
  const block = extractFunctionBlock(carSource, 'getBranchState', 'getTitleDocument');
  const context = {
    car: {
      auction: { state: 'finished' },
      location: { display: 'Bridgeport (PA)', state: 'PA' }
    },
    first: (...values) => values.find(value => value !== null && value !== undefined && value !== '') || null,
    displayValue: value => value
  };
  context.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(context);
  vm.runInContext(`${block}\nglobalThis.branchState = getBranchState();`, context);
  assert.equal(context.branchState, 'PA');
  context.car.location = { display: 'Bridgeport' };
  context.car.sale_information = { BranchState: 'CT' };
  vm.runInContext(`globalThis.branchState = getBranchState();`, context);
  assert.equal(context.branchState, 'CT');
  context.car.sale_information = undefined;
  context.car.location = 'Bridgeport (PA)';
  vm.runInContext(`globalThis.branchState = getBranchState();`, context);
  assert.equal(context.branchState, 'PA', 'explicit state suffix in source location can supply the branch state');
  context.car.location = 'Bridgeport';
  vm.runInContext(`globalThis.branchState = getBranchState();`, context);
  assert.equal(context.branchState, null, 'unknown branch state stays unknown instead of borrowing auction state');
});

test('Sold on Approval is pending in list/detail and never becomes confirmed sale pricing', () => {
  const actual = {
    auction: { state: 'finished', outcome_status: 'Sold on Approval', last_sold_status: 'Sold on Approval' },
    pricing: { sale_price_usd: 950, last_sold_price_usd: 950, current_bid_usd: null, buy_now_usd: null }
  };
  const listBlocks = [
    extractFunctionBlock(indexSource, 'parseConfirmedAuctionDate', 'getConfirmedUpcomingDate'),
    extractFunctionBlock(indexSource, 'hasApprovalPendingOutcome', 'getPriceInfo'),
    extractFunctionBlock(indexSource, 'getPriceInfo', 'getAuctionStatusLabel'),
    extractFunctionBlock(indexSource, 'getAuctionStatusLabel', 'getMileage')
  ].join('\n');
  const listContext = { Date, getAuctionDate: () => null };
  listContext.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(listContext);
  vm.runInContext(`${listBlocks}\nglobalThis.price = getPriceInfo; globalThis.status = getAuctionStatusLabel;`, listContext);
  assert.deepEqual(JSON.parse(JSON.stringify(listContext.price(actual))), { value: null, label: 'Cena sprzedaży niepotwierdzona' });
  assert.equal(listContext.status(actual), 'Oferta warunkowa · wynik niepotwierdzony');

  const detailBlocks = [
    extractFunctionBlock(carSource, 'hasApprovalPendingOutcome', 'getAuctionPriceInfo'),
    extractFunctionBlock(carSource, 'getAuctionPriceInfo', 'getAuctionPriceFacts'),
    extractFunctionBlock(carSource, 'getAuctionPriceFacts', 'renderAuctionPriceFactsHtml'),
    extractFunctionBlock(carSource, 'auctionStatusLabel', 'auctionStatusClass')
  ].join('\n');
  const carContext = {
    car: actual,
    auctionPhase: () => 'ended',
    getCurrentBid: () => null,
    getBuyNow: () => null,
    isEmpty: value => value === null || value === undefined || value === '',
    first: (...values) => values.find(value => value !== null && value !== undefined && value !== ''),
    getAuctionStatus: () => actual.auction.state
  };
  carContext.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(carContext);
  vm.runInContext(`${detailBlocks}\nglobalThis.price = getAuctionPriceInfo; globalThis.facts = getAuctionPriceFacts; globalThis.status = auctionStatusLabel;`, carContext);
  assert.deepEqual(JSON.parse(JSON.stringify(carContext.price())), { value: null, label: 'Cena sprzedaży niepotwierdzona' });
  assert.deepEqual(JSON.parse(JSON.stringify(carContext.facts())), []);
  assert.equal(carContext.status(), 'Oferta warunkowa · wynik niepotwierdzony');

  const confirmed = { auction: { state: 'finished', outcome_status: 'Sold' }, pricing: { sale_price_usd: 1200 } };
  assert.equal(listContext.price(confirmed).value, null);
  confirmed.auction.result_confirmed = true;
  assert.deepEqual(JSON.parse(JSON.stringify(listContext.price(confirmed))), { value: 1200, label: 'Cena sprzedaży' });
  assert.equal(listContext.status({ auction: { state: 'finished', outcome_status: 'Not Sold' } }), 'Niesprzedana');
});

test('detail auction UI refresh updates status and prices without a missing DOM-label reference', () => {
  const nodes = new Map([
    ['auctionStatusText', { textContent: '', className: '' }],
    ['auctionStatusHeadline', { innerHTML: '', className: '' }],
    ['currentBidPrice', { textContent: '' }],
    ['bidLabel', { textContent: '' }],
    ['priceFacts', { innerHTML: '', hidden: false }]
  ]);
  const context = {
    car: { auction: { state: 'finished', outcome_status: 'Sold on Approval' } },
    auctionPhase: () => 'ended',
    document: { getElementById: id => nodes.get(id) || null, querySelector: () => null },
    activeV4PriceUpdater: null,
    isEmpty: value => value === null || value === undefined || value === '',
    auctionStatusLabel: () => 'Oferta warunkowa · wynik niepotwierdzony',
    auctionStatusClass: () => 'ended',
    getAuctionPriceInfo: () => ({ value: null, label: 'Cena sprzedaży niepotwierdzona' }),
    money: value => value == null ? '—' : `$${value}`,
    getAuctionPriceFacts: () => [],
    renderAuctionPriceFactsHtml: () => '',
    esc: value => String(value),
    startCountdown: () => {}
  };
  context.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(context);
  const block = extractFunctionBlock(carSource, 'updateAuctionUi', 'refreshAuctionData');
  vm.runInContext(`${block}\nglobalThis.update = updateAuctionUi;`, context);
  assert.doesNotThrow(() => context.update());
  assert.equal(nodes.get('auctionStatusText').textContent, 'Oferta warunkowa · wynik niepotwierdzony');
  assert.equal(nodes.get('currentBidPrice').textContent, 'Brak danych o ofercie');
  assert.equal(nodes.get('bidLabel').textContent, 'Cena sprzedaży niepotwierdzona');
  assert.equal(nodes.get('priceFacts').hidden, true);
});

test('all public product pages use the shared REXBID brand and mobile navigation', () => {
  const pages = ['index.html','car.html','ulubione.html','konto.html','logowanie.html','rejestracja.html','jak-to-dziala.html','kontakt.html','o-nas.html'];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, 'public', page), 'utf8');
    assert.match(html, /rexbid-brand\.css/, `${page} includes shared brand styles`);
    assert.match(html, /rexbid-mobile-nav\.js/, `${page} includes mobile navigation`);
    assert.match(html, /class="logo"[\s\S]{0,140}REX[\s\S]{0,120}BID/i, `${page} has the canonical text logo`);
    assert.doesNotMatch(html, /MTBid|MTBID|mtbid\.pl|kontakt@mtbid/i, `${page} has no visible legacy brand/contact`);
  }
  const mobile = fs.readFileSync(path.join(root, 'public/rexbid-mobile-nav.js'), 'utf8');
  const brand = fs.readFileSync(path.join(root, 'public/rexbid-brand.css'), 'utf8');
  for (const label of ['Aukcje','Jak to działa','Ulubione','Konto','Kontakt']) assert.match(mobile, new RegExp(label));
  assert.match(mobile, /aria-expanded/);
  assert.match(mobile, /RexBidStorage\?\.refreshCounts/);
  assert.match(brand, /background: #0f2030 !important/);
  assert.match(brand, /color: #e43b51 !important/);
  assert.match(brand, /@media \(max-width: 1000px\)/);
});

test('authentication navigation follows the approved REXBID navy and red palette', () => {
  const authClient = fs.readFileSync(path.join(root, 'public/rexbid-auth.js'), 'utf8');
  const sharedBrand = fs.readFileSync(path.join(root, 'public/rexbid-brand.css'), 'utf8');
  const vehiclePage = fs.readFileSync(path.join(root, 'public/car.html'), 'utf8');
  assert.match(sharedBrand, /rexbid-auth-nav a:last-child\{background:#d52c43;color:#fff;border-color:#d52c43\}/);
  assert.doesNotMatch(authClient, /#f4c430/i, 'signup CTA must not retain superseded gold styling');
  assert.doesNotMatch(sharedBrand, /#d9ad57|#fff7df|#5e4614|242,173,36/i, 'shared staging badge and menu states use the red/navy brand palette');
  assert.doesNotMatch(vehiclePage, /#fff7df|#efd276|#f0d783|#d89a12|#efd881|#fff9e8/i, 'vehicle and Buy Now cards no longer use the superseded gold branding treatment');
});

test('legacy root HTML copies and project metadata use REXBID without changing favorite migration keys', () => {
  const legacyPages = ['index.html','car.html','ulubione.html','konto.html','logowanie.html','rejestracja.html','jak-to-dziala.html','kontakt.html','o-nas.html'];
  for (const page of legacyPages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const visibleMarkup = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(visibleMarkup, /MTBid|MTBID|MT\s+Bid|mtbid\.pl|kontakt@mtbid/i, `${page} has no visible legacy brand/contact`);
  }
  const contact = fs.readFileSync(path.join(root, 'kontakt.html'), 'utf8');
  assert.match(contact, /id="inquiryForm"/);
  assert.match(contact, /Przygotowanie treści nie wysyła wiadomości ani nie zleca licytacji/);
  assert.doesNotMatch(contact, /kontakt@(?:mtbid|rexbid)\.pl/, 'contact mailbox must be configured, never guessed from a purchased domain');
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /rexbid-storage\.js/);
  assert.match(fs.readFileSync(path.join(root, 'public/rexbid-storage.js'), 'utf8'), /LEGACY_KEY\s*=\s*['"]mtbid_favorites['"]/);
  assert.equal(require(path.join(root, 'package.json')).name, 'rexbid');
  assert.equal(require(path.join(root, 'package-lock.json')).name, 'rexbid');
});

test('IAAI/Copart seller extraction prefers the full source name, maps INS, and ignores masked placeholders', () => {
  const helpers = workerHelpers();
  const vehicle = helpers.normalizeVehicle({ vin: 'TESTVIN', lot_number: 'LOT-1', platform: 'iaai', ...ownerCases.detail_iaai_seller });
  assert.equal(vehicle.sellerName, 'Progressive Casualty Insurance');
  assert.equal(vehicle.sellerType, 'insurance');
  assert.equal(vehicle.runCondition, 'RUNS AND DRIVES');
  assert.equal(vehicle.hasKey, true);

  const copart = helpers.normalizeVehicle({ vin: 'TESTVIN2', lot_number: 'LOT-2', platform: 'copart', ...ownerCases.detail_copart_seller });
  assert.equal(copart.sellerName, '');
  assert.equal(copart.sellerType, 'non_insurance');
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
  uiContext.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(uiContext);
  vm.runInContext(`${uiBlocks}\nglobalThis.seller = {name:sellerName(),profile:sellerProfile(sellerName())};`, uiContext);
  assert.equal(uiContext.seller.name, 'Progressive Casualty Insurance');
  assert.equal(uiContext.seller.profile.type, 'Insurance');
});

test('seller classification is not presented as a seller name when the source only provides a type', () => {
  const nameBlock = extractFunctionBlock(carSource, 'sellerName', 'platformName');
  const profileBlock = extractFunctionBlock(carSource, 'sellerProfile', 'titleSourceStatus');
  const context = {
    car: { seller: { type: 'Insurance' } },
    valueFrom: () => null,
    findAllByKeys: () => [],
    displayValue: value => value,
    nice: value => String(value),
    isEmpty: value => value === null || value === undefined || value === ''
  };
  context.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(context);
  vm.runInContext(`${nameBlock}\n${profileBlock}\nglobalThis.result={name:sellerName(),profile:sellerProfile(sellerName())}; globalThis.showSeller=sellerDisplay;`, context);
  assert.equal(context.result.name, '');
  assert.match(context.showSeller(context.result.profile), />Typ sprzedającego: Ubezpieczyciel<small>Typ akceptowany przez REXBID/);
  assert.match(context.showSeller(context.result.profile), /class="rex-seller-insurance"/);
  assert.doesNotMatch(context.showSeller(context.result.profile), /Insurance|Nazwa niedostępna/);

  context.car = { seller: { name: 'Progressive Casualty Insurance', type: 'Insurance' } };
  vm.runInContext(`globalThis.named={name:sellerName(),profile:sellerProfile(sellerName())};`, context);
  assert.equal(context.named.name, 'Progressive Casualty Insurance');
  assert.match(context.showSeller(context.named.profile), /Progressive Casualty Insurance/);

  context.car = {seller:{name:null,type:null}};
  vm.runInContext("globalThis.unknownSeller=sellerProfile(sellerName());", context);
  assert.equal(context.showSeller(context.unknownSeller), 'Brak danych o sprzedawcy');
  assert.match(carSource, /<a href="#seller">Sprzedawca<\/a>/);
  assert.match(carSource, /id="seller"[^\n]+\$\{sellerSummary\}/);
  assert.doesNotMatch(carSource, /\$\{sellerInfo\.name \|\| sellerInfo\.type \? `<div[^\n]+id="seller"/);
});

test('title hints combine exact document names with source registration/export flags', () => {
  const block = extractFunctionBlock(carSource, 'titleSourceStatus', 'titleVerdictLabel');
  const context = { car: { sale_document: {} }, displayValue: value => value };
  context.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(context);
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
  context.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(context);
  vm.runInContext(`${block}\nglobalThis.label = runConditionLabel;`, context);
  assert.equal(context.label('RUNS AND DRIVES'), 'RUN & DRIVE');
  assert.equal(context.label('Starts'), 'Odnotowano uruchomienie silnika');
  assert.equal(context.label('Stationary'), 'Uruchomienie niepotwierdzone');
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
  context.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(context);
  vm.runInContext(`${blocks}\nglobalThis.map = {normalizeHistoryRecord,historyStatusLabel,historyStatusClass};`, context);
  const uiApproval = context.map.normalizeHistoryRecord({ ...ownerCases.history.approval, final_price: 9225 });
  assert.equal(uiApproval.final_price, null);
  assert.equal(context.map.historyStatusLabel('Sold on Approval'), 'Oferta warunkowa');
  assert.equal(context.map.historyStatusClass('Sold on Approval'), 'pending');
  assert.equal(context.map.historyStatusLabel('Not Sold'), 'Nie sprzedano');
  assert.equal(context.map.historyStatusClass('Sold'), 'sold');
  assert.equal(context.map.historyStatusLabel('Pending'), 'Wynik niepotwierdzony');
});

test('Buy Now market aisle shows the confirmed Buy Now price and keeps current bid separate', () => {
  const source = extractFunctionBlock(indexSource, 'marketAislePriceInfo', 'renderMarketAisleCard');
  const context = { getPriceInfo: car => ({ value: car.pricing.current_bid_usd, label: 'Aktualna oferta' }), formatMoney: value => '$' + Number(value).toLocaleString('en-US') };
  context.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(context);
  vm.runInContext(source + '\nglobalThis.marketPrice = marketAislePriceInfo;', context);
  const info = context.marketPrice(samples.buy_now_listing_sample, 'buy-now');
  assert.deepEqual(JSON.parse(JSON.stringify(info)), { value: 1000, label: 'Kup teraz', secondary: 'Aktualna oferta · $150' });
  assert.deepEqual(JSON.parse(JSON.stringify(context.marketPrice(samples.buy_now_listing_sample))), { value: 150, label: 'Aktualna oferta', secondary: 'Kup teraz · $1,000' }, 'the default card keeps the bid primary and shows a separate confirmed purchase price');
  assert.deepEqual(JSON.parse(JSON.stringify(context.marketPrice({ auction:{state:'open'}, pricing: { buy_now_usd: 0 } }, 'buy-now'))), { value: null, label: 'Kup teraz', secondary: '' });
  assert.deepEqual(JSON.parse(JSON.stringify(context.marketPrice({ auction:{state:'open'}, pricing: { current_bid_usd: 850, sale_price_usd: 2200 } }, 'timed'))), { value: 850, label: 'Aktualna oferta', secondary: '' });
  assert.deepEqual(JSON.parse(JSON.stringify(context.marketPrice({ pricing: { sale_price_usd: 2200 } }, 'upcoming'))), { value: null, label: 'Brak danych o ofercie', secondary: '' });
  assert.deepEqual(JSON.parse(JSON.stringify(context.marketPrice({ pricing: { buy_now_usd: 0 } }, 'buy-now'))),
    { value: null, label: 'Kup teraz · zapis danych', secondary: '' }, 'missing availability and zero price do not establish a current purchase offer');
  assert.deepEqual(JSON.parse(JSON.stringify(context.marketPrice({auction:{state:'unknown'},read:{source:'d1',freshness:'fresh'},pricing:{current_bid_usd:150,buy_now_usd:1000}},'buy-now'))),
    {value:1000,label:'Kup teraz · zapis danych',secondary:'Ostatnia zapisana oferta · $150'}, 'a fresh observation with unknown availability retains both observed prices without calling either current');
});
test('home catalog uses four bounded sections backed only by supported Worker filters', () => {
  const sections = [...indexSource.matchAll(/<section class="market-aisle" data-market-aisle data-kind="([^"]+)" data-query="([^"]+)"/g)];
  assert.equal(sections.length, 4);
  assert.deepEqual(sections.map(match => match[1]), ['current', 'timed', 'buy-now', 'electric']);
  assert.deepEqual(sections.map(match => match[2]), [
    'lot_sub_status=Open', 'lot_status=Timed', 'lot_status=Buy%20Now', 'fuel_type=Electric'
  ]);
  assert.match(indexSource, /params\.set\("per_page", "24"\)/);
  assert.match(indexSource, /selectHomeAisleCars\(marketAisleCars\(payload, kind, now\), now\)/);
  assert.match(indexSource, /const cards = selected\.slice\(0, 4\)/);
  assert.match(indexSource, /href="\$\{escapeHtml\(href\)\}"/);
  assert.equal((indexSource.match(/class="aisle-more" href="\/?\?catalog=1/g) || []).length, 4);
  assert.doesNotMatch(indexSource, /data-market-filter="upcoming"/);
  const catalogOnly=indexSource.slice(indexSource.indexOf('id="catalogResults"'));
  assert.match(catalogOnly, /data-market-filter="all"/,'all-known catalog choice is explicit');
  assert.doesNotMatch(indexSource.slice(indexSource.indexOf('id="marketSections"'),indexSource.indexOf('id="catalogResults"')), /data-kind="all"/,'Home keeps only four current discovery categories');
  assert.doesNotMatch(indexSource, /data-market-aisle data-kind="upcoming"/);
  assert.match(indexSource, /RexBidMarket\.eligible\(car, kind, now\)/);
  assert.match(indexSource, /Samochody z aukcji w USA\.\s*<span>Sprawdź koszt importu\.<\/span>/);
  assert.match(indexSource, /Wybierz auto na Copart lub IAAI, policz koszt dostawy do Polski/);
  assert.doesNotMatch(indexSource, /Vehicle Auction Marketplace/);
  assert.doesNotMatch(indexSource, /Superauta|Premium|Wyróżnione/);
  assert.match(indexSource, /id="catalogResults"[^>]*hidden/);
  assert.match(indexSource, /params\.get\("catalog"\) === "1" \|\| filterDefinitions\.some/);
  assert.match(indexSource, /if \(catalogMode\)\s*\{\s*prepareFilterSuggestions\(\);\s*restoreCatalogView\(\);\s*\}\s*else initMarketAisles\(\);/);
  assert.match(indexSource, /async function restoreCatalogView\(\)[\s\S]*?if \(restoreCatalogHistory\(\)\) return true;[\s\S]*?await loadCars\(\{updateUrl: false\}\)/);
  assert.doesNotMatch(indexSource, /<h2>Wszystkie aukcje<\/h2>/);
  assert.match(indexSource, /id="loadMoreButton"[\s\S]*?Załaduj więcej/);
  assert.match(indexSource, /vin \? `\/car\?vin=/);
  assert.match(indexSource, /`\/car\?lot=/);
});

test('upcoming aisle only shows source-confirmed future date and never substitutes historical prices', () => {
  const block = extractFunctionBlock(indexSource, 'parseConfirmedAuctionDate', 'getConfirmedUpcomingDate') + extractFunctionBlock(indexSource, 'getConfirmedUpcomingDate', 'marketAisleCars');
  const context = { Date, DateParse: Date.parse };
  context.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(context);
  vm.runInContext(`${block}\nglobalThis.date = getConfirmedUpcomingDate;`, context);
  assert.equal(context.date({ auction: { state: 'upcoming', formatted: '2026-10-01', sale_price_usd: 9000 } }), '', 'display text alone is not treated as a confirmed date');
  assert.match(context.date({ auction: { auction_at: '2099-05-06T12:30:00Z' } }), /06\.05\.2099/);
  assert.equal(context.date({ auction: { state: 'finished', auction_at: '2099-05-06T12:30:00Z' } }), '', 'ended cards never advertise a future auction date');
  assert.equal(context.date({ auction: { state: 'finished', auction_at: '2020-05-06T12:30:00Z' } }), '', 'the upcoming aisle excludes finished listings');
  assert.equal(context.date({ auction: { auction_at: '2000-01-01T00:00:00Z' } }), '');
});

test('home active aisles exclude expired listings and upcoming requires a future confirmed date', () => {
  const block = extractFunctionBlock(indexSource, 'parseConfirmedAuctionDate', 'getConfirmedUpcomingDate') + extractFunctionBlock(indexSource, 'marketAisleCars', 'loadMarketAisle');
  const context = { Date };
  context.RexBidMarket = require("../public/rexbid-market.js"); vm.createContext(context);
  vm.runInContext(`${block}\nglobalThis.pick = marketAisleCars;`, context);
  const now = Date.parse('2026-10-03T12:00:00Z');
  const payload = { data: [
    { lot: 'old-open', auction: { state: 'open', auction_at: '2026-10-02T12:00:00Z' } },
    { lot: 'future-open', auction: { state: 'open', auction_at: '2026-10-04T12:00:00Z' } },
    { lot: 'confirmed-live', auction: { state: 'live', auction_at: '2026-10-02T12:00:00Z' } },
    { lot: 'confirmed-ended', auction: { state: 'ended', auction_at: '2026-10-04T12:00:00Z' } },
    { lot: 'expired-buy-now', auction: { state: 'open', auction_at: '2026-10-02T12:00:00Z', buy_now_usd: 800 } },
    { lot: 'future-buy-now', auction: { state: 'open', auction_at: '2026-10-04T12:00:00Z', buy_now_usd: 900 } },
    { lot: 'expired-timed', auction: { state: 'timed', auction_at: '2026-10-02T12:00:00Z', is_timed: true } },
    { lot: 'future-upcoming', platform:'iaai', auction: { state: 'upcoming', schedule_status:'scheduled', auction_at: '2026-10-04T12:00:00Z' } },
    { lot: 'copart-upcoming-helper-date', platform:'copart', auction: { state: 'upcoming', source_status:'Upcoming', schedule_status:'unassigned', auction_at: '2026-10-04T12:00:00Z' } },
    { lot: 'unknown-date', auction: { state: 'open', buy_now_usd: 500 } }
  ] };
  assert.deepEqual(Array.from(context.pick(payload, 'current', now),car=>car.lot), ['future-open', 'confirmed-live', 'future-buy-now', 'future-upcoming', 'copart-upcoming-helper-date', 'unknown-date']);
  assert.deepEqual(Array.from(context.pick(payload, 'buy-now', now),car=>car.lot), ['future-buy-now', 'unknown-date']);
  assert.deepEqual(Array.from(context.pick(payload, 'timed', now),car=>car.lot), []);
  assert.ok(!context.pick(payload,'current',now).some(car=>car.lot==='old-open'));

});

test('home puts search and aligned primary filters before the four discovery sections, with separated REXBID lockup', () => {
  const filterAt = indexSource.indexOf('class="container filter-section"');
  const aislesAt = indexSource.indexOf('id="marketSections"');
  const catalogAt = indexSource.indexOf('id="catalogResults"');
  assert.ok(filterAt > 0 && filterAt < aislesAt && aislesAt < catalogAt);
  assert.match(indexSource.slice(0, filterAt), /id="searchForm"/,
    'search is integrated into the hero instead of duplicated in the filter panel');
  assert.doesNotMatch(indexSource.slice(filterAt, aislesAt), /id="searchForm"/);
  for (const label of ['Platforma', 'Marka', 'Model', 'Rok od', 'Rok do']) assert.ok(indexSource.slice(filterAt, aislesAt).includes(`>${label}</label>`));
  assert.match(indexSource.slice(filterAt, aislesAt), /id="filterButton"/);
  assert.match(indexSource, /<div class="brand-lockup">[\s\S]*class="logo"[\s\S]*class="brand-note"/);
  assert.match(indexSource, /\.brand-lockup\s*\{[^}]*display:grid/);
  assert.match(indexSource, /\.brand-note\s*\{[^}]*white-space:nowrap/);
});
