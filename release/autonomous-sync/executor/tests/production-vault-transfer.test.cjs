'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const psPath=path.join(root,'scripts','production-vault-transfer.ps1');
const ps=fs.readFileSync(psPath,'utf8');
const cs=fs.readFileSync(path.join(root,'scripts','production-vault-core.cs'),'utf8');

test('vault transfer exercises copy/save/next, TTL, busy finish and masked verification without real clipboard or secrets',{skip:process.platform!=='win32'},()=>{
  const result=spawnSync('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',psPath,'-Mode','SelfTest'],{encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(result.status,0,result.stdout);
  const report=JSON.parse(result.stdout);
  assert.equal(report.ok,true);assert.equal(report.actual_clipboard_touched,false);assert.equal(report.real_secrets_used,false);
  for(const name of ['full_keyring_truncation_rejected','full_pretty_keyring_copied_single_line','portable_verifier_without_dpapi','ttl_clears_clipboard','cannot_skip_uncopied_position','finish_unconditionally_clears_clipboard','busy_clipboard_blocks_finish','verify_gui_masked_off_device_and_clear'])assert.ok(report.checks.includes(name),name);
  assert.equal(report.checks.length,17);
});

test('vault tool excludes Windows history/cloud atomically, masks UI and never falls back to unprotected publication',()=>{
  assert.equal(fs.readFileSync(psPath).subarray(0,3).toString('hex'),'efbbbf');
  for(const name of ['ExcludeClipboardContentFromMonitorProcessing','CanIncludeInClipboardHistory','CanUploadToCloudClipboard'])assert.ok(cs.includes(name));
  assert.ok(cs.indexOf('foreach(uint format in formats)')<cs.indexOf('if(!Put(13,text))'));
  assert.ok(ps.includes('$input.UseSystemPasswordChar=$true'));
  assert.ok(ps.includes('new-production-keys-v1.json.dpapi'));assert.ok(ps.includes('Test-ProtectedFile $source'));
  assert.ok(ps.includes('VAULT_SOURCE_CHECKSUM_FAILED'));
  assert.doesNotMatch(ps+cs,/Clipboard\.SetText|Write-Host|Start-Transcript|Invoke-WebRequest|Invoke-RestMethod|WriteAllText\([^\n]*\$values/);
  const verifyBranch=ps.slice(ps.indexOf("if($Mode-eq'VerifyVault'){",ps.indexOf('\ntry {')));
  assert.match(verifyBranch,/Show-VaultForm \$null \$proof/);
  assert.match(verifyBranch,/\} else \{\s*\$values=Get-ProductionValues/);
  assert.match(ps,/\$onClose=\{param\(\$sender,\$eventArgs\)[\s\S]*?\$clear=Clear-WithRetry \$port \$form.Handle/);
  assert.match(ps,/finally \{\s*\$timer.Stop\(\);\$timer.Dispose\(\)\s*\$cleared=Clear-WithRetry/);
});

test('vault copies remain compatible with actual cookie and portal encryption including retained keys',async()=>{
  const {verify}=require('../scripts/production-vault-crypto-check.cjs');
  const ring={'fixture-old':Buffer.alloc(32,1).toString('base64url'),'fixture-active':Buffer.alloc(32,2).toString('base64url')};
  const fixture={REXBID_AUTH_COOKIE_SECRET:Buffer.alloc(32,3).toString('base64url'),REXBID_PORTAL_DATA_KEYS:JSON.stringify(ring),REXBID_PORTAL_ACTIVE_KEY_ID:'fixture-active'};
  await verify(fixture);
  await assert.rejects(verify({...fixture,REXBID_PORTAL_DATA_KEYS:'{}'}));
});
