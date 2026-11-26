'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {exactLotDetailSpec, exactLotRecoveryOperation} = require('../scripts/catalog-exact-lot-request-20261020.cjs');
const {buildRequestUrl} = require('../providers/apibara.js');
const {checkDetail} = require('../scripts/catalog-refresh-campaign.cjs');
const target = Object.freeze({listing_id: 'listing|apibara|copart|source|41650896',
  platform: 'copart', lot: '41650896', vin_normalized: '5FNYF5H44KB017040',
  provider_vehicle_id: '2019-honda-pilot-exl-5FNYF5H44KB017040'});
const previous = Object.freeze({campaignId: 'improvement-20261020',
  key: 'detail:prior-target-digest', status: 'rejected', code: 'CATALOG_DETAIL_IDENTITY_MISMATCH'});

test('exact LOT overrides a VIN slug without changing the frozen target', () => {
  assert.deepEqual(exactLotDetailSpec(target), {operation: 'vehicleByIdentifier',
    identifier: '41650896', platform: 'copart', include: 'history,vin_lots'});
  assert.equal(target.provider_vehicle_id, '2019-honda-pilot-exl-5FNYF5H44KB017040');
  assert.equal(target.lot, '41650896');
});

test('the adapter sends canonical LOT and documented include without an invented platform query', () => {
  const spec = exactLotDetailSpec({...target, platform: 'iaai', lot: '46196106'});
  const url = new URL(buildRequestUrl(spec));
  assert.equal(url.pathname, '/api/v1/vehicle-auction/vehicles/46196106');
  assert.deepEqual([...url.searchParams], [['include', 'history,vin_lots']]);
  assert.equal(spec.platform, 'iaai');
});

test('missing, masked and short VIN do not fabricate a request identifier', () => {
  for (const vin_normalized of [null, '5FNYF5H44K******', '06132068']) {
    assert.equal(exactLotDetailSpec({...target, vin_normalized}).identifier, target.lot);
  }
});

test('invalid identities and noncanonical LOT values fail before any transport', () => {
  for (const lot of ['', null, 41650896, '4165089', '141650896', '111046045959',
    '41650896?x=1', '../41650896', ' 41650896']) {
    assert.throws(() => exactLotDetailSpec({...target, lot}), /LOT_RECOVERY_TARGET_INVALID/);
  }
  for (const platform of ['COPART', 'unknown', null]) {
    assert.throws(() => exactLotDetailSpec({...target, platform}), /LOT_RECOVERY_TARGET_INVALID/);
  }
  assert.throws(() => exactLotDetailSpec({...target, listing_id: ''}), /LOT_RECOVERY_TARGET_INVALID/);
  assert.throws(() => exactLotDetailSpec(target, {includeHistory: 'false'}), /LOT_RECOVERY_TARGET_INVALID/);
});

test('history can be explicitly omitted and zero-prefixed canonical LOT stays unchanged', () => {
  assert.deepEqual(exactLotDetailSpec({...target, lot: '01650896'}, {includeHistory: false}),
    {operation: 'vehicleByIdentifier', identifier: '01650896', platform: 'copart'});
});

test('recovery has a stable separate operation key and preserves original rejection evidence', () => {
  const a = exactLotRecoveryOperation(target, previous);
  const b = exactLotRecoveryOperation(target, previous);
  assert.deepEqual(a, b);
  assert.match(a.key, /^detail-lot-recovery:v1:[a-f0-9]{64}$/);
  assert.notEqual(a.key, previous.key);
  assert.deepEqual(a.origin, previous);
  assert.notEqual(a.origin, previous);
});

test('recovery identity and prior campaign evidence are bound to the operation key', () => {
  const original = exactLotRecoveryOperation(target, previous).key;
  for (const patch of [{platform: 'iaai'}, {lot: '41650897'}, {vin_normalized: null},
    {listing_id: 'another-listing'}]) {
    assert.notEqual(exactLotRecoveryOperation({...target, ...patch}, previous).key, original);
  }
  for (const patch of [{key: 'detail:other'}, {campaignId: 'legacy-20261008'}]) {
    assert.notEqual(exactLotRecoveryOperation(target, {...previous, ...patch}).key, original);
  }
});

test('only identity rejection or source NOT_FOUND is eligible for this recovery phase', () => {
  assert.ok(exactLotRecoveryOperation(target, {...previous, status: 'failed', code: 'NOT_FOUND'}));
  for (const patch of [{status: 'committed'}, {status: 'failed'}, {code: 'PLATFORM_LOT_VIN_MISMATCH'},
    {code: 'RATE_LIMITED'}, {campaignId: ''}, {campaignId: '../other'}, {key: ''}, {key: 'x\n'}]) {
    assert.throws(() => exactLotRecoveryOperation(target, {...previous, ...patch}), /LOT_RECOVERY_ORIGIN_INVALID/);
  }
});

test('unchanged response guard still rejects other LOT, platform and conflicting full or masked VIN', () => {
  const raw = {platform: target.platform, lot_number: target.lot, vin: target.vin_normalized};
  assert.equal(checkDetail(raw, target), target.vin_normalized);
  for (const patch of [{lot_number: '75095175'}, {platform: 'iaai'}, {vin: '5FNYF5H44KB017041'}]) {
    assert.throws(() => checkDetail({...raw, ...patch}, target), /CATALOG_DETAIL_IDENTITY_MISMATCH/);
  }
  const masked = {...target, vin_normalized: '5FNYF5H44KB0*****'};
  assert.equal(checkDetail(raw, masked), raw.vin);
  assert.throws(() => checkDetail({...raw, vin: '5FNYF5H44KC017040'}, masked), /CATALOG_DETAIL_IDENTITY_MISMATCH/);
});
