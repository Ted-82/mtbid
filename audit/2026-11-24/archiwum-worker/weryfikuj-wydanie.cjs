'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=__dirname,config=require('./wrangler.archiwum.json'),baseline=require('./pochodzenie-wdrozenia.json'),candidate=require('./wynik-budowy.json');
async function main(){
 const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
 assert.equal(digest(fs.readFileSync(path.join(root,'build/worker.archive-auto.js'))),candidate.sha256);
 if(process.argv[2]!=='--live-read'){console.log('Suma lokalnego bundla zgodna.');return;}
 const token=process.env.CLOUDFLARE_API_TOKEN;
 assert.ok(token,'Do odczytu potrzebny jest istniejący token Cloudflare z uprawnieniami odczytu Workerów.');
 const endpoint='https://api.cloudflare.com/client/v4/accounts/'+config.account_id+'/workers/scripts/'+config.name;
 const read=url=>fetch(endpoint+url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
 const [deploy,script,settings,schedule]=await Promise.all(['/deployments','','/settings','/schedules'].map(read));
 if([deploy,script,settings,schedule].some(r=>!r.ok))throw Error('Cloudflare nie potwierdził wszystkich odczytów.');
 const versions=(await deploy.json()).result.deployments[0].versions;
 assert.deepEqual(versions.map(v=>[v.version_id,v.percentage]),baseline.active.map(v=>[v.id,v.percentage]));
 const s=(await settings.json()).result;
 assert.equal(s.compatibility_date,config.compatibility_date);assert.deepEqual(s.compatibility_flags||[],config.compatibility_flags||[]);
 const binding=(type,name)=>s.bindings.find(b=>b.type===type&&b.name===name);
 assert.equal(binding('plain_text','ARCHIVE_ENABLED')?.text,'yes');
 for(const d of config.d1_databases)assert.equal(binding('d1',d.binding)?.id,d.database_id);
 for(const b of config.r2_buckets)assert.equal(binding('r2_bucket',b.binding)?.bucket_name,b.bucket_name);
 assert.deepEqual((await schedule.json()).result.schedules.map(s=>s.cron),config.triggers.crons);
 const multipart=script.headers.get('content-type')?.includes('multipart');
 let bytes;
 if(multipart){for(const [name,v] of await script.formData())if(name==='worker.archive-auto.js'||v?.name==='worker.archive-auto.js')bytes=Buffer.from(typeof v==='string'?v:await v.arrayBuffer());}
 else bytes=Buffer.from(await script.arrayBuffer());
 assert.equal(digest(bytes),baseline.remoteSha);console.log('Wydanie, kod, zasoby i harmonogram zgodne z oczekiwaną bazą.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
