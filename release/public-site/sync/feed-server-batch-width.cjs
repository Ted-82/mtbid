'use strict';
// Pre-hydration width admission. An oversized enlarged window falls back to the
// original 100-group prefix; it never rejects media or retries a prior mutation.
const {BASELINE_FIELDS}=require('./inventory-change-patch.cjs');
const MAX_GUARD_BYTES=1500000,encoder=new TextEncoder();
const widthSql=`SELECT l.platform,l.lot,COUNT(*) AS matches,SUM(length(CAST(json_array(${BASELINE_FIELDS.map(k=>'l.'+k).join(',')}) AS BLOB))) AS serialized_bytes
 FROM json_each(?) g CROSS JOIN auction_listings l
 ON l.platform=json_extract(g.value,'$.platform') AND l.lot=json_extract(g.value,'$.lot') GROUP BY l.platform,l.lot`;
const fail=()=>{throw Error('SERVER_FEED_BATCH_WIDTH_INVALID');};
async function boundFeedBatchWidth({db,groups}={}){
 if(!db?.prepare||!Array.isArray(groups)||groups.length>300)fail();
 if(groups.length<=100)return{groups,checked:false,fallback:false,estimatedGuardBytes:null};
 const identities=groups.map(g=>({platform:g.platform,lot:g.lot}));
 if(identities.some(g=>!['copart','iaai'].includes(g.platform)||!/^\d{1,20}$/.test(g.lot||'')))fail();
 const keys=new Set(identities.map(g=>g.platform+':'+g.lot));if(keys.size!==groups.length)fail();
 const result=await db.prepare(widthSql).bind(JSON.stringify(identities)).all();
 if(!Array.isArray(result?.results))fail();let estimated=groups.length*128;
 const seen=new Set();for(const row of result.results){const key=row.platform+':'+row.lot;
  if(!keys.has(key)||seen.has(key)||!Number.isSafeInteger(row.matches)||row.matches<1||!Number.isSafeInteger(row.serialized_bytes)||row.serialized_bytes<0)fail();seen.add(key);
  // Four times the actual JSON value width plus fixed object/field overhead
  // bounds escaping and the original-row/source-identity guard representation.
  estimated+=row.serialized_bytes*4+row.matches*1000;
 }
 for(const group of groups){if(!Array.isArray(group.events))fail();for(const event of group.events){
  if(event?.record!=null){estimated+=encoder.encode(JSON.stringify(event.record)).length*4+2048;if(estimated>MAX_GUARD_BYTES)break;}
 }if(estimated>MAX_GUARD_BYTES)break;}
 if(!Number.isSafeInteger(estimated))fail();
 return{groups:estimated>MAX_GUARD_BYTES?groups.slice(0,100):groups,checked:true,fallback:estimated>MAX_GUARD_BYTES,estimatedGuardBytes:estimated};
}
module.exports={boundFeedBatchWidth,widthSql,MAX_GUARD_BYTES};
