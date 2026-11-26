'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {monitorSync}=require('../portal/sync-monitor.cjs');
const mail=require('../portal/transactional-mail.cjs');
function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(fs.readFileSync(path.resolve(__dirname,'../docs/proposals/0020_sync_monitor.sql'),'utf8'));
 sql.exec("CREATE TABLE server_feed_generations(generation_id INTEGER,status TEXT,observed_at TEXT,updated_at TEXT,last_sequence INTEGER,last_error_code TEXT);CREATE TABLE automatic_refresh_tasks(task_key TEXT,platform TEXT,status TEXT,last_attempt_at TEXT,last_error_code TEXT,cursor TEXT);CREATE TABLE automatic_refresh_state(singleton INTEGER,quota_checked_at TEXT,quota_limit INTEGER,quota_used INTEGER,quota_left INTEGER);CREATE TABLE automatic_refresh_budgets(budget_key TEXT,limit_count INTEGER,consumed INTEGER);");
 sql.exec("INSERT INTO server_feed_generations VALUES(24932,'complete','2026-11-26T07:40:00Z','2026-11-26T07:49:00Z',123100250,NULL);INSERT INTO automatic_refresh_tasks VALUES('feed-verify-relist:v1:iaai:1','iaai','pending','2026-11-25T07:00:00Z',NULL,'{}');");
 sql.exec("CREATE TABLE feed_catalog_pointer(singleton INTEGER,baseline_id TEXT);CREATE TABLE feed_catalog_membership(listing_id TEXT,baseline_id TEXT,active INTEGER);CREATE TABLE auction_listings(listing_id TEXT,platform TEXT,auction_state TEXT,auction_at TEXT);");
 const db={prepare(q){const stmt=sql.prepare(q);let params=[];return {bind(...p){params=p;return this;},async first(){return stmt.get(...params)||null;},async all(){return {results:stmt.all(...params)};},async run(){return {success:true,meta:{changes:Number(stmt.run(...params).changes)}};},query:q};},
 async batch(items){sql.exec('BEGIN');try{const out=[];for(const s of items)out.push(/^SELECT/.test(s.query)?await s.all():await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={REXBID_ACTIVE_CATALOG:db,REXBID_DB:db,REXBID_MAIL_ENABLED:'yes',REXBID_MAIL_SCHEMA_VERSION:'0015',REXBID_MAIL_API_KEY:'re_'+'X'.repeat(36),REXBID_MAIL_FROM:'kontakt@powiadomienia.rexbid.pl',REXBID_MAIL_OWNER_TO:'owner@example.test',AUTH_CANONICAL_ORIGIN:'https://rexbid.pl',REXBID_PORTAL_ACTIVE_KEY_ID:'test',REXBID_PORTAL_DATA_KEYS:JSON.stringify({test:Buffer.alloc(32,1).toString('base64url')})};
 return {db,sql,env};
}
test('persistent scheduled samples survive restart and coalesce a repeated source-delay alert',async t=>{
 const {sql,env}=fixture(t),start=Date.parse('2026-11-26T11:15:00Z');
 assert.equal((await monitorSync(env,start)).status,'measured');
 assert.equal((await monitorSync(env,start+1000)).status,'already_checked');
 assert.equal(sql.prepare('SELECT count(*) n FROM sync_notification_outbox').get().n,0);
 await monitorSync(env,start+900000);await monitorSync(env,start+1800000);
 assert.equal(sql.prepare('SELECT count(*) n FROM sync_notification_outbox').get().n,1);
 const sample=JSON.parse(sql.prepare('SELECT data_json FROM sync_monitor_samples ORDER BY slot DESC LIMIT 1').get().data_json);
 assert.equal(sample.pending,1);assert.equal(sample.net_queue_per_hour,0);assert.equal(sample.estimate_hours,null);
 assert.equal((await monitorSync(env,start+7*86400000)).milestones.includes(168),true);
});
test('operational alert uses encrypted outbox and provider idempotency without contacting a real recipient',async t=>{
 const {sql,env}=fixture(t),start=Date.parse('2026-11-26T11:15:00Z');
 await monitorSync(env,start);await monitorSync(env,start+900000);
 const row=sql.prepare('SELECT * FROM sync_notification_outbox').get();
 assert.ok(row.payload_ciphertext&&!row.payload_ciphertext.includes('owner@example'));
 let calls=0;
 const out=await mail.dispatch(env,{queue:'sync',now:()=>new Date(start+1800000),fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,'https://api.resend.com/emails');assert.ok(options.headers['Idempotency-Key']||options.headers['idempotency-key']);
  assert.deepEqual(JSON.parse(options.body).to,['owner@example.test']);return Response.json({id:'11111111-1111-4111-8111-111111111111'});
 }});
 assert.equal(out.sent,1);assert.equal(calls,1);
});
