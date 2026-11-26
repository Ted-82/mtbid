'use strict';

// This is a personal-data export. Even the configured owner receives only
// records for which their own account is the customer, never an admin dump.
const PATH = '/api/portal/export';
const SCHEMA_VERSION = 'rexbid-personal-export-v1';
const PAGE_SIZE = 50;
const CURSOR_TTL_MS = 30 * 60 * 1000;
const SECTIONS = Object.freeze(['account','profile','favorites','orders','events','messages','files']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const JSON_HEADERS = {
  'Content-Type':'application/json; charset=UTF-8', 'Cache-Control':'private, no-store',
  Pragma:'no-cache', 'Referrer-Policy':'no-referrer', 'X-Content-Type-Options':'nosniff',
  'X-Robots-Tag':'noindex, nofollow, noarchive', Vary:'Cookie',
  'Cross-Origin-Resource-Policy':'same-origin'
};
const CONSISTENCY = Object.freeze({
  mode:'created_at_cutoff_with_live_values',
  description:'Records created after as_of are excluded. Existing records are read when each page is requested; edits, deletions and visibility changes may affect subsequent pages. This is not a point-in-time database snapshot.',
  manifest_counts:'observed_live_when_manifest_is_read'
});

function response(data,status=200,cookies=[]) {
  const headers=new Headers(JSON_HEADERS);
  for(const cookie of cookies) headers.append('Set-Cookie',cookie);
  return new Response(JSON.stringify(data),{status,headers});
}
function failure(error,status,cookies=[]) { return response({ok:false,error},status,cookies); }
function validUserId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 80 && !/[\s\u0000-\u001f\u007f]/.test(value); }
function isConfigured(request,env,resolveAccount,protection,cryptoImpl) {
  if(env?.REXBID_PORTAL_ENABLED !== 'enabled' || env?.REXBID_PORTAL_SCHEMA_VERSION !== '0006' || env?.AUTH_ENABLED !== 'true'
    || !validUserId(env.REXBID_OWNER_USER_ID) || typeof env.REXBID_DB?.prepare !== 'function'
    || typeof resolveAccount !== 'function' || typeof protection?.protect !== 'function' || typeof protection?.unprotect !== 'function'
    || typeof protection?.configured !== 'function' || protection.configured(env) !== true || typeof cryptoImpl?.randomUUID !== 'function') return false;
  try {
    const canonical=new URL(env.AUTH_CANONICAL_ORIGIN);
    return canonical.protocol === 'https:' && canonical.origin === env.AUTH_CANONICAL_ORIGIN && !canonical.username && !canonical.password
      && canonical.pathname === '/' && !canonical.search && !canonical.hash && new URL(request.url).origin === canonical.origin
      && String(env.AUTH_ALLOWED_ORIGINS || '').split(',').map(value=>value.trim()).includes(canonical.origin);
  } catch { return false; }
}
function isSameOriginRead(request) {
  const origin=request.headers.get('Origin'), fetchSite=request.headers.get('Sec-Fetch-Site');
  return (!origin || origin === new URL(request.url).origin) && (!fetchSite || fetchSite === 'same-origin' || fetchSite === 'none');
}
function instant(value) {
  const date=new Date(value);
  if(!Number.isFinite(date.getTime())) throw new Error('unavailable');
  return {iso:date.toISOString(),ms:date.getTime()};
}
function validTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19) === value.slice(0,19);
}
function queryFor(section) {
  switch(section) {
    case 'account': return {from:'users r',scope:'r.id = ?',key:'id'};
    case 'profile': return {from:'portal_customer_profiles r',scope:'r.user_id = ?',key:'user_id'};
    case 'favorites': return {from:'user_favorites r',scope:'r.user_id = ?',key:'favorite_key'};
    case 'orders': return {from:'import_orders r',scope:'r.client_user_id = ?',key:'id'};
    case 'events': return {from:'import_order_events r JOIN import_orders o ON o.id = r.order_id',scope:"o.client_user_id = ? AND r.visibility = 'client'",key:'id',parentCutoff:true};
    case 'messages': return {from:'import_order_messages r JOIN import_orders o ON o.id = r.order_id',scope:'o.client_user_id = ?',key:'id',parentCutoff:true};
    case 'files': return {from:'import_order_files r JOIN import_orders o ON o.id = r.order_id',scope:"o.client_user_id = ? AND r.visibility = 'client'",key:'id',parentCutoff:true};
    default: throw new Error('invalid_cursor');
  }
}
function scopedWhere(section,userId,asOf,lastKey=null) {
  const descriptor=queryFor(section), conditions=[descriptor.scope,'julianday(r.created_at) <= julianday(?)'], values=[userId,asOf];
  if(descriptor.parentCutoff) { conditions.push('julianday(o.created_at) <= julianday(?)'); values.push(asOf); }
  if(lastKey) {
    conditions.push(`(r.created_at > ? OR (r.created_at = ? AND r.${descriptor.key} > ?))`);
    values.push(lastKey.created_at,lastKey.created_at,lastKey.id);
  }
  return {descriptor,where:conditions.join(' AND '),values};
}
function pick(row,keys) { return Object.fromEntries(keys.map(key=>[key,row[key] ?? null])); }
function contactDto(parsed) {
  if(!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('unavailable');
  for(const key of ['name','email','phone']) if(parsed[key] != null && typeof parsed[key] !== 'string') throw new Error('unavailable');
  return pick(parsed,['name','email','phone']);
}
async function exportDto(section,row,env,protection) {
  switch(section) {
    case 'account': return {...pick(row,['id','auth_provider','created_at','updated_at']),email_verified:!!row.email_verified};
    case 'profile': return {...contactDto(JSON.parse(await protection.unprotect(row.content_ciphertext,`portal:profile:${row.user_id}`,env))),created_at:row.created_at,updated_at:row.updated_at};
    case 'favorites': return {key:row.favorite_key,...pick(row,['vin','lot','platform','created_at','updated_at'])};
    case 'orders': return pick(row,['id','title','vin','lot','platform','status','location','estimated_arrival_at','vessel','container_number','version','created_at','updated_at']);
    case 'events': {
      const content=JSON.parse(await protection.unprotect(row.content_ciphertext,`portal:event:${row.order_id}:${row.id}`,env));
      if(!content || typeof content.message !== 'string') throw new Error('unavailable');
      return {...pick(row,['id','order_id','event_type','status','location','estimated_arrival_at','created_at']),message:content.message};
    }
    case 'messages': return {...pick(row,['id','order_id','created_at']),author:row.author_role,text:await protection.unprotect(row.content_ciphertext,`portal:message:${row.order_id}:${row.id}`,env)};
    case 'files': return {...pick(row,['id','order_id','filename','content_type','size_bytes','created_at']),download_url:`/api/portal/orders/${encodeURIComponent(row.order_id)}/files/${encodeURIComponent(row.id)}`};
    default: throw new Error('invalid_cursor');
  }
}

function createPortalExportHandler({resolveAccount,protection,cryptoImpl=globalThis.crypto,now=()=>new Date().toISOString()}={}) {
  return async function handle(request,env) {
    const url=new URL(request.url);
    if(url.pathname !== PATH) return null;
    if(request.method !== 'GET') return failure('method_not_allowed',405);
    if(!isConfigured(request,env,resolveAccount,protection,cryptoImpl)) return failure('unavailable',503);
    if(!isSameOriginRead(request)) return failure('forbidden',403);
    let cookies=[];
    try {
      const account=await resolveAccount(request,env); cookies=account?.cookies || [];
      if(!account?.user?.id || account.status !== 200) {
        const status=[403,429,503].includes(account?.status)?account.status:401;
        return failure(({403:'forbidden',429:'rate_limited',503:'unavailable'})[status] || 'unauthorized',status,cookies);
      }
      const userId=account.user.id;
      if(!validUserId(userId)) return failure('unauthorized',401,cookies);
      if(userId === env.REXBID_OWNER_USER_ID && account.assurance_level !== 'aal2') return failure('owner_mfa_required',403,cookies);
      const current=instant(now());
      const params=url.searchParams;
      if(url.search.length > 8192 || [...params.keys()].some(key=>!['section','cursor'].includes(key))
        || params.getAll('section').length > 1 || params.getAll('cursor').length > 1) return failure('invalid_request',400,cookies);
      const aad=`portal:export:${userId}`;
      if(!params.size) {
        const exportId=cryptoImpl.randomUUID(), expiresAt=new Date(current.ms+CURSOR_TTL_MS).toISOString(), sections=[];
        for(const section of SECTIONS) {
          const {descriptor,where,values}=scopedWhere(section,userId,current.iso);
          const countRow=await env.REXBID_DB.prepare(`SELECT COUNT(*) AS count FROM ${descriptor.from} WHERE ${where}`).bind(...values).first();
          const observedCount=Number(countRow?.count);
          if(!Number.isSafeInteger(observedCount) || observedCount < 0) throw new Error('unavailable');
          const startCursor=await protection.protect(JSON.stringify({version:1,export_id:exportId,user_id:userId,section,as_of:current.iso,expires_at:expiresAt,last_key:null}),aad,env);
          sections.push({section,observed_count:observedCount,start_cursor:startCursor});
        }
        return response({ok:true,schema_version:SCHEMA_VERSION,export_id:exportId,scope:'authenticated_account_and_own_customer_orders',as_of:current.iso,expires_at:expiresAt,
          page_size:PAGE_SIZE,consistency:CONSISTENCY,attachments:{included:'client_visible_metadata_and_authenticated_download_urls',file_bytes_included:false},sections},200,cookies);
      }
      const section=params.get('section'), token=params.get('cursor');
      if(!SECTIONS.includes(section) || typeof token !== 'string' || token.length > 4096 || !/^rxb1\.[A-Za-z0-9_-]+$/.test(token)) return failure('invalid_request',400,cookies);
      let cursor;
      try {
        cursor=JSON.parse(await protection.unprotect(token,aad,env));
        if(!cursor || Array.isArray(cursor) || Object.keys(cursor).sort().join(',') !== 'as_of,expires_at,export_id,last_key,section,user_id,version'
          || cursor.version !== 1 || !UUID.test(cursor.export_id) || cursor.user_id !== userId || cursor.section !== section
          || !validTimestamp(cursor.as_of) || !validTimestamp(cursor.expires_at)
          || Date.parse(cursor.as_of) > current.ms || Date.parse(cursor.expires_at)-Date.parse(cursor.as_of) !== CURSOR_TTL_MS) throw new Error();
        if(cursor.last_key !== null && (!cursor.last_key || Array.isArray(cursor.last_key)
          || Object.keys(cursor.last_key).sort().join(',') !== 'created_at,id' || !validTimestamp(cursor.last_key.created_at)
          || Date.parse(cursor.last_key.created_at) > Date.parse(cursor.as_of) || typeof cursor.last_key.id !== 'string'
          || cursor.last_key.id.length < 1 || cursor.last_key.id.length > 256 || /[\u0000-\u001f\u007f]/.test(cursor.last_key.id))) throw new Error();
      } catch { return failure('invalid_cursor',400,cookies); }
      if(Date.parse(cursor.expires_at) <= current.ms) return failure('export_expired',410,cookies);
      const {descriptor,where,values}=scopedWhere(section,userId,cursor.as_of,cursor.last_key);
      const rows=(await env.REXBID_DB.prepare(`SELECT r.* FROM ${descriptor.from} WHERE ${where} ORDER BY r.created_at ASC,r.${descriptor.key} ASC LIMIT ?`).bind(...values,PAGE_SIZE+1).all())?.results;
      if(!Array.isArray(rows)) throw new Error('unavailable');
      const pageRows=rows.slice(0,PAGE_SIZE), items=[];
      for(const row of pageRows) items.push(await exportDto(section,row,env,protection));
      let nextCursor=null;
      if(rows.length > PAGE_SIZE) {
        const last=pageRows.at(-1);
        const next={...cursor,last_key:{created_at:last.created_at,id:last[descriptor.key]}};
        if(!validTimestamp(next.last_key.created_at) || typeof next.last_key.id !== 'string') throw new Error('unavailable');
        nextCursor=await protection.protect(JSON.stringify(next),aad,env);
      }
      return response({ok:true,schema_version:SCHEMA_VERSION,export_id:cursor.export_id,section,scope:'authenticated_account_and_own_customer_orders',as_of:cursor.as_of,expires_at:cursor.expires_at,
        consistency:CONSISTENCY,items,next_cursor:nextCursor,section_complete:nextCursor === null},200,cookies);
    } catch { return failure('unavailable',503,cookies); }
  };
}

module.exports={createPortalExportHandler,SECTIONS,PAGE_SIZE,CURSOR_TTL_MS};
