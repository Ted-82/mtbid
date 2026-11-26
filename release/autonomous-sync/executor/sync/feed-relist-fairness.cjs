'use strict';
const KEY='feed-relist-fairness:v1';
function weights(queues,now){
 const values={};
 for(const platform of ['copart','iaai']){
  const q=queues.find(x=>x.platform===platform),count=Number(q?.pending)||0;
  const age=Number.isFinite(Date.parse(q?.oldest))?Math.max(0,Math.min(72,(now-Date.parse(q.oldest))/3600000)):0;
  values[platform]=count>0?count*(1+age/72):0;
 }
 const sum=values.copart+values.iaai;
 if(!sum)return {copart:1,iaai:1};
 // A small house still receives at least one fifth of opportunities; unused
 // opportunities are immediately lent when its due queue is empty.
 const copart=Math.max(.2,Math.min(.8,values.copart/sum));
 return {copart:copart*100,iaai:(1-copart)*100};
}
function choose(weights,previous={},preferred='copart'){
 const total=weights.copart+weights.iaai,credits={};
 for(const p of ['copart','iaai'])credits[p]=Math.max(-total,Math.min(total,Number(previous[p])||0))+weights[p];
 const platform=credits.copart===credits.iaai?preferred:credits.copart>credits.iaai?'copart':'iaai';
 return {platform,credits,total};
}
async function order(db,store,streams,now){
 let w={copart:1,iaai:1};
 const exists=(await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='sync_monitor_samples'").bind().all()).results;
 if(exists.length){
  const rows=(await db.prepare('SELECT measured_at,data_json FROM sync_monitor_samples ORDER BY slot DESC LIMIT 1').bind().all()).results;
  if(rows[0]&&now-Date.parse(rows[0].measured_at)>=0&&now-Date.parse(rows[0].measured_at)<=1800000){
   try{const sample=JSON.parse(rows[0].data_json);if(Array.isArray(sample.queues))w=weights(sample.queues,now);}catch{}
  }
 }
 let previous={};try{previous=JSON.parse((await store.task(KEY))?.cursor)?.credits||{};}catch{}
 const picked=choose(w,previous,streams[0].platform);
 streams.sort((a,b)=>Number(b.platform===picked.platform)-Number(a.platform===picked.platform));
 return platform=>({key:KEY,platform:'all',status:'complete',success:true,due:now,
  cursor:JSON.stringify({credits:{...picked.credits,[platform]:picked.credits[platform]-picked.total},weights:w,at:new Date(now).toISOString()})});
}
module.exports={weights,choose,order};
