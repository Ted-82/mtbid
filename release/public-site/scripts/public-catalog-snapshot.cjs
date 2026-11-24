'use strict';
const {unpackMediaJson}=require('../sync/catalog-media-storage.cjs');

// Offline, public-only snapshot planning. This module has no network or D1 writes.
const {createHash} = require('node:crypto');
const {safeMediaReferences} = require('../sync/core.js');
const PLATFORMS = Object.freeze(['copart','iaai']);
const PUBLIC_COLUMNS = Object.freeze({
  vehicle_sources:Object.freeze(['source_key','provider','platform','provider_vehicle_id','identity_kind','identity_state','entity_id','source_updated_at','first_seen_at','last_seen_at','normalizer_version','source_fingerprint','created_at','updated_at']),
  auction_listings:Object.freeze(['listing_id','source_key','platform','listing_identity_kind','identity_state','source_listing_id','listing_generation','vin_normalized','lot','vehicle_title','make','model','trim','year','body_style','fuel_type','transmission','drive_type','engine_size_l','odometer_value','odometer_unit','auction_state','source_status','auction_at','is_timed','timed_end_at','current_bid_usd','current_bid2_usd','buy_now_usd','final_price_usd','source_price_usd','price_currency','seller_name','seller_type','primary_damage','secondary_damage','run_state','keys_present','airbags','document_name','document_type','registration_allowed','export_allowed','location_display','location_state','location_postal_code','has_video','has_360','media_urls_json','media_thumbs_json','source_updated_at','first_seen_at','last_seen_at','summary_synced_at','detail_synced_at','freshness_class','fingerprint','normalizer_version','created_at','updated_at']),
  auction_listing_snapshots:Object.freeze(['snapshot_id','listing_id','observed_at','auction_state','auction_at','timed_end_at','current_bid_usd','buy_now_usd','fingerprint','normalizer_version']),
  auction_events:Object.freeze(['event_id','listing_id','source_key','provider','platform','provider_event_id','event_key','vin_normalized','lot','auction_date','sale_date','source_status','canonical_status','current_bid_usd','buy_now_usd','source_price_usd','final_price_usd','seller_name','seller_type','observed_at','fingerprint','normalizer_version','identity_state','created_at','updated_at'])
});
const REQUIRED = Object.freeze({
  vehicle_sources:['source_key','provider','platform','entity_id','first_seen_at','last_seen_at','created_at','updated_at'],
  auction_listings:['listing_id','source_key','platform','lot','first_seen_at','last_seen_at','created_at','updated_at'],
  auction_listing_snapshots:['snapshot_id','listing_id','observed_at','fingerprint'],
  auction_events:['event_id','source_key','provider','platform','observed_at','created_at','updated_at']
});
const PRIMARY = Object.freeze({vehicle_sources:'source_key',auction_listings:'listing_id',auction_listing_snapshots:'snapshot_id',auction_events:'event_id'});
const TIMESTAMPS = new Set(['source_updated_at','first_seen_at','last_seen_at','summary_synced_at','detail_synced_at','created_at','updated_at','observed_at','auction_at','timed_end_at','auction_date','sale_date']);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function invalid(label) { throw new TypeError('Nieprawidłowy publiczny snapshot: '+label); }
function timestamp(value,label) {
  if(typeof value !== 'string' || !value || !Number.isFinite(Date.parse(value))) invalid(label);
  return value; // Preserve source bytes; never restamp ingestion/public freshness.
}
function identifier(value,label) {
  if(typeof value !== 'string' || !value.trim() || value.length>512 || /[\u0000-\u001f\u007f]/.test(value)) invalid(label);
  return value;
}
function schemaColumns(input,table) {
  if(!Array.isArray(input?.[table])) invalid('schema '+table);
  const names=input[table].map(column=>typeof column==='string'?column:column?.name);
  if(names.some(name=>typeof name!=='string') || new Set(names).size!==names.length) invalid('schema '+table);
  return new Set(names);
}
function statement(table,row) {
  const columns=Object.keys(row);
  return {table,columns,sql:'INSERT INTO '+table+' ('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')',params:columns.map(column=>row[column])};
}
function buildPublicCatalogSnapshot({tables,columns,capturedAt,existingListings=[]}={}) {
  timestamp(capturedAt,'capturedAt');
  if(!tables || typeof tables!=='object' || Array.isArray(tables)) invalid('tables');
  if(!Array.isArray(existingListings)) invalid('existingListings');
  const selected={},counts={},media={input_references:0,retained_references:0};
  for(const table of Object.keys(PUBLIC_COLUMNS)){
    const schema=schemaColumns(columns,table),rows=tables[table];
    if(!Array.isArray(rows)) invalid(table);
    for(const field of REQUIRED[table]) if(!schema.has(field)) invalid('missing schema '+table+'.'+field);
    selected[table]=rows.map(original=>{
      if(!original || typeof original!=='object' || Array.isArray(original)) invalid(table+' row');
      const row={};
      for(const field of PUBLIC_COLUMNS[table]){
        if(!schema.has(field) || (!Object.hasOwn(original,field) && field!=='entity_id')) continue;
        const value=field==='entity_id'?null:original[field];
        if(value===undefined) continue;
        if(field==='media_urls_json'||field==='media_thumbs_json'){
          if(value===null){row[field]=null;continue;}
          if(typeof value!=='string'||value.length>64000) invalid(table+'.'+field);
          const json=unpackMediaJson(value);
          if(json.length>64000) invalid(table+'.'+field);
          let references;try{references=JSON.parse(json);}catch{invalid(table+'.'+field);}
          if(!Array.isArray(references)) invalid(table+'.'+field);
          const safe=safeMediaReferences(references,field==='media_thumbs_json'?'thumb':'image');
          media.input_references+=references.length;media.retained_references+=safe.length;row[field]=JSON.stringify(safe);continue;
        }
        if(value!==null && !['string','number','boolean'].includes(typeof value)) invalid(table+'.'+field);
        if(typeof value==='number'&&!Number.isFinite(value)) invalid(table+'.'+field);
        if(value!==null&&TIMESTAMPS.has(field))timestamp(value,table+'.'+field);
        row[field]=typeof value==='boolean'?Number(value):value;
      }
      for(const field of REQUIRED[table]) if(field!=='entity_id'&&(row[field]===null||row[field]===undefined||row[field]==='')) invalid('missing '+table+'.'+field);
      const primary=row[PRIMARY[table]];
      if(table==='auction_listing_snapshots'){if(!Number.isSafeInteger(primary)||primary<1)invalid('snapshot_id');}
      else identifier(primary,table+' primary key');
      return row;
    }).sort((a,b)=>typeof a[PRIMARY[table]]==='number'?a[PRIMARY[table]]-b[PRIMARY[table]]:a[PRIMARY[table]].localeCompare(b[PRIMARY[table]],'en'));
    const keys=new Set();for(const row of selected[table]){if(keys.has(row[PRIMARY[table]]))invalid('collision '+table+' primary key');keys.add(row[PRIMARY[table]]);}
    counts[table]=selected[table].length;
  }
  const sources=new Map(selected.vehicle_sources.map(row=>[row.source_key,row]));
  for(const row of sources.values()) if(row.provider!=='apibara'||!PLATFORMS.includes(row.platform)) invalid('source provider/platform');
  const listings=new Map(),lotKeys=new Set();
  for(const row of existingListings){if(!row||!PLATFORMS.includes(row.platform))invalid('existing listing platform');identifier(row.lot,'existing LOT');const key=JSON.stringify([row.platform,row.lot]);if(lotKeys.has(key))invalid('existing LOT/platform collision');lotKeys.add(key);}
  for(const row of selected.auction_listings){
    const source=sources.get(row.source_key);if(!source||source.platform!==row.platform||!PLATFORMS.includes(row.platform))invalid('listing source/platform');
    identifier(row.lot,'LOT');const key=JSON.stringify([row.platform,row.lot]);if(lotKeys.has(key))invalid('LOT/platform collision');lotKeys.add(key);listings.set(row.listing_id,row);
  }
  for(const row of selected.auction_listing_snapshots)if(!listings.has(row.listing_id))invalid('snapshot listing FK');
  for(const row of selected.auction_events){
    const source=sources.get(row.source_key);if(row.provider!=='apibara'||!source||source.platform!==row.platform)invalid('event source/provider/platform');
    if(row.listing_id!==null&&row.listing_id!==undefined){const listing=listings.get(row.listing_id);if(!listing||listing.source_key!==row.source_key||listing.platform!==row.platform)invalid('event listing FK');}
  }
  const contentHash=digest(selected),statements=[];
  for(const table of ['vehicle_sources','auction_listings','auction_listing_snapshots','auction_events'])for(const row of selected[table])statements.push(statement(table,row));
  const platformCounts=PLATFORMS.map(platform=>({platform,sources:selected.vehicle_sources.filter(row=>row.platform===platform).length,listings:selected.auction_listings.filter(row=>row.platform===platform).length,events:selected.auction_events.filter(row=>row.platform===platform).length}));
  const scopes=[];
  for(const count of platformCounts){
    if(!count.sources)continue;
    const row={scope_key:'public-snapshot:apibara:'+count.platform+':'+contentHash.slice(0,24),provider:'apibara',platform:count.platform,operation:'discovery',scope_fingerprint:contentHash,status:'partial',cursor:null,last_attempt_at:null,last_success_at:null,last_complete_at:null,updated_at:capturedAt};
    scopes.push(row.scope_key);statements.push(statement('provider_sync_scopes',row));
  }
  const preservedTimes=Object.values(selected).flat().flatMap(row=>Object.entries(row).filter(([name,value])=>TIMESTAMPS.has(name)&&value!==null).map(([,value])=>value));
  const orderedTimes=preservedTimes.sort((a,b)=>Date.parse(a)-Date.parse(b));
  const observedTimes=selected.auction_listings.flatMap(row=>['last_seen_at','summary_synced_at','detail_synced_at'].map(field=>row[field]).filter(value=>typeof value==='string')).sort((a,b)=>Date.parse(a)-Date.parse(b));
  return {statements,manifest:{format:'rexbid-public-catalog-snapshot-v1',captured_at:capturedAt,provider:'apibara',catalog_complete:false,status:'partial',accounts_included:false,entity_reconciliation_performed:false,counts,platforms:platformCounts,scope_keys:scopes,media,all_timestamp_range:{earliest:orderedTimes[0]||null,latest:orderedTimes.at(-1)||null},listing_observed_at_range:{earliest:observedTimes[0]||null,latest:observedTimes.at(-1)||null},content_sha256:contentHash,plan_sha256:digest(statements)}};
}
module.exports={buildPublicCatalogSnapshot,PUBLIC_COLUMNS};

if(require.main===module){
  let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>input+=chunk);
  process.stdin.on('end',()=>{try{process.stdout.write(JSON.stringify(buildPublicCatalogSnapshot(JSON.parse(input)))+'\n');}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}});
}
