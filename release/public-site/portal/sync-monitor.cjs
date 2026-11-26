'use strict';
const {readSyncHealth}=require('./sync-health.cjs');
const mail=require('./transactional-mail.cjs');
const MILESTONES=[1,6,24,72,168];
async function monitorSync(env,now=Date.now()){
 const db=env.REXBID_ACTIVE_CATALOG;
 if(!db?.prepare)return {status:'unavailable'};
 const slot=Math.floor(now/900000),at=new Date(now).toISOString();
 if(await db.prepare('SELECT slot FROM sync_monitor_samples WHERE slot=?').bind(slot).first())return {status:'already_checked'};
 const current=await readSyncHealth(db,now);
 const previous=await db.prepare('SELECT measured_at,pending,status FROM sync_monitor_samples ORDER BY slot DESC LIMIT 1').bind().first();
 const first=await db.prepare('SELECT measured_at FROM sync_monitor_samples ORDER BY slot LIMIT 1').bind().first();
 const start=first?Date.parse(first.measured_at):now;
 const elapsed=previous?(now-Date.parse(previous.measured_at))/3600000:null;
 const delta=previous?current.pending-previous.pending:null;
 const sample={...current,delta_pending:delta,hours_measured:elapsed,net_queue_per_hour:elapsed>0?delta/elapsed:null,
  milestones:MILESTONES.filter(hour=>now>=start+hour*3600000),
  estimate_hours:elapsed>0&&delta<0?current.pending/(-delta/elapsed):null};
 await db.prepare('INSERT INTO sync_monitor_samples(slot,measured_at,pending,status,data_json) VALUES(?,?,?,?,?) ON CONFLICT(slot) DO NOTHING')
  .bind(slot,at,current.pending,current.status,JSON.stringify(sample)).run();
 // Require persistence across observations. A six-hour idempotency window
 // coalesces repeats, while the durable encrypted outbox handles mail retries.
 const problem=previous&&((current.delay_minutes>120&&previous.status==='Występuje opóźnienie danych')||
  current.status==='Wymagana jest interwencja właściciela'||
  delta>0&&current.pending>1000);
 if(problem&&mail.enabled(env)){
  const key='sync-health/'+Math.floor(now/(6*3600000));
  const exists=await db.prepare('SELECT id FROM sync_notification_outbox WHERE dedupe_key=?').bind(key).first();
  if(!exists){
   const row=await mail.rowFor(env,{key,kind:'sync_alert',to:env.REXBID_MAIL_OWNER_TO,at,
    subject:'REXBID — synchronizacja wymaga sprawdzenia',
    text:current.status+'\nOczekujące weryfikacje: '+current.pending+'\nWiek ostatniej dostawy: '+current.delay_minutes+' min\nSprawdź Aktualność katalogu w panelu właściciela:\nhttps://rexbid.pl/administracja'});
   const statement=mail.messageStatement({prepare:sql=>db.prepare(sql.replace(/transactional_mail_outbox/g,'sync_notification_outbox').replace('VALUES (?,?,?,?,?,?,?,?,?)','VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING'))},row);
   await statement.run();
  }
 }
 return {status:'measured',pending:current.pending,delta,milestones:sample.milestones};
}
module.exports={monitorSync};
