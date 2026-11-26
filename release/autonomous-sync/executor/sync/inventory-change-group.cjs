'use strict';

// Pure per-vehicle reducer for a verified local change index. Every event is
// still evaluated, in order, by the existing strict partial-update planner.
// A caller must atomically persist the original-row guard, optional UPDATE,
// durable reconciliation work and its FILE checkpoint. No global cursor here.
const {prepareInventoryChangePatch, BASELINE_FIELDS} = require('./inventory-change-patch.cjs');
const {parseChangesResponse} = require('../providers/apibara.js');
const {updateEvidence} = require('./timed-bid-evidence.cjs');
const {lateBidObservation} = require('./timed-bid-history.cjs');
const {confirmedTimedSale} = require('./timed-sale-result.cjs');
const SAFE_ERRORS = new Set(['INVENTORY_CHANGE_PATCH_INVALID', 'INVENTORY_CHANGE_IDENTITY_CONFLICT',
  'INVENTORY_CHANGE_TIME_INVALID', 'INVENTORY_CHANGE_BASELINE_INVALID']);

const ELIGIBILITY_FIELDS=['auction.state','auction.lot_sub_status','auction.outcome_status','auction.lot_removed'];
const touchesEligibility=event=>event.terminal||event.eventType==='auction.ended'||ELIGIBILITY_FIELDS.some(k=>(Object.hasOwn(event.after,k)||event.changedFields.includes(k))&&(k!=='auction.lot_removed'||!Object.hasOwn(event.after,k)||event.after[k]===true||event.after[k]===1));

// IAAI sends this explicit result-reset bundle when a previously ended lot is
// rescheduled. Verified against the full source records for 46208127,46509823,
// 46608761. A future date alone, a price alone, or a sold/removed event cannot
// reopen anything. Retained source receipts remain unchanged.
function iaaiRescheduledReset(event,row,observedAt){
 const a=event.after,allowed=['auction.auction_at','auction.is_buy_now','pricing.buy_now_usd','auction.has_status','auction.last_sold_day','auction.last_sold_status','pricing.last_sold_price_usd','auction.auction_date_pending'];
 if(event.platform!=='iaai'||event.eventType!=='auction.rescheduled'||event.terminal||row?.auction_state!=='ended'||row.source_status!=='Ended'
  ||Object.keys(a).some(k=>!allowed.includes(k))||event.changedFields.some(k=>!allowed.includes(k))
  ||a['auction.has_status']!==0||a['auction.auction_date_pending']!==false||![1,true].includes(a['auction.is_buy_now'])
  ||!Number.isFinite(a['pricing.buy_now_usd'])||a['pricing.buy_now_usd']<=0
  ||!['auction.last_sold_day','auction.last_sold_status','pricing.last_sold_price_usd'].every(k=>Object.hasOwn(a,k)&&a[k]===null)
  ||!(Date.parse(a['auction.auction_at'])>Date.parse(observedAt)))return event;
 const after={'auction.state':'open','auction.lot_sub_status':'Open','auction.auction_at':a['auction.auction_at'],'auction.is_buy_now':a['auction.is_buy_now'],'pricing.buy_now_usd':a['pricing.buy_now_usd']};
 return{...event,after,changedFields:Object.keys(after),before:Object.fromEntries(Object.entries(event.before).filter(([k])=>Object.hasOwn(after,k)))};
}

function rescheduledRegularSession(event, row, observedAt) {
  const dateField = 'auction.auction_at', pendingField = 'auction.auction_date_pending';
  if (event.platform !== 'iaai' || event.eventType !== 'auction.rescheduled' || event.terminal
      || row?.auction_state !== 'live' || row.is_timed !== 0 || row.timed_end_at != null
      || !['in_progress','awaiting_auction','live','in progress','running','started'].includes(String(row.source_status).toLowerCase())
      || !event.changedFields.includes(dateField) || event.after[pendingField] !== false || event.before[pendingField] !== false
      || [...Object.keys(event.after), ...event.changedFields].some(key=>key!==dateField && key!==pendingField)) return event;
  const oldDate = Date.parse(event.before[dateField]), newDate = Date.parse(event.after[dateField]);
  const knownDate = Date.parse(row.auction_at), observed = Date.parse(observedAt);
  if (!(oldDate <= Date.parse(event.recordedAt) && newDate > observed + 30*60_000)
      || (row.auction_at != null && knownDate !== oldDate && knownDate !== newDate)) return event;
  // Only reconcile the previous regular session label. Keep the original
  // event for membership, pricing, evidence and checkpoint processing.
  return {...event, after:{...event.after,'auction.state':'open'}};
}

function retainCurrentSessionTiming(plan, event, row) {
  if (plan.status !== 'patch' || plan.requiresDetail || plan.assignments.auction_state !== 'live'
      || row.auction_state !== 'open' || event.terminal || event.eventType !== 'lot.updated'
      || !['open','scheduled','timed','timed auction'].includes(String(row.source_status).toLowerCase())
      || [...Object.keys(event.after), ...event.changedFields].some(key=>key!=='auction.state' && key!=='auction.lot_sub_status')) return;
  // A state-only update neither reschedules a regular session nor disables a Timed deadline.
  const at=Date.parse(event.recordedAt);
  if (row.is_timed === 1 && Date.parse(row.timed_end_at) > at) {
    delete plan.assignments.is_timed;
    delete plan.assignments.timed_end_at;
  } else if (row.is_timed === 0 && row.timed_end_at == null && /T.*(?:Z|[+-]\d\d:\d\d)$/i.test(row.auction_at || '')) {
    const age=at-Date.parse(row.auction_at);
    if (age >= -30*60_000 && age < 3*3_600_000) delete plan.assignments.auction_at;
  }
}

function planInventoryChangeGroup({row = null, events, observedAt, quarantinedSequences = [], trackTimedBid = false} = {}) {
  if (!Array.isArray(events) || !events.length || events.length > 100000
      || !Array.isArray(quarantinedSequences)) throw Error('INVENTORY_GROUP_INVALID');
  const first = events[0], platform = first.vehicle?.platform, lot = first.vehicle?.lot_number;
  if (!['copart', 'iaai'].includes(platform) || !/^\d{1,20}$/.test(lot || '')) throw Error('INVENTORY_GROUP_IDENTITY_INVALID');
  const quarantined = new Set(quarantinedSequences), seen = new Set(), reasons = new Set();
  let previous = 0, virtual = row && {...row}, match = null, baseline = null, patches = 0, ignored = 0, requiresDetail = false, identityError = false, acceptedEligibility = null;
  let bidEvidence = row?.timed_bid_evidence;
  const lateBids = [];
  const timedSales = [];
  for (const raw of events) {
    if (raw.vehicle?.platform !== platform || raw.vehicle?.lot_number !== lot
        || !Number.isSafeInteger(raw.sequence) || raw.sequence <= previous || seen.has(raw.event_id)) throw Error('INVENTORY_GROUP_ORDER_INVALID');
    seen.add(raw.event_id);
    if (quarantined.has(raw.sequence)) {
      requiresDetail = true; identityError = true; reasons.add('quarantined_identity'); previous = raw.sequence; continue;
    }
    let event = parseChangesResponse({ok: true, data: [raw], meta: {after: previous, next_cursor: raw.sequence,
      has_more: false, count: 1, ordering: 'sequence_asc', schema_version: 'local-group', retention_days: 14}}, {after: previous, limit: 1}).events[0];
    event=iaaiRescheduledReset(event,virtual,observedAt);
    previous = raw.sequence;
    if (!virtual && event.terminal) {ignored++; continue;}
    let plan;
    try {plan = prepareInventoryChangePatch({row: virtual, change: rescheduledRegularSession(event,virtual,observedAt), observedAt});}
    catch (error) {
      if (!SAFE_ERRORS.has(error.message)) throw error;
      reasons.add(error.message); requiresDetail = true;
      if(touchesEligibility(event))acceptedEligibility={sequence:event.sequence,active:null,state:null,reason:'eligibility_invalid'};
      if (['INVENTORY_CHANGE_IDENTITY_CONFLICT', 'INVENTORY_CHANGE_BASELINE_INVALID'].includes(error.message)) identityError = true;
      continue;
    }
    retainCurrentSessionTiming(plan,event,virtual);
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
      if (trackTimedBid) {
        const cycle = raw.auction_id ?? raw.record?.auction?.auction_id;
        if (event.eventType==='lot.sold'&&event.terminal&&plan.assignments.auction_state==='ended'&&plan.assignments.source_status==='Sold') {
          const result=confirmedTimedSale({...virtual,timed_bid_evidence:bidEvidence},raw);
          if(result)timedSales.push(result);
        }
        if (Object.hasOwn(plan.assignments,'current_bid_usd') && plan.assignments.current_bid_usd > 0) {
          const observation = lateBidObservation({...virtual,timed_bid_evidence:bidEvidence}, event, cycle);
          if (observation) lateBids.push(observation);
        }
        bidEvidence = updateEvidence(virtual, event, plan, bidEvidence, cycle);
      }
      match ??= plan.match; baseline ??= plan.baseline;
      virtual = {...virtual, ...plan.assignments}; patches++;
    } else if (plan.status === 'ignored') ignored++;
  }
  // A bad/mismatched identity anywhere quarantines the entire vehicle group.
  // Never persist an earlier price from a group that subsequently conflicts.
  const assignments = !identityError && row && virtual
    ? Object.fromEntries(BASELINE_FIELDS.filter(key => row[key] !== virtual[key]).map(key => [key, virtual[key]])) : {};
  // Extend an existing canonical UPDATE only. The same receipt transaction advances the cursor.
  if (trackTimedBid && Object.keys(assignments).length && Object.hasOwn(row,'timed_bid_evidence') && bidEvidence!==row.timed_bid_evidence) {
    assignments.timed_bid_evidence=bidEvidence;
  }
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
    ...(!identityError && lateBids.length ? {lateBidObservations:lateBids} : {}),
    ...(!identityError && timedSales.length ? {confirmedTimedSales:timedSales} : {}),
    databaseApplied: false, globalCursorEstablished: false};
}

module.exports = {planInventoryChangeGroup};
