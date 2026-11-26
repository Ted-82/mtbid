'use strict';

// Offline public catalog transfer planning. The caller executes each group as
// one atomic D1 batch and records its hash only after a successful readback.
const {createHash} = require('node:crypto');
const {buildPublicCatalogSnapshot, PUBLIC_COLUMNS} = require('./public-catalog-snapshot.cjs');
const TABLES = Object.freeze(Object.keys(PUBLIC_COLUMNS));
const VOLATILE = new Set(['current_bid_usd','current_bid2_usd','buy_now_usd','final_price_usd','source_price_usd','auction_state','source_status','auction_at','is_timed','timed_end_at']);
const IMMUTABLE = new Set(['listing_id','source_key','platform','listing_identity_kind','source_listing_id','listing_generation','lot','first_seen_at','created_at']);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalizedVin = value => String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g,'');
const fullVin = value => /^[A-HJ-NPR-Z0-9]{17}$/.test(normalizedVin(value)) ? normalizedVin(value) : null;
const lotKey = row => JSON.stringify([row.platform,String(row.lot).trim().toUpperCase()]);
const observation = row => row.summary_synced_at || row.last_seen_at;
const snapshotKey = row => JSON.stringify([row.listing_id,row.observed_at,row.fingerprint]);
const comparable = (row, columns) => columns.map(column => row[column] ?? null);
function fail(code) {throw new TypeError(code);}

function selected(input, capturedAt) {
  if (!input?.tables || TABLES.some(table => !Array.isArray(input.tables[table]))) fail('PUBLIC_MERGE_FOUR_TABLES_REQUIRED');
  const plan = buildPublicCatalogSnapshot({...input,capturedAt});
  const tables = Object.fromEntries(TABLES.map(table => [table,[]]));
  for (const item of plan.statements) if (Object.hasOwn(tables,item.table)) {
    tables[item.table].push(Object.fromEntries(item.columns.map((column,index) => [column,item.params[index]])));
  }
  return {tables,manifest:plan.manifest};
}

function schemaNames(columns,table) {
  if (!Array.isArray(columns?.[table])) fail('PUBLIC_MERGE_TARGET_SCHEMA_REQUIRED');
  return new Set(columns[table].map(item => typeof item === 'string' ? item : item?.name));
}

function insert(table,row) {
  const columns=Object.keys(row);
  return {table,columns,sql:`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`,params:columns.map(column=>row[column])};
}

function sourceStatement(row) {
  const item=insert('vehicle_sources',row);
  const keep=new Set(['source_key','provider','platform','entity_id','first_seen_at','created_at']);
  const assignments=item.columns.filter(column=>!keep.has(column)).map(column=>`${column}=COALESCE(excluded.${column},vehicle_sources.${column})`);
  item.sql += ` ON CONFLICT(source_key) DO UPDATE SET ${assignments.join(',')}
    WHERE excluded.provider=vehicle_sources.provider AND excluded.platform=vehicle_sources.platform
      AND julianday(excluded.last_seen_at)>=julianday(vehicle_sources.last_seen_at)
      AND (excluded.source_updated_at IS NULL OR vehicle_sources.source_updated_at IS NULL
        OR julianday(excluded.source_updated_at)>=julianday(vehicle_sources.source_updated_at))`;
  return item;
}

function listingStatement(row) {
  const item=insert('auction_listings',row);
  // Empty values in a full public listing are explicit volatile observations.
  // Other missing enrichment may retain a richer staging description/media.
  const assignments=item.columns.filter(column=>!IMMUTABLE.has(column)).map(column=>{
    // Discovery receipt time does not refresh details. Keep the newest actual
    // detail receipt even when a newer summary contains an older detail clock.
    if(column==='detail_synced_at')return `detail_synced_at=CASE
      WHEN excluded.detail_synced_at IS NULL THEN auction_listings.detail_synced_at
      WHEN auction_listings.detail_synced_at IS NULL OR julianday(excluded.detail_synced_at)>=julianday(auction_listings.detail_synced_at)
        THEN excluded.detail_synced_at ELSE auction_listings.detail_synced_at END`;
    return `${column}=${VOLATILE.has(column) ? `excluded.${column}` : `COALESCE(excluded.${column},auction_listings.${column})`}`;
  });
  const values=item.params;
  item.sql=`INSERT INTO auction_listings (${item.columns.join(',')}) SELECT ${item.columns.map(()=>'?').join(',')}
    WHERE EXISTS(SELECT 1 FROM vehicle_sources WHERE source_key=? AND provider='apibara' AND platform=?)
      AND NOT EXISTS(SELECT 1 FROM auction_listings WHERE platform=? AND upper(trim(lot))=upper(trim(?)) AND listing_id<>?)
    ON CONFLICT(listing_id) DO UPDATE SET ${assignments.join(',')}
    WHERE excluded.source_key=auction_listings.source_key AND excluded.platform=auction_listings.platform
      AND upper(trim(excluded.lot))=upper(trim(auction_listings.lot))
      AND (excluded.vin_normalized IS NULL OR auction_listings.vin_normalized IS NULL
        OR upper(replace(replace(excluded.vin_normalized,' ',''),'-',''))=upper(replace(replace(auction_listings.vin_normalized,' ',''),'-','')))
      AND julianday(COALESCE(excluded.summary_synced_at,excluded.last_seen_at))>=julianday(COALESCE(auction_listings.summary_synced_at,auction_listings.last_seen_at))
      AND (auction_listings.detail_synced_at IS NULL
        OR julianday(COALESCE(excluded.summary_synced_at,excluded.last_seen_at))>=julianday(auction_listings.detail_synced_at))
      AND (excluded.source_updated_at IS NULL OR auction_listings.source_updated_at IS NULL
        OR julianday(excluded.source_updated_at)>=julianday(auction_listings.source_updated_at))`;
  item.params=[...values,row.source_key,row.platform,row.platform,row.lot,row.listing_id];
  return item;
}

function listingIdentityGuard(listing) {
  return {sql:`EXISTS(SELECT 1 FROM auction_listings WHERE listing_id=? AND source_key=? AND platform=? AND upper(trim(lot))=upper(trim(?))
    AND (? IS NULL OR vin_normalized IS NULL OR upper(replace(replace(vin_normalized,' ',''),'-',''))=upper(replace(replace(?,' ',''),'-',''))))`,
  params:[listing.listing_id,listing.source_key,listing.platform,listing.lot,listing.vin_normalized??null,listing.vin_normalized??null]};
}

function snapshotStatement(row,listing) {
  const safe={...row};delete safe.snapshot_id;
  const item=insert('auction_listing_snapshots',safe),guard=listingIdentityGuard(listing);
  item.sql=`INSERT INTO auction_listing_snapshots (${item.columns.join(',')}) SELECT ${item.columns.map(()=>'?').join(',')}
    WHERE ${guard.sql} AND NOT EXISTS(SELECT 1 FROM auction_listing_snapshots WHERE listing_id=? AND observed_at=? AND fingerprint=?)`;
  item.params.push(...guard.params,row.listing_id,row.observed_at,row.fingerprint);
  return item;
}

function eventStatement(row,listing) {
  const item=insert('auction_events',row);
  const guard=listing ? listingIdentityGuard(listing)
    : {sql:"EXISTS(SELECT 1 FROM vehicle_sources WHERE source_key=? AND provider='apibara' AND platform=?)",params:[row.source_key,row.platform]};
  item.sql=`INSERT INTO auction_events (${item.columns.join(',')}) SELECT ${item.columns.map(()=>'?').join(',')}
    WHERE ${guard.sql} ON CONFLICT(event_id) DO NOTHING`;
  item.params.push(...guard.params);
  return item;
}

function buildPublicCatalogMerge({tables,columns,existingTables,existingColumns=columns,capturedAt,maxStatementsPerGroup=80,deltaOnly=false}={}) {
  if (!Number.isSafeInteger(maxStatementsPerGroup) || maxStatementsPerGroup<3 || maxStatementsPerGroup>100) fail('PUBLIC_MERGE_INVALID_GROUP_LIMIT');
  const incoming=selected({tables,columns},capturedAt),existing=selected({tables:existingTables,columns:existingColumns},capturedAt);
  const sourceRows=new Map(incoming.tables.vehicle_sources.map(row=>[row.source_key,row]));
  const targetSources=new Map(existing.tables.vehicle_sources.map(row=>[row.source_key,row]));
  const targetListings=new Map(existing.tables.auction_listings.map(row=>[row.listing_id,row]));
  const targetLots=new Map();
  for (const row of existing.tables.auction_listings) {
    const key=lotKey(row);if(targetLots.has(key))fail('PUBLIC_MERGE_DUPLICATE_TARGET_LOT');targetLots.set(key,row);
  }
  const incomingLots=new Set();
  for (const row of incoming.tables.vehicle_sources) {
    const other=targetSources.get(row.source_key);
    if(other&&(other.provider!==row.provider||other.platform!==row.platform))fail('PUBLIC_MERGE_SOURCE_IDENTITY_MISMATCH');
  }
  let skippedOlder=0;
  for (const row of incoming.tables.auction_listings) {
    const key=lotKey(row);if(incomingLots.has(key))fail('PUBLIC_MERGE_DUPLICATE_SOURCE_LOT');incomingLots.add(key);
    const sameLot=targetLots.get(key),other=targetListings.get(row.listing_id);
    if(sameLot&&sameLot.listing_id!==row.listing_id)fail('PUBLIC_MERGE_LISTING_IDENTITY_MISMATCH');
    if(other&&(other.platform!==row.platform||lotKey(other)!==key||other.source_key!==row.source_key))fail('PUBLIC_MERGE_LISTING_IDENTITY_MISMATCH');
    if(other&&fullVin(other.vin_normalized)&&fullVin(row.vin_normalized)&&fullVin(other.vin_normalized)!==fullVin(row.vin_normalized))fail('PUBLIC_MERGE_VIN_MISMATCH');
    if(other&&(Date.parse(observation(row))<Date.parse(observation(other))
      ||(other.detail_synced_at&&Date.parse(observation(row))<Date.parse(other.detail_synced_at))
      ||(row.source_updated_at&&other.source_updated_at&&Date.parse(row.source_updated_at)<Date.parse(other.source_updated_at))))skippedOlder++;
  }
  const targetSnapshots=new Map(existing.tables.auction_listing_snapshots.map(row=>[snapshotKey(row),row]));
  const snapshotColumns=PUBLIC_COLUMNS.auction_listing_snapshots.filter(column=>column!=='snapshot_id');
  for(const row of incoming.tables.auction_listing_snapshots){const other=targetSnapshots.get(snapshotKey(row));
    if(other&&JSON.stringify(comparable(row,snapshotColumns))!==JSON.stringify(comparable(other,snapshotColumns)))fail('PUBLIC_MERGE_SNAPSHOT_CONFLICT');}
  const targetEvents=new Map(existing.tables.auction_events.map(row=>[row.event_id,row]));
  const eventColumns=PUBLIC_COLUMNS.auction_events.filter(column=>!['observed_at','created_at','updated_at','normalizer_version','fingerprint'].includes(column));
  for(const row of incoming.tables.auction_events){const other=targetEvents.get(row.event_id);
    if(other&&JSON.stringify(comparable(row,eventColumns))!==JSON.stringify(comparable(other,eventColumns)))fail('PUBLIC_MERGE_EVENT_CONFLICT');}

  const allowed=Object.fromEntries(TABLES.map(table=>[table,schemaNames(existingColumns,table)]));
  const toTarget=(table,row)=>Object.fromEntries(Object.entries(row).filter(([column])=>allowed[table].has(column)));
  const snapshots=new Map(),events=new Map();
  for(const row of incoming.tables.auction_listing_snapshots){if(!snapshots.has(row.listing_id))snapshots.set(row.listing_id,[]);snapshots.get(row.listing_id).push(row);}
  for(const row of incoming.tables.auction_events){const key=row.listing_id??null;if(!events.has(key))events.set(key,[]);events.get(key).push(row);}
  const groups=[],usedSources=new Set();
  function group(kind,key,base,history){
    if(!base.length&&!history.length)return;
    const chunkSize=maxStatementsPerGroup-base.length;
    const chunks=history.length?Array.from({length:Math.ceil(history.length/chunkSize)},(_,index)=>history.slice(index*chunkSize,(index+1)*chunkSize)):[[]];
    for(const chunk of chunks){const statements=[...base,...chunk];groups.push({kind,key,statements,sha256:digest(statements)});}
  }
  for(const original of incoming.tables.auction_listings){
    const row=toTarget('auction_listings',original);
    for(const column of ['current_bid_usd','current_bid2_usd','buy_now_usd'])if(allowed.auction_listings.has(column)&&!Object.hasOwn(row,column))row[column]=null;
    const source=toTarget('vehicle_sources',sourceRows.get(row.source_key));usedSources.add(row.source_key);
    const history=[...(snapshots.get(row.listing_id)||[]).filter(x=>!deltaOnly||!targetSnapshots.has(snapshotKey(x))).map(snapshot=>snapshotStatement(toTarget('auction_listing_snapshots',snapshot),row)),
      ...(events.get(row.listing_id)||[]).filter(x=>!deltaOnly||!targetEvents.has(x.event_id)).map(event=>eventStatement(toTarget('auction_events',event),row))];
    const base=[];
    if(!deltaOnly||JSON.stringify(source)!==JSON.stringify(toTarget('vehicle_sources',targetSources.get(row.source_key)||{})))base.push(sourceStatement(source));
    if(!deltaOnly||JSON.stringify(row)!==JSON.stringify(toTarget('auction_listings',targetListings.get(row.listing_id)||{})))base.push(listingStatement(row));
    group('listing',row.listing_id,base,history);
  }
  for(const original of events.get(null)||[]){const row=toTarget('auction_events',original),source=toTarget('vehicle_sources',sourceRows.get(row.source_key));usedSources.add(row.source_key);
    group('unlinked_event',row.event_id,[sourceStatement(source)],[eventStatement(row,null)]);}
  for(const original of incoming.tables.vehicle_sources)if(!usedSources.has(original.source_key))group('source',original.source_key,[sourceStatement(toTarget('vehicle_sources',original))],[]);
  const statements=groups.flatMap(item=>item.statements);
  return {groups,statements,manifest:{format:'rexbid-public-catalog-merge-v1',captured_at:capturedAt,provider_requests:0,
    catalog_complete:false,accounts_included:false,operational_state_included:false,history_policy:'append_without_snapshot_primary_keys',
    counts:incoming.manifest.counts,target_before_counts:existing.manifest.counts,listing_updates_skipped_as_older:skippedOlder,
    group_count:groups.length,statement_count:statements.length,content_sha256:incoming.manifest.content_sha256,
    target_before_sha256:existing.manifest.content_sha256,plan_sha256:digest(groups)}};
}

module.exports={buildPublicCatalogMerge,PUBLIC_COLUMNS};
