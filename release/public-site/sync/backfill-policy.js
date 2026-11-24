"use strict";

function positiveDuration(env,key,fallback){
  const raw=env?.[key];
  if(raw===undefined||raw===null||raw==="")return fallback;
  if(!/^\d+$/.test(String(raw)))throw new TypeError(`Nieprawidłowa konfiguracja ${key}.`);
  const value=Number(raw);if(!Number.isSafeInteger(value)||value<1)throw new TypeError(`Nieprawidłowa konfiguracja ${key}.`);
  return value;
}

function freshnessPolicyFromEnv(env={}){
  return Object.freeze({
    hotIntervalMs:positiveDuration(env,"REXBID_SYNC_HOT_INTERVAL_MS",5*60_000),
    warmIntervalMs:positiveDuration(env,"REXBID_SYNC_WARM_INTERVAL_MS",6*60*60_000),
    coldIntervalMs:positiveDuration(env,"REXBID_SYNC_COLD_INTERVAL_MS",7*24*60*60_000),
    hotWindowMs:positiveDuration(env,"REXBID_SYNC_HOT_WINDOW_MS",2*60*60_000)
  });
}

/**
 * `stale` is a derived read/freshness state, never a persisted scope status.
 * It keeps the schema's partial/complete/failed state intact for safe resume.
 */
function classifyScopeState(scope,{now,staleAfterMs}){
  const at=now instanceof Date?now.getTime():Number(now);
  if(!Number.isFinite(at)||!Number.isSafeInteger(staleAfterMs)||staleAfterMs<1)throw new TypeError("Wymagany jest jawny czas i staleAfterMs.");
  if(!scope||typeof scope!=="object")return "stale";
  if(scope.status==="failed"||scope.status==="blocked")return "failed";
  if(!["partial","complete"].includes(scope.status))return "stale";
  const freshnessAnchor=scope.status==="complete"?scope.last_complete_at:(scope.cursor_updated_at||scope.last_attempt_at||scope.updated_at);
  const synced=Date.parse(freshnessAnchor||"");
  if(!Number.isFinite(synced)||at-synced>staleAfterMs)return "stale";
  return scope.status;
}

module.exports={freshnessPolicyFromEnv,classifyScopeState};
