'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const root=process.argv[2];if(!root)throw Error('Provide verified unpacked feed executor source path');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for(const [file,expected] of Object.entries(require('./source-sha256.json'))){
 if(hash(path.join(root,file))!==expected)throw Error('Executor source mismatch '+file);
}
const target=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'rexbid-timed-bid-'));
for(const dir of ['sync','providers','docs','config','data','calculator','staging','scripts','tests','portal','auth','public']){
 const src=path.join(root,dir);if(fs.existsSync(src))fs.cpSync(src,path.join(target,dir),{recursive:true});
}
for(const f of fs.readdirSync(root,{withFileTypes:true}).filter(x=>x.isFile()&&/\.(?:js|cjs|json|jsonc)$/.test(x.name)))fs.copyFileSync(path.join(root,f.name),path.join(target,f.name));
fs.cpSync(path.join(__dirname,'executor'),target,{recursive:true});
const tests=fs.readdirSync(path.join(target,'tests')).filter(x=>/^feed-.*\.test\.cjs$|^inventory-change.*\.test\.cjs$/.test(x)).map(x=>path.join(target,'tests',x));
const site=path.resolve(__dirname,'../public-site');tests.push(path.join(site,'tests','timed-iaai.test.cjs'),path.join(site,'tests','timed-refresh.test.cjs'),path.join(__dirname,'tests','published-timed-bid.test.cjs'));
const result=spawnSync(process.execPath,['--no-warnings','--test','--test-concurrency=4','--test-reporter=tap',...tests],{encoding:'utf8',timeout:300000,maxBuffer:40e6,env:{...process.env,TIMED_TEST_EXECUTOR:target}});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');if(result.error)console.error(result.error.message);process.exitCode=result.status??1;
