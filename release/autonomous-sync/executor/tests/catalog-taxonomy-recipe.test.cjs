'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {buildAutomaticPublicationConfig,validatePublicationConfig,AUTO_VARS,generatedProfileConsistent}=require('../scripts/prepare-production-publication.cjs');
const root=path.join(__dirname,'..'),base=()=>JSON.parse(fs.readFileSync(path.join(root,'wrangler.production-preflight.jsonc'),'utf8'));
test('default automatic recipe explicitly keeps derived taxonomy OFF and preserves isolated target',()=>{
 const config=buildAutomaticPublicationConfig(base(),'catalog',{}, {catalogMembership:true});
 assert.equal(config.vars.REXBID_TAXONOMY_CACHE_ENABLED,'disabled');assert.equal(AUTO_VARS.REXBID_TAXONOMY_CACHE_ENABLED,'disabled');assert.equal(validatePublicationConfig(config).ok,true);
 assert.deepEqual(config.d1_databases,base().d1_databases);assert.equal(config.vars.REXBID_CATALOG_MEMBERSHIP_ENABLED,'enabled');
 for(const value of [true,'true',null,'',1]){const changed=structuredClone(config);changed.vars.REXBID_TAXONOMY_CACHE_ENABLED=value;const result=validatePublicationConfig(changed);assert.equal(result.ok,false);assert.ok(result.issues.includes('invalid_taxonomy_cache_opt_in'));}
 const missing=structuredClone(config);delete missing.vars.REXBID_TAXONOMY_CACHE_ENABLED;assert.equal(validatePublicationConfig(missing).ok,false);
});
test('enabled taxonomy requires explicit boolean opt-in and catalogue membership',()=>{
 for(const value of ['enabled','true',null,1])assert.throws(()=>buildAutomaticPublicationConfig(base(),'catalog',{}, {catalogMembership:true,taxonomyCache:value}),/invalid_taxonomy_cache_opt_in/);
 assert.throws(()=>buildAutomaticPublicationConfig(base(),'catalog',{}, {taxonomyCache:true}),/taxonomy_cache_requires_catalog_membership/);
 const disabled=buildAutomaticPublicationConfig(base(),'catalog',{}, {catalogMembership:true}),enabled=buildAutomaticPublicationConfig(base(),'catalog',{}, {catalogMembership:true,taxonomyCache:true});
 assert.equal(enabled.vars.REXBID_TAXONOMY_CACHE_ENABLED,'enabled');assert.equal(validatePublicationConfig(enabled).ok,true);const copy=structuredClone(enabled);copy.vars.REXBID_TAXONOMY_CACHE_ENABLED='disabled';assert.deepEqual(copy,disabled);assert.equal(generatedProfileConsistent(JSON.stringify(enabled,null,2)+'\n',enabled),true);
});
test('validator refuses taxonomy enabled outside exact production stored membership recipe',()=>{
 const enabled=buildAutomaticPublicationConfig(base(),'catalog',{}, {catalogMembership:true,taxonomyCache:true});
 for(const patch of [{REXBID_CATALOG_MEMBERSHIP_ENABLED:'disabled'},{REXBID_CATALOG_MEMBERSHIP_ENABLED:undefined},{REXBID_PUBLIC_CATALOG_MODE:'provider'},{REXBID_RELEASE_D1_TARGET:'rexbid-auth-test-db'},{REXBID_RELEASE_D1_DATABASE_ID:'acb3cb8e-69a2-459f-8a46-0f2f5b9004be'},{REXBID_AUTO_REFRESH_ENABLED:'disabled'}]){const changed=structuredClone(enabled);Object.assign(changed.vars,patch);const validation=validatePublicationConfig(changed);assert.equal(validation.ok,false);assert.ok(validation.issues.includes('taxonomy_cache_requires_isolated_membership_recipe'));}
 const changed=structuredClone(enabled);changed.d1_databases[0].database_id='acb3cb8e-69a2-459f-8a46-0f2f5b9004be';assert.equal(validatePublicationConfig(changed).ok,false);
});
test('tracked configuration remains generated and check CLI does not change activation',()=>{
 const config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.production-publication.jsonc'),'utf8'));assert.ok(['disabled','enabled'].includes(config.vars.REXBID_TAXONOMY_CACHE_ENABLED));
 const original=fs.readFileSync(path.join(root,'wrangler.production-publication.jsonc'),'utf8');
 const child=spawnSync(process.execPath,[path.join(root,'scripts/prepare-production-publication.cjs'),'--check','--evidence',path.join(root,'config/rexbid-accounts-readiness-20261014.json')],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).generated_file_consistent,true);assert.equal(fs.readFileSync(path.join(root,'wrangler.production-publication.jsonc'),'utf8'),original);
});
