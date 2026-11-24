"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {createApibaraProvider, buildRequestUrl, parseChangesResponse,
  validateChangesAfter, validateChangesLimit, ProviderError} = require("../providers/apibara.js");

function change(sequence = 11, overrides = {}) {
  return {
    sequence, event_id: `chg_${sequence}`, event: "bid.changed", terminal: false,
    vehicle: {platform: "copart", lot_number: "12345678", vin: null},
    changed_fields: ["pricing.current_bid_usd"],
    before: {"pricing.current_bid_usd": null}, after: {"pricing.current_bid_usd": 500},
    recorded_at: "2026-10-26T08:00:00Z", ...overrides
  };
}

function batch(data = [change()], overrides = {}) {
  return {ok: true, data, meta: {
    schema_version: "2026-10-04.beta1", after: 10, next_cursor: 11, has_more: true,
    count: data.length, oldest_available_sequence: 1, latest_available_sequence: 1000,
    retention_days: 14, ordering: "sequence_asc", ...overrides
  }};
}

function mockedProvider(reply, extras = {}) {
  const calls = [];
  const logs = [];
  const provider = createApibaraProvider({
    fetch: async (url, options) => { calls.push({url, options}); return typeof reply === "function" ? reply() : new Response(JSON.stringify(reply)); },
    console: Object.fromEntries(["info", "warn", "error"].map(level => [level, (...args) => logs.push(args.join(" "))])),
    ...extras
  });
  return {provider, calls, logs};
}

const invalidResponse = error => error instanceof ProviderError && error.code === "INVALID_RESPONSE";
const invalidRequest = error => error instanceof ProviderError && error.code === "INVALID_REQUEST";

test("changes request permits only after and limit at the fixed provider endpoint", () => {
  const url = buildRequestUrl({operation: "vehicleChanges", after: "9007199254740991", limit: "500",
    url: "https://elsewhere.invalid", params: {make: "BMW", terminal: true}, platform: "iaai"});
  assert.equal(url.origin, "https://apibara.tech");
  assert.equal(url.pathname, "/api/v1/vehicle-auction/changes");
  assert.equal(url.search, "?after=9007199254740991&limit=500");
  assert.equal(buildRequestUrl({operation: "vehicleChanges"}).search, "?after=0&limit=100");
  assert.equal(validateChangesAfter("00012"), 12);
  assert.equal(validateChangesLimit(1), 1);
});

test("changes rejects imprecise or invalid cursors and limits instead of coercing or clamping", () => {
  for (const value of [null, "", " ", "1.0", "1e2", "-1", "1/2", -1, 1.5, Infinity, NaN,
    true, false, [], {}, 9007199254740992, "9007199254740993"]) {
    assert.throws(() => validateChangesAfter(value), invalidRequest, `cursor ${String(value)}`);
  }
  for (const value of [0, -1, 501, 1.5, "1e2", "", null, true, [], Infinity]) {
    assert.throws(() => validateChangesLimit(value), invalidRequest, `limit ${String(value)}`);
  }
});

test("partial patches remain descriptors, preserve explicit null and do not become vehicles", () => {
  const payload = batch([change(11, {after: {"pricing.current_bid_usd": null, "media.photos": []}})]);
  const parsed = parseChangesResponse(payload, {after: 10});
  assert.equal(parsed.nextCursor, 11);
  assert.equal(parsed.latestAvailableSequence, 1000);
  assert.equal(parsed.events[0].platform, "copart");
  assert.equal(parsed.events[0].lotNumber, "12345678");
  assert.equal(parsed.events[0].vin, null);
  assert.equal(parsed.events[0].requiresDetail, true);
  assert.equal(parsed.events[0].terminalOutcome, null);
  assert.deepEqual(parsed.events[0].after, {"pricing.current_bid_usd": null, "media.photos": []});
  assert.equal(Object.hasOwn(parsed.events[0].after, "make"), false);
  assert.equal(Object.hasOwn(parsed.events[0], "raw_payload"), false);
  assert.equal(Object.hasOwn(parsed.events[0], "vehicle"), false);
  parsed.events[0].after["media.photos"].push("changed locally");
  parsed.events[0].changedFields.push("local.field");
  assert.deepEqual(payload.data[0].after["media.photos"], []);
  assert.deepEqual(payload.data[0].changed_fields, ["pricing.current_bid_usd"]);
});

test('Sync Center empty-array maps normalize to empty objects without accepting nonempty arrays',()=>{
  const created=change(11,{event:'lot.created',changed_fields:['lot.created'],before:[],after:{'vehicle.make':'CHEVROLET','pricing.current_bid_usd':null}});
  const parsed=parseChangesResponse(batch([created]),{after:10}).events[0];
  assert.deepEqual(parsed.before,{});assert.deepEqual(parsed.after,created.after);assert.equal(parsed.requiresDetail,true);
  assert.deepEqual(created.before,[]);
  assert.deepEqual(parseChangesResponse(batch([change(11,{after:[]})]),{after:10}).events[0].after,{});
  for(const before of [null,[null],[{}],['x']])assert.throws(()=>parseChangesResponse(batch([change(11,{before})]),{after:10}),invalidResponse);
});

test("lot identity always comes from vehicle and preserves distinct lots sharing a VIN", () => {
  const vin = "1HGCM82633A004352";
  const parsed = parseChangesResponse(batch([
    change(11, {vehicle: {platform: "copart", lot_number: "123", vin}, after: {lot_number: "untrusted-patch"}}),
    change(15, {vehicle: {platform: "iaai", lot_number: "123", vin}})
  ], {next_cursor: 20}), {after: 10});
  assert.deepEqual(parsed.events.map(({platform, lotNumber}) => [platform, lotNumber]), [["copart", "123"], ["iaai", "123"]]);
  assert.equal(parsed.nextCursor, 20);
});

test("terminal outcomes and reasons stay distinct; auction ended alone is not sold", () => {
  for (const outcome of ["sold", "not_sold", "removed"]) {
    const event = parseChangesResponse(batch([change(11, {event: `lot.${outcome}`, terminal: true, reason: "source_outcome"})])).events[0];
    assert.equal(event.terminalOutcome, outcome);
    assert.equal(event.reason, "source_outcome");
    assert.equal(event.requiresDetail, true);
  }
  assert.equal(parseChangesResponse(batch([change(11, {event: "auction.ended"})])).events[0].terminalOutcome, null);
});

test("documented reserve.changed events are accepted despite the beta schema enum omission", () => {
  const event = parseChangesResponse(batch([change(11, {event: "reserve.changed",
    changed_fields: ["pricing.seller_reserve.status"], after: {"pricing.seller_reserve.status": "off"}})])).events[0];
  assert.equal(event.eventType, "reserve.changed");
  assert.equal(event.after["pricing.seller_reserve.status"], "off");
});

test("sequence gaps and empty advancing batches are valid and latest head is independent", () => {
  assert.equal(parseChangesResponse(batch([change(13), change(24)], {next_cursor: 30}), {after: 10}).nextCursor, 30);
  const empty = parseChangesResponse(batch([], {next_cursor: 51, has_more: true}), {after: 10});
  assert.equal(empty.nextCursor, 51);
  assert.equal(empty.latestAvailableSequence, 1000);
  assert.equal(empty.events.length, 0);
  assert.equal(parseChangesResponse(batch([], {next_cursor: 10, has_more: false}), {after: 10}).nextCursor, 10);
  const initial = parseChangesResponse(batch([], {after: 0, next_cursor: 0, oldest_available_sequence: null, latest_available_sequence: null, has_more: false}), {after: 0});
  assert.equal(initial.latestAvailableSequence, null);
  assert.equal(initial.oldestAvailableSequence, null);
  assert.equal(parseChangesResponse(batch([], {after: 1001, next_cursor: 1001, has_more: false}), {after: 1001}).nextCursor, 1001);
});

test("non-monotonic, duplicate and unsafe sequences reject the whole batch", () => {
  for (const events of [
    [change(10)], [change(9)], [change(11), change(11)], [change(15), change(12)],
    [change(11), change(15, {event_id: "chg_11"})], [change(9007199254740992)],
    [change("11")], [change(null)], [change(11.5)], [change(31)]
  ]) assert.throws(() => parseChangesResponse(batch(events, {next_cursor: 30}), {after: 10}), invalidResponse);
});

test("inconsistent pagination metadata rejects without offering a new checkpoint", () => {
  for (const patch of [
    {after: 9}, {after: "10"}, {next_cursor: 9}, {next_cursor: "11"}, {next_cursor: 9007199254740992},
    {latest_available_sequence: 10}, {latest_available_sequence: "1000"}, {oldest_available_sequence: 1001},
    {oldest_available_sequence: -1}, {count: 0}, {count: "1"}, {has_more: "false"},
    {ordering: "sequence_desc"}, {retention_days: 0}, {schema_version: ""}
  ]) assert.throws(() => parseChangesResponse(batch([change()], patch), {after: 10}), invalidResponse);
  assert.throws(() => parseChangesResponse(batch([], {next_cursor: 10, has_more: true}), {after: 10}), invalidResponse);
  assert.throws(() => parseChangesResponse(batch([change(11), change(12)], {next_cursor: 12}), {after: 10, limit: 1}), invalidResponse);
});

test("malformed event identities, event shapes and patches cannot be skipped silently", () => {
  for (const patch of [
    {event_id: ""}, {event: "unknown.event"}, {terminal: true}, {terminal: "false"},
    {event: "lot.removed", terminal: false}, {vehicle: {platform: "other", lot_number: "1"}},
    {vehicle: {platform: "copart", lot_number: 123}}, {vehicle: {platform: "copart", lot_number: ""}},
    {vehicle: {platform: "copart", lot_number: "1", vin: 123}}, {changed_fields: "pricing.bid"},
    {changed_fields: [null]}, {before: null}, {after: [{}]}, {reason: {}},
    {recorded_at: "yesterday"}, {vehicle_updated_at: "invalid-date"}
  ]) assert.throws(() => parseChangesResponse(batch([change(11, patch)])), invalidResponse);
  for (const payload of [null, {}, {ok: false, data: [], meta: {}}, {ok: true, data: {}, meta: {}}, {ok: true, data: []}]) {
    assert.throws(() => parseChangesResponse(payload), invalidResponse);
  }
});

test("fetchChanges uses the budgeted GET transport and produces validated reconciliation descriptors", async () => {
  const budgetCalls = [];
  let finished = 0;
  const {provider, calls} = mockedProvider(batch(), {requestBudget: {begin: async (_env, spec) => {
    budgetCalls.push(spec); return {finish: async () => finished++};
  }}});
  const result = await provider.fetchChanges({APIBARA_API_KEY: "test-secret"}, {after: 10, limit: 500, budgetClass: "catalog"});
  assert.equal(result.events[0].eventId, "chg_11");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://apibara.tech/api/v1/vehicle-auction/changes?after=10&limit=500");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(calls[0].options.headers["X-API-Key"], "test-secret");
  assert.equal(budgetCalls[0].budgetClass, "catalog");
  assert.equal(finished, 1);
  assert.equal(provider.capabilities.includes("vehicle.changes"), true);
});

test("generic request retains the original provider envelope for the changes operation", async () => {
  const payload = batch();
  const {provider} = mockedProvider(payload);
  assert.deepEqual(await provider.request({APIBARA_API_KEY: "test"}, {operation: "vehicleChanges", after: 10}), payload);
});

test("invalid request inputs are blocked before budget reservation and network", async () => {
  let reservations = 0;
  const {provider, calls} = mockedProvider(batch(), {requestBudget: async () => reservations++});
  await assert.rejects(provider.fetchChanges({APIBARA_API_KEY: "test"}, {after: "9007199254740993"}), invalidRequest);
  await assert.rejects(provider.fetchChanges({APIBARA_API_KEY: "test"}, {limit: 501}), invalidRequest);
  assert.equal(calls.length, 0);
  assert.equal(reservations, 0);
});

test("changes budget denial causes no network call", async () => {
  const {provider, calls} = mockedProvider(batch(), {requestBudget: async () => {
    throw Object.assign(new Error("limited"), {code: "RATE_LIMITED", status: 429});
  }});
  await assert.rejects(provider.fetchChanges({APIBARA_API_KEY: "test"}), error => error.code === "RATE_LIMITED");
  assert.equal(calls.length, 0);
});

test("410 becomes CURSOR_EXPIRED only on changes without exposing response bodies", async () => {
  const secret = "PRIVATE_KEY_FOR_CHANGES";
  const {provider, logs} = mockedProvider(() => new Response(JSON.stringify({ok: false, error: "cursor_expired", message: secret}), {status: 410}));
  await assert.rejects(provider.fetchChanges({APIBARA_API_KEY: secret}, {after: 10}), error => {
    assert.equal(error.code, "CURSOR_EXPIRED");
    assert.equal(error.status, 410);
    assert.equal(error.retryAfter, null);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
  await assert.rejects(provider.fetchVehicle({APIBARA_API_KEY: secret}, "123"), error => error.code === "UPSTREAM");
  assert.equal(logs.join("\n").includes(secret), false);
  assert.ok(logs.some(line => line.includes('"safe_error_code":"CURSOR_EXPIRED"')));
});

test("429 and malformed JSON/shape retain controlled transport errors", async () => {
  const rateLimited = mockedProvider(() => new Response("private response", {status: 429, headers: {"Retry-After": "30"}}));
  await assert.rejects(rateLimited.provider.fetchChanges({APIBARA_API_KEY: "test"}), error => error.code === "RATE_LIMITED" && error.retryAfter === 30);
  for (const reply of [() => new Response("not JSON"), () => new Response(JSON.stringify(batch([change(10)])))]) {
    const {provider, logs} = mockedProvider(reply);
    await assert.rejects(provider.fetchChanges({APIBARA_API_KEY: "test"}, {after: 10}), invalidResponse);
    assert.ok(logs.some(line => line.includes('"outcome":"error"') && line.includes('"safe_error_code":"INVALID_RESPONSE"')));
  }
});
