'use strict';

// Pure per-vehicle reducer for a verified local change index. Every event is
// still evaluated, in order, by the existing strict partial-update planner.
// A caller must atomically persist the original-row guard, optional UPDATE,
// durable reconciliation work and its FILE checkpoint. No global cursor here.
const {prepareInventoryChangePatch, BASELINE_FIELDS} = require('./inventory-change-patch.cjs');
const {parseChangesResponse} = require('../providers/apibara.js');
const SAFE_ERRORS = new Set(['INVENTORY_CHANGE_PATCH_INVALID', 'INVENTORY_CHANGE_IDENTITY_CONFLICT',
  'INVENTORY_CHANGE_TIME_INVALID', 'INVENTORY_CHANGE_BASELINE_INVALID']);

const ELIGIBILITY_FIELDS=['auction.state','auction.lot_sub_status','auction.outcome_status','auction.lot_removed'];
const touchesEligibility=event=>event.terminal||event.eventType==='auction.ended'||ELIGIBILITY_FIELDS.some(k=>(Object.hasOwn(event.after,k)||event.changedFields.includes(k))&&(k!=='auction.lot_removed'||!Object.hasOwn(event.after,k)||event.after[k]===true||event.after[k]===1));

function planInventoryChangeGroup({row = null, events, observedAt, quarantinedSequences = []} = {}) {
  if (!Array.isArray(events) || !events.length || events.length > 100000
      || !Array.isArray(quarantinedSequences)) throw Error('INVENTORY_GROUP_INVALID');
  const first = events[0], platform = first.vehicle?.platform, lot = first.vehicle?.lot_number;
  if (!['copart', 'iaai'].includes(platform) || !/^\d{1,20}$/.test(lot || '')) throw Error('INVENTORY_GROUP_IDENTITY_INVALID');
  const quarantined = new Set(quarantinedSequences), seen = new Set(), reasons = new Set();
  let previous = 0, virtual = row && {...row}, match = null, baseline = null, patches = 0, ignored = 0, requiresDetail = false, identityError = false, acceptedEligibility = null;
  for (const raw of events) {
    if (raw.vehicle?.platform !== platform || raw.vehicle?.lot_number !== lot
        || !Number.isSafeInteger(raw.sequence) || raw.sequence <= previous || seen.has(raw.event_id)) throw Error('INVENTORY_GROUP_ORDER_INVALID');
    seen.add(raw.event_id);
    if (quarantined.has(raw.sequence)) {
      requiresDetail = true; identityError = true; reasons.add('quarantined_identity'); previous = raw.sequence; continue;
    }
    const event = parseChangesResponse({ok: true, data: [raw], meta: {after: previous, next_cursor: raw.sequence,
      has_more: false, count: 1, ordering: 'sequence_asc', schema_version: 'local-group', retention_days: 14}}, {after: previous, limit: 1}).events[0];
    previous = raw.sequence;
    if (!virtual && event.terminal) {ignored++; continue;}
    let plan;
    try {plan = prepareInventoryChangePatch({row: virtual, change: event, observedAt});}
    catch (error) {
      if (!SAFE_ERRORS.has(error.message)) throw error;
      reasons.add(error.message); requiresDetail = true;
      if(touchesEligibility(event))acceptedEligibility={sequence:event.sequence,active:null,state:null,reason:'eligibility_invalid'};
      if (['INVENTORY_CHANGE_IDENTITY_CONFLICT', 'INVENTORY_CHANGE_BASELINE_INVALID'].includes(error.message)) identityError = true;
      continue;
    }
    if (plan.requiresDetail) {requiresDetail = true; reasons.add(plan.reason);}
    // Eligibility evidence follows the same stale/version/identity decisions as
    // canonical patches. Equal fresh Open/Live is still evidence; stale Open is
    // not. It adds no write or change to the legacy assignments.
    if(touchesEligibility(event)&&!['older_observation','older_source_version','already_applied_sequence'].includes(plan.reason)){
      const unsupported=plan.unsupportedFields?.some(k=>ELIGIBILITY_FIELDS.includes(k));
      const candidate={...virtual,...plan.assignments};
      // A repeated, identity-valid terminal can leave an already-ended row
      // unchanged while unrelated outcome fields still need detail. Preserve
      // that terminal evidence without accepting unsupported eligibility fields.
      const terminalUnchanged=event.terminal===true
        &&['lot.sold','lot.not_sold','lot.removed','auction.ended'].includes(event.eventType)
        &&virtual?.auction_state==='ended'&&plan.status==='requires_detail'&&plan.reason==='unsupported_fields'
        &&Array.isArray(plan.unsupportedFields)&&plan.unsupportedFields.length>0&&!unsupported;
      const accepted=plan.status==='patch'||plan.status==='ignored'&&plan.reason==='no_material_change'||terminalUnchanged;
      const state=accepted&&!unsupported?candidate.auction_state:null;
      acceptedEligibility={sequence:event.sequence,active:state===null||state==='unknown'?null:['open','live'].includes(state),
        state:state??null,reason:accepted&&!unsupported?'supported_state':'eligibility_unresolved'};
    }
    if (plan.status === 'patch') {
      match ??= plan.match; baseline ??= plan.baseline;
      virtual = {...virtual, ...plan.assignments}; patches++;
    } else if (plan.status === 'ignored') ignored++;
  }
  // A bad/mismatched identity anywhere quarantines the entire vehicle group.
  // Never persist an earlier price from a group that subsequently conflicts.
  const assignments = !identityError && row && virtual
    ? Object.fromEntries(BASELINE_FIELDS.filter(key => row[key] !== virtual[key]).map(key => [key, virtual[key]])) : {};
  const columns = Object.keys(assignments), prefix = 'SELECT listing_id FROM auction_listings WHERE ';
  let statement = null;
  if (columns.length) {
    if (!match?.sql.startsWith(prefix)) throw Error('INVENTORY_GROUP_PLAN_INVALID');
    statement = {sql: `UPDATE auction_listings SET ${columns.map(key => `${key}=?`).join(',')} WHERE ${match.sql.slice(prefix.length)}`,
      params: [...Object.values(assignments), ...match.params]};
  }
  return {platform, lot, firstSequence: first.sequence, lastSequence: previous, eventCount: events.length,
    patches, ignored, identityError, requiresDetail, reasons: [...reasons].sort(),
    acceptedEligibility:identityError?null:acceptedEligibility,
    assignments, statement, match: identityError ? null : match, baseline: identityError ? null : baseline,
    databaseApplied: false, globalCursorEstablished: false};
}

module.exports = {planInventoryChangeGroup};
