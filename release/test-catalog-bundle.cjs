'use strict';
// Recreate all three executor changes in a new local directory and run their shared regression suite.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');

const base = process.argv[2] && fs.realpathSync(process.argv[2]);
if (!base) throw Error('Provide the unpacked executor for release 11ee319d-be35-47c4-a06f-49da0464ae98.');
for (const [file, hash] of Object.entries(require('./timed-bid-observation/source-sha256.json'))) {
  const actual = createHash('sha256').update(fs.readFileSync(path.join(base, file))).digest('hex');
  assert.equal(actual, hash, 'Unexpected executor source: '+file);
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rexbid-catalog-tests-'));
for (const dir of ['sync','providers','tests','docs','config','data','calculator','auth','portal','public','staging','scripts','migrations','migrations-staging']) {
  const src = path.join(base, dir);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(temporary, dir), {recursive:true});
}
for (const name of fs.readdirSync(base, {withFileTypes:true})) {
  if (name.isFile() && !name.name.startsWith('.') && /\.(?:c?js|jsonc?)$/.test(name.name)) {
    fs.copyFileSync(path.join(base,name.name), path.join(temporary,name.name));
  }
}
for (const overlay of ['copart-relisting','timed-bid-observation']) {
  fs.cpSync(path.join(__dirname,overlay,'executor'), temporary, {recursive:true});
}
fs.writeFileSync(path.join(temporary,'.rexbid-isolated-build'),'REXBID isolated build\n');
const apply = spawnSync(process.execPath,[path.join(__dirname,'current-copart-bid','integration.cjs'),'--isolated',temporary],{stdio:'inherit'});
if (apply.status !== 0) throw Error('Cannot assemble the Copart check on the verified sources.');
fs.mkdirSync(path.join(temporary,'.codex-wrangler-cache'),{recursive:true});
const tests = fs.readdirSync(path.join(temporary,'tests'))
  .filter(name => /^(?:feed-|inventory-change).*\.test\.cjs$/.test(name))
  .map(name => path.join(temporary,'tests',name));
tests.push(path.join(__dirname,'timed-bid-observation/tests/published-timed-bid.test.cjs'));
for (const name of ['timed-iaai.test.cjs','timed-refresh.test.cjs']) tests.push(path.join(__dirname,'public-site/tests',name));
console.log('# Isolated executor: '+temporary);
const run = spawnSync(process.execPath,['--no-warnings','--test','--test-concurrency=4','--test-reporter=tap',...tests],{
  cwd:temporary,stdio:'inherit',timeout:420000,env:{...process.env,TIMED_TEST_EXECUTOR:temporary}
});
if (run.error) throw run.error;
process.exitCode = run.status ?? 1;
