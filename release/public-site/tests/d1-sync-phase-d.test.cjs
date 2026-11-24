const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {createApibaraProvider} = require('../providers/apibara.js');
const {runPersistentDiscovery, handlePhaseDRequest, MAX_CAMPAIGN_REQUESTS, PAGE_SIZE} = require('../staging/phase-d-discovery.cjs');

const ROOT = path.join(__dirname, '..');
const NOW = Date.parse('2026-09-29T12:00:00.000Z');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/apibara-discovery-page-shape.json'), 'utf8'));

class DisposableD1 {
  constructor(database) { this.database = database; this.tail = Promise.resolve(); }
  prepare(sql) {
    const database = this.database;
    const execute = (...params) => database.prepare(sql).run(...params);
    return {
      async first(...params) { return database.prepare(sql).get(...params) ?? null; },
      async all(...params) { return {results:database.prepare(sql).all(...params)}; },
      async run(...params) { const row=execute(...params); return {success:true,meta:{changes:Number(row.changes)}}; },
      bind(...params) { return {sql, params,
      async first() { return database.prepare(sql).get(...params) ?? null; },
      async all() { return {results: database.prepare(sql).all(...params)}; },
      async run() { const row = database.prepare(sql).run(...params); return {success:true,meta:{changes:Number(row.changes)}}; }
    }; }};
  }
  batch(statements) {
    const result = this.tail.then(() => {
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const rows = statements.map(statement => {
          const query = this.database.prepare(statement.sql);
          if (/^\s*(SELECT|PRAGMA|EXPLAIN)\b/i.test(statement.sql)) return {success:true,results:query.all(...statement.params)};
          const row = query.run(...statement.params); return {success:true,meta:{changes:Number(row.changes)}};
        });
        this.database.exec('COMMIT'); return rows;
      } catch (error) { this.database.exec('ROLLBACK'); throw error; }
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of ['migrations/0000_rexbid_base.sql','migrations/0001_auction_history_events.sql',
    'migrations-staging/0003_accounts_foundation.sql','docs/proposals/0004_d1_sync_2.sql']) {
    sqlite.exec(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  }
  sqlite.prepare(`INSERT INTO users(id,auth_issuer,auth_subject,auth_provider,email_verified,created_at,updated_at)
    VALUES('retained-user','issuer','subject','email',1,'a','a')`).run();
  sqlite.prepare(`INSERT INTO user_favorites(user_id,favorite_key,vin,lot,platform,created_at,updated_at)
    VALUES('retained-user','lot:copart:KEEP',NULL, 'KEEP','copart','a','a')`).run();
  return {sqlite, d1:new DisposableD1(sqlite)};
}

function mockedProvider(calls, behavior = async () => new Response(JSON.stringify(fixture), {status:200,headers:{'content-type':'application/json'}})) {
  return createApibaraProvider({fetch:async(url, options) => { calls.push({url:String(url),method:options.method}); return behavior(url, options); },
    timeoutMs:500, console:{warn(){},error(){}}});
}

test('jedno persistent staging discovery zapisuje canonical page, snapshot bazowy, checkpoint i pozostawia konta', async () => {
  const {sqlite,d1} = database();
  const calls = [];
  const result = await runPersistentDiscovery({db:d1,env:{APIBARA_API_KEY:'mock-only'},requestId:'phase-d-offline-one',now:()=>NOW,provider:mockedProvider(calls)});
  assert.equal(calls.length,1);
  assert.equal(calls[0].method,'GET');
  assert.match(calls[0].url,/platform=copart/);
  assert.match(calls[0].url,/per_page=20/);
  assert.equal(PAGE_SIZE,20);
  assert.equal(MAX_CAMPAIGN_REQUESTS,5);
  assert.equal(result.ok,true);
  assert.equal(result.liveRequests,1);
  assert.equal(result.providerRecords,1);
  assert.equal(result.accepted,1);
  assert.equal(result.rejected,0);
  assert.equal(result.ambiguous,0);
  assert.equal(result.duplicates,0,'repository replay is not misreported as duplicate provider data');
  assert.equal(result.replayVerified,true);
  assert.equal(result.inserts,1);
  assert.equal(result.readback,true);
  assert.equal(result.snapshotsCreated,1);
  assert.equal(result.eventsCreated,0,'discovery does not invent auction history');
  assert.equal(result.rawOrMediaStored,false);
  assert.equal(result.cleanup,'not_performed_by_design');
  assert.equal(result.after.users,1);
  assert.equal(result.after.favorites,1);
  assert.equal(result.after.sync.auction_listings,1);
  assert.equal(result.after.sync.auction_listing_snapshots,1);
  assert.equal(result.after.sync.auction_events,0);
  const listing = sqlite.prepare('SELECT * FROM auction_listings').get();
  assert.equal(listing.platform,'copart');
  assert.ok(listing.source_key);
  assert.ok(listing.listing_id);
  assert.equal(listing.raw_json,undefined);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM vehicle_sources').get().n,1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM sync_runs WHERE status=\'completed\'').get().n,1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM sync_page_commits').get().n,1);
  assert.equal(sqlite.prepare('SELECT normal_consumed,normal_limit,retry_limit FROM provider_request_budgets WHERE provider=\'apibara-phase-d\'').get().normal_consumed,1);
  const run=sqlite.prepare('SELECT records_received,records_inserted,records_updated,upstream_requests,latency_ms FROM sync_runs').get();
  assert.equal(run.records_received,1);assert.equal(run.records_inserted,1);assert.equal(run.records_updated,0);
  assert.equal(run.upstream_requests,1);assert.equal(run.latency_ms,0);
  sqlite.close();
});

test('provider failure consumes only one explicit attempt and never retries automatically', async () => {
  const {sqlite,d1} = database();
  const calls=[];
  const provider=mockedProvider(calls,async()=>{throw new TypeError('sensitive upstream detail');});
  const result=await runPersistentDiscovery({db:d1,env:{APIBARA_API_KEY:'mock-only'},requestId:'phase-d-offline-failure',now:()=>NOW,provider});
  assert.equal(calls.length,1);
  assert.equal(result.liveRequests,1);
  assert.equal(result.ok,false);
  assert.equal(result.error,'phase_d_failed');
  assert.equal(result.after.sync.auction_listings,0);
  assert.equal(result.after.sync.sync_page_commits,0);
  const budget=sqlite.prepare('SELECT normal_consumed,normal_reserved,retry_consumed,retry_reserved FROM provider_request_budgets WHERE provider=\'apibara-phase-d\'').get();
  assert.equal(budget.normal_consumed,1,'attempt is conservatively charged before fetch');
  assert.equal(budget.normal_reserved,0);
  assert.equal(budget.retry_consumed,0);
  assert.equal(budget.retry_reserved,0);
  assert.equal(sqlite.prepare('SELECT status FROM sync_runs').get().status,'failed');
  assert.equal(sqlite.prepare('SELECT upstream_requests FROM sync_runs').get().upstream_requests,1);
  sqlite.close();
});

test('Phase D endpoint requires exact staging origin, feature flag, same-origin POST and an authenticated session', async () => {
  const {sqlite,d1}=database();
  const env={REXBID_AUTH_TEST_UI:'enabled',REXBID_AUTH_TEST_HOST:'rexbid-auth-test.tedn828.workers.dev',
    REXBID_PHASE_D_DISCOVERY:'enabled',APIBARA_API_KEY:'mock-only',REXBID_DB:d1};
  const dispatch=async request=>request.url.endsWith('/api/me')
    ? new Response(JSON.stringify({ok:true,user:{id:'retained-user'}}),{status:200})
    : new Response('{}',{status:404});
  const calls=[];
  const provider=mockedProvider(calls);
  const makeRequest=(host='rexbid-auth-test.tedn828.workers.dev',origin=`https://${host}`,site='same-origin',method='POST')=>
    new Request(`https://${host}/__staging/d1-sync-phase-d-discovery`,{method,headers:{Origin:origin,'Sec-Fetch-Site':site,Cookie:'opaque-session-cookie','Content-Type':'application/json'},body:method==='POST'?'{}':undefined});

  assert.equal((await handlePhaseDRequest(makeRequest('evil.example','https://evil.example'),env,null,dispatch,provider)).status,404);
  assert.equal((await handlePhaseDRequest(makeRequest('rexbid-auth-test.tedn828.workers.dev','https://attacker.example'),env,null,dispatch,provider)).status,403);
  assert.equal((await handlePhaseDRequest(makeRequest('rexbid-auth-test.tedn828.workers.dev','https://rexbid-auth-test.tedn828.workers.dev','cross-site'),env,null,dispatch,provider)).status,403);
  assert.equal((await handlePhaseDRequest(makeRequest(undefined,undefined,undefined,'GET'),env,null,dispatch,provider)).status,405);
  assert.equal(calls.length,0);

  const denied=await handlePhaseDRequest(makeRequest(),env,null,async()=>new Response('{"ok":false}',{status:401}),provider);
  assert.equal(denied.status,401);
  assert.equal(calls.length,0);
  sqlite.close();
});

test('staging UI one-click endpoint shares BFF auth check and returns only bounded sync metrics', async () => {
  const {sqlite,d1}=database();
  const env={REXBID_AUTH_TEST_UI:'enabled',REXBID_AUTH_TEST_HOST:'rexbid-auth-test.tedn828.workers.dev',
    REXBID_PHASE_D_DISCOVERY:'enabled',APIBARA_API_KEY:'mock-only',REXBID_DB:d1};
  const calls=[];
  let authCalls=0;
  const response=await handlePhaseDRequest(new Request('https://rexbid-auth-test.tedn828.workers.dev/__staging/d1-sync-phase-d-discovery',{
    method:'POST',headers:{Origin:'https://rexbid-auth-test.tedn828.workers.dev','Sec-Fetch-Site':'same-origin',Cookie:'session','Content-Type':'application/json'},body:'{}'
  }),env,null,async request=>{authCalls++;assert.equal(new URL(request.url).pathname,'/api/me');return new Response('{"ok":true,"user":{"id":"retained-user"}}',{status:200});},mockedProvider(calls));
  const body=await response.json();
  assert.equal(authCalls,1);
  assert.equal(calls.length,1);
  assert.equal(response.status,200);
  assert.equal(body.ok,true);
  assert.equal(body.liveRequests,1);
  assert.equal(body.pageSize,20);
  assert.equal(body.cleanup,'not_performed_by_design');
  assert.equal(body.rawOrMediaStored,false);
  assert.equal(JSON.stringify(body).includes('opaque-session-cookie'),false);
  assert.equal(JSON.stringify(body).includes('APIBARA_API_KEY'),false);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM users').get().n,1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM user_favorites').get().n,1);
  sqlite.close();
});

test('Phase D refuses another discovery attempt after the one-page campaign has consumed a request', async()=>{
  const {sqlite,d1}=database();
  const calls=[];const provider=mockedProvider(calls);
  const first=await runPersistentDiscovery({db:d1,env:{APIBARA_API_KEY:'mock-only'},requestId:'phase-d-once-1',now:()=>NOW,provider});
  assert.equal(first.ok,true);assert.equal(calls.length,1);
  const second=await runPersistentDiscovery({db:d1,env:{APIBARA_API_KEY:'mock-only'},requestId:'phase-d-once-2',now:()=>NOW+1,provider});
  assert.equal(second.ok,false);assert.equal(second.error,'phase_d_single_page_already_attempted');
  assert.equal(calls.length,1,'a replayed click must not spend another upstream request');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM sync_runs').get().n,1);
  sqlite.close();
});
