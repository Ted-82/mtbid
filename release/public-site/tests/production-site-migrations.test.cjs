'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),apply=(db,file)=>db.exec(fs.readFileSync(path.join(root,file),'utf8'));
test('production Accounts/portal and optional Sync are additive over 0000-0002; replay preserves read budgets and creates no test customers',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');
 for(const file of ['0000_rexbid_base.sql','0001_auction_history_events.sql','0002_provider_read_budgets.sql'])apply(db,'migrations/'+file);
 db.exec("INSERT INTO provider_request_budgets(provider,budget_day,normal_limit,retry_limit,normal_consumed,updated_at) VALUES('apibara','2026-10-06',500,0,17,'2026-10-06T00:00:00Z')");
 const before=db.prepare('SELECT * FROM provider_request_budgets').all();
 const legacy=db.prepare("SELECT name,sql FROM sqlite_master WHERE name IN ('vehicles','vehicle_snapshots','auction_history','provider_request_budgets','provider_request_reservations') ORDER BY name").all();
 for(let i=0;i<2;i++)for(const file of ['0003_accounts_foundation.sql','0006_import_operations.sql'])apply(db,'docs/proposals/'+file);
 for(const table of ['users','user_favorites','import_orders','import_order_messages','import_order_files'])assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='auction_listings'").get().n,0,'portal does not require Sync 2');
 for(let i=0;i<2;i++)apply(db,'docs/proposals/0004_d1_sync_2.sql');
 const columns=db.prepare('PRAGMA table_info(auction_listings)').all().map(x=>x.name);
 assert.ok(columns.includes('media_urls_json'));assert.ok(columns.includes('media_thumbs_json'));
 assert.deepEqual(db.prepare('SELECT * FROM provider_request_budgets').all(),before);
 assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master WHERE name IN ('vehicles','vehicle_snapshots','auction_history','provider_request_budgets','provider_request_reservations') ORDER BY name").all(),legacy);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
