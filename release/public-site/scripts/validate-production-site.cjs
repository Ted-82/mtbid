'use strict';
const fs=require('node:fs'),path=require('node:path');
const ORIGIN='https://rexbid.pl',DB='971879fe-04ed-4e8c-9dc6-5306980bb872';
function validateProductionSite(config){
 const issues=[],v=config.vars||{},db=config.d1_databases||[];
 if(config.name!=='mtbid'||config.main!=='./worker.js')issues.push('working_provider_backed_entrypoint_required');
 if(db.length!==1||db[0].binding!=='REXBID_DB'||db[0].database_name!=='rexbid-db'||db[0].database_id!==DB)issues.push('production_database_required');
 if(config.workers_dev!==false||config.preview_urls!==false||JSON.stringify(config.routes)!==JSON.stringify([{pattern:'rexbid.pl',custom_domain:true}]))issues.push('exact_custom_domain_required');
 if(config.assets?.directory!=='./public'||config.assets?.binding!=='ASSETS'||config.assets?.run_worker_first!==true)issues.push('all_assets_require_worker_guards');
 if(v.REXBID_CANONICAL_ORIGIN!==ORIGIN||v.REXBID_RELEASE_ORIGIN!==ORIGIN||v.REXBID_RELEASE_D1_TARGET!=='rexbid-db'||v.REXBID_RELEASE_D1_DATABASE_ID!==DB)issues.push('production_ui_identity_required');
 if(v.REXBID_PRODUCTION_UI_ENABLED!=='enabled'||v.REXBID_PRODUCTION_RELEASE_ENABLED!==undefined)issues.push('use_site_ui_gate_not_disabled_release_wrapper');
 for(const feature of ['TRANSPORT_CALCULATOR','CALCULATOR_V3','CALCULATOR_V4'])if(v[`REXBID_${feature}_ENABLED`]!=='enabled'||v[`REXBID_${feature}_ALLOWED_ORIGINS`]!==ORIGIN)issues.push('calculator_origin:'+feature);
 for(const key of ['AUTH_ENABLED','REXBID_D1_PRIMARY_READS','REXBID_LEGACY_SYNC_ENABLED'])if(v[key]!=='false')issues.push('inactive:'+key);
 for(const key of ['REXBID_PORTAL_ENABLED','REXBID_PORTAL_FILES_ENABLED'])if(v[key]!=='disabled')issues.push('inactive:'+key);
 if(v.REXBID_PROVIDER_BUDGET_MODE!=='required')issues.push('budget_required');
 for(const [key,value] of Object.entries({DAILY:'500',CATALOG_DAILY:'250',DETAIL_DAILY:'150',HISTORY_DAILY:'60',DISCOVERY_DAILY:'0',MEDIA_DAILY:'0'}))if(v[`REXBID_PROVIDER_BUDGET_${key}_LIMIT`]!==value)issues.push('budget:'+key);
 if(config.triggers?.crons?.length||config.r2_buckets?.length)issues.push('unprovisioned_schedule_or_storage');
 if(/rexbid-auth-test|acb3cb8e|staging-bypass|__staging|OWNER_REVIEW|AUTH_TEST|AUTH_DIAGNOSTICS|MFA_PENDING_RESTART|SUPABASE|PORTAL_DATA_KEYS|COOKIE_SECRET/.test(JSON.stringify(config)))issues.push('staging_or_secret_leak');
 return{ok:issues.length===0,issues,status:'prepared_not_deployed',worker:config.name,database:db[0]?.database_name,origin:ORIGIN,entrypoint:config.main,
  site_read_mode:'provider',auth_enabled:false,portal_enabled:false,launch_ready:false,
  activation_prerequisites:['owner_deploy_approval','domain_zone_tls','fresh_backup','production_secret_metadata_check','accounts_portal_configuration_and_schema_before_activation','smtp_recovery_e2e','legal_commercial_review']};
}
if(require.main===module){const result=validateProductionSite(JSON.parse(fs.readFileSync(path.resolve(__dirname,'../wrangler.rexbid-production.jsonc'),'utf8')));console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;}
module.exports={validateProductionSite};
