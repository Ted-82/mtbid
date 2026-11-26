'use strict';

// Pure request planning for a separately journaled recovery. No transport,
// persistence, retry, credentials, or changes to the original campaign.
// The saved official Apibara OpenAPI 1.1.0 accepts canonical LOT in
// /vehicles/{slugVin}. It does not document a platform query on this route.
// platform below remains the expected identity for the existing response guard.
const {createHash} = require('node:crypto');
const {detailSpec} = require('./catalog-refresh-campaign.cjs');

function exactLotDetailSpec(target, {includeHistory = true} = {}) {
  if (!target || typeof target.listing_id !== 'string' || !target.listing_id
      || typeof target.lot !== 'string' || !/^\d{8}$/.test(target.lot)
      || !['copart', 'iaai'].includes(target.platform)
      || typeof includeHistory !== 'boolean') throw Error('LOT_RECOVERY_TARGET_INVALID');
  // Supply the already stored canonical LOT. Do not manufacture a provider
  // slug or promote a vin_lots summary to a verified detail response.
  return detailSpec({...target, provider_vehicle_id: target.lot}, {includeHistory});
}

function exactLotRecoveryOperation(target, previous) {
  const eligible = previous?.status === 'rejected'
      && previous.code === 'CATALOG_DETAIL_IDENTITY_MISMATCH'
    || previous?.status === 'failed' && previous.code === 'NOT_FOUND';
  if (!eligible || !/^[a-zA-Z0-9_-]{1,100}$/.test(previous.campaignId || '')
      || typeof previous.key !== 'string' || !previous.key || previous.key.length > 500
      || /[\u0000-\u001f]/.test(previous.key)) throw Error('LOT_RECOVERY_ORIGIN_INVALID');
  const spec = exactLotDetailSpec(target);
  const origin = {campaignId: previous.campaignId, key: previous.key,
    status: previous.status, code: previous.code};
  const fingerprint = createHash('sha256').update(JSON.stringify({target, origin, spec})).digest('hex');
  // A new operation cannot reuse or erase the previous committed rejection.
  // The caller must execute this key through its normal durable budget/journal
  // and retain checkDetail(raw, target), observation and history write guards.
  return {key: 'detail-lot-recovery:v1:' + fingerprint, spec, origin};
}

module.exports = {exactLotDetailSpec, exactLotRecoveryOperation};
