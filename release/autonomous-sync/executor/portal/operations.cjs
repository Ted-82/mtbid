'use strict';

// Owner privileges come exclusively from a configured, immutable account ID.
// Public signup metadata, email addresses and database roles never grant them.
const STAGES = Object.freeze(['preparation','auction_won','payment_confirmed','pickup_planned','at_us_terminal','loaded','at_sea','at_eu_port','customs','delivery','delivered']);
const PREFIX = '/api/portal';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;
const JSON_HEADERS = { 'Content-Type':'application/json; charset=UTF-8', 'Cache-Control':'private, no-store', Pragma:'no-cache', 'Referrer-Policy':'no-referrer', 'X-Content-Type-Options':'nosniff', Vary:'Cookie', 'Cross-Origin-Resource-Policy':'same-origin' };

function response(data, status = 200, cookies = []) {
  const headers = new Headers(JSON_HEADERS);
  for (const cookie of cookies || []) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(data), {status, headers});
}
function fail(error, status, cookies) { return response({ok:false,error},status,cookies); }
function configured(request, env, dependencies) {
  if (env?.REXBID_PORTAL_ENABLED !== 'enabled' || env?.REXBID_PORTAL_SCHEMA_VERSION !== '0006' || env?.AUTH_ENABLED !== 'true'
    || typeof env.REXBID_OWNER_USER_ID !== 'string' || !env.REXBID_OWNER_USER_ID || env.REXBID_OWNER_USER_ID.length > 80 || /[\s\u0000-\u001f\u007f]/.test(env.REXBID_OWNER_USER_ID)
    || !env?.REXBID_DB || typeof env.REXBID_DB.prepare !== 'function' || typeof env.REXBID_DB.batch !== 'function'
    || typeof dependencies.resolveAccount !== 'function' || typeof dependencies.protect !== 'function' || typeof dependencies.unprotect !== 'function') return false;
  try {
    const canonical = new URL(env.AUTH_CANONICAL_ORIGIN);
    return canonical.protocol === 'https:' && canonical.origin === env.AUTH_CANONICAL_ORIGIN && !canonical.username && !canonical.password
      && canonical.pathname === '/' && !canonical.search && !canonical.hash && new URL(request.url).origin === canonical.origin
      && String(env.AUTH_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).includes(canonical.origin);
  } catch { return false; }
}
function sameOriginWrite(request) {
  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  return origin === new URL(request.url).origin && (!fetchSite || fetchSite === 'same-origin');
}
function text(value, max, nullable = false) {
  if (nullable && (value === null || value === '')) return null;
  if (typeof value !== 'string') throw new Error('invalid_request');
  const result = value.trim();
  if (!result || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) throw new Error('invalid_request');
  return result;
}
function onlyKeys(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw new Error('invalid_request');
}
async function bodyJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) throw new Error('invalid_request');
  const length = Number(request.headers.get('Content-Length') || 0);
  if (!Number.isFinite(length) || length > MAX_BODY_BYTES) throw new Error('invalid_request');
  if (!request.body) throw new Error('invalid_request');
  const reader = request.body.getReader(); let size = 0; const chunks = [];
  while (true) {
    const {done,value} = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('invalid_request'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { throw new Error('invalid_request'); }
}
function page(url) {
  const rawLimit = url.searchParams.get('limit') ?? '20', rawOffset = url.searchParams.get('offset') ?? '0';
  if (!/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawOffset)) throw new Error('invalid_request');
  const limit = Number(rawLimit), offset = Number(rawOffset);
  if (limit < 1 || limit > 50 || offset > 10000) throw new Error('invalid_request');
  return {limit,offset};
}
function orderDto(row, owner) {
  const dto = {id:row.id,title:row.title,vin:row.vin,lot:row.lot,platform:row.platform,status:row.status,location:row.location,
    estimated_arrival_at:row.estimated_arrival_at,vessel:row.vessel,container_number:row.container_number,
    version:row.version,created_at:row.created_at,updated_at:row.updated_at,unread_count:Number(row.unread_count || 0)};
  if (owner) { dto.client_user_id = row.client_user_id; if (Object.hasOwn(row,"client_profile")) dto.client_profile = row.client_profile; }
  return dto;
}
function fileDto(row, owner = false) {
  const dto = {id:row.id,filename:row.filename,content_type:row.content_type,size_bytes:row.size_bytes,created_at:row.created_at,
    download_url:`${PREFIX}/orders/${encodeURIComponent(row.order_id)}/files/${encodeURIComponent(row.id)}`};
  if (owner) dto.visibility = row.visibility;
  return dto;
}
function affected(result) { return Number(result?.meta?.changes ?? result?.changes ?? 0); }
function uuid(cryptoImpl) { return cryptoImpl.randomUUID(); }
function validEta(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('invalid_request');
  const iso = new Date(value).toISOString();
  if (iso.slice(0,19) !== value.slice(0,19)) throw new Error('invalid_request');
  return iso;
}

function createImportPortalHandler({resolveAccount,cryptoImpl=globalThis.crypto,protect,unprotect,protectionConfigured=()=>false,attachmentService,makeReplyDraft,now=()=>new Date().toISOString()} = {}) {
  const dependencies = {resolveAccount,protect,unprotect};
  return async function handle(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return null;
    const enabled = configured(request,env,dependencies) && typeof protectionConfigured === 'function' && protectionConfigured(env) === true;
    if (url.pathname === `${PREFIX}/config` && request.method === 'GET') return response({ok:true,enabled,uploads_enabled:enabled && attachmentService?.configured?.(env) === true});
    if (!enabled) return fail('unavailable',503);
    let cookies = [];
    try {
      if (!['GET','POST','PATCH'].includes(request.method)) return fail('method_not_allowed',405);
      if (request.method !== 'GET' && !sameOriginWrite(request)) return fail('forbidden',403);
      const account = await resolveAccount(request,env); cookies = account?.cookies || [];
      if (!account?.user?.id) {
        if (account?.status === 503) return fail('unavailable',503,cookies);
        if (account?.status === 429) return fail('rate_limited',429,cookies);
        if (account?.status === 403) return fail('forbidden',403,cookies);
        return fail('unauthorized',401,cookies);
      }
      const user = account.user, owner = user.id === env.REXBID_OWNER_USER_ID, role = owner ? 'owner' : 'client';
      if (owner && account.assurance_level !== 'aal2') return fail('owner_mfa_required',403,cookies);
      const db = env.REXBID_DB;
      // The server selects the recipient. A page URL or submitted role cannot
      // change the client/team read state or the persisted message sender.
      const audience = owner ? 'team' : 'client', incomingRole = owner ? 'client' : 'owner';
      const unreadSql = "(SELECT COUNT(*) FROM import_order_messages m WHERE m.order_id = import_orders.id AND m.author_role = ? AND NOT EXISTS (SELECT 1 FROM import_order_message_reads r WHERE r.message_id = m.id AND r.audience = ?)) AS unread_count";
      async function unreadCount(orderId) {
        const row = await db.prepare("SELECT COUNT(*) AS count FROM import_order_messages m WHERE m.order_id = ? AND m.author_role = ? AND NOT EXISTS (SELECT 1 FROM import_order_message_reads r WHERE r.message_id = m.id AND r.audience = ?)").bind(orderId,incomingRole,audience).first();
        return Number(row?.count || 0);
      }
      const reply = (data,status=200) => response({ok:true,role,...data},status,cookies);
      if (url.pathname === `${PREFIX}/me` && request.method === 'GET') return reply({user:{id:user.id},owner_mfa_required:false});

      async function profileFor(id) {
        const row = await db.prepare('SELECT content_ciphertext FROM portal_customer_profiles WHERE user_id = ?').bind(id).first();
        return row ? JSON.parse(await unprotect(row.content_ciphertext,`portal:profile:${id}`,env)) : null;
      }
      if (url.pathname === `${PREFIX}/profile`) {
        if (request.method === 'GET') return reply({profile:await profileFor(user.id)});
        if (request.method !== 'POST') return fail('method_not_allowed',405,cookies);
        const body = await bodyJson(request); onlyKeys(body,['name','email','phone']);
        const profile = {name:body.name == null || body.name === '' ? null : text(body.name,80),email:body.email == null || body.email === '' ? null : text(body.email,320).toLowerCase(),phone:body.phone == null || body.phone === '' ? null : text(body.phone,40)};
        if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) throw new Error('invalid_request');
        if (profile.phone && !/^[+()0-9 .-]{5,40}$/.test(profile.phone)) throw new Error('invalid_request');
        const cipher = await protect(JSON.stringify(profile),`portal:profile:${user.id}`,env), timestamp = now();
        await db.prepare('INSERT INTO portal_customer_profiles (user_id,content_ciphertext,created_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET content_ciphertext=excluded.content_ciphertext,updated_at=excluded.updated_at').bind(user.id,cipher,timestamp,timestamp).run();
        return reply({profile});
      }
      if (url.pathname === `${PREFIX}/clients`) {
        if (!owner) return fail('forbidden',403,cookies);
        if (request.method !== 'GET') return fail('method_not_allowed',405,cookies);
        const {limit,offset} = page(url);
        const rows = (await db.prepare('SELECT id,created_at FROM users WHERE email_verified = 1 ORDER BY created_at DESC,id LIMIT ? OFFSET ?').bind(limit+1,offset).all()).results || [];
        const clients = [];
        for (const row of rows.slice(0,limit)) clients.push({id:row.id,created_at:row.created_at,account_type:row.id === env.REXBID_OWNER_USER_ID ? "owner" : "client",profile:await profileFor(row.id)});
        return reply({clients,pagination:{limit,offset,has_more:rows.length>limit}});
      }

      if (url.pathname === `${PREFIX}/orders`) {
        if (request.method === 'GET') {
          const {limit,offset} = page(url);
          const sql = owner ? 'SELECT import_orders.*, ' + unreadSql + ' FROM import_orders ORDER BY updated_at DESC,id LIMIT ? OFFSET ?' : 'SELECT import_orders.*, ' + unreadSql + ' FROM import_orders WHERE client_user_id = ? ORDER BY updated_at DESC,id LIMIT ? OFFSET ?';
          const rows = (await db.prepare(sql).bind(incomingRole,audience,...(owner ? [limit+1,offset] : [user.id,limit+1,offset])).all()).results || [];
          const orders = await Promise.all(rows.slice(0,limit).map(async row=>orderDto(owner ? {...row,client_profile:await profileFor(row.client_user_id)} : row,owner)));
          return reply({orders,pagination:{limit,offset,has_more:rows.length>limit}});
        }
        if (request.method !== 'POST') return fail('method_not_allowed',405,cookies);
        if (!owner) return fail('forbidden',403,cookies);
        const body = await bodyJson(request);
        onlyKeys(body,['client_user_id','title','vin','lot','platform']);
        const client = text(body.client_user_id,80), title = text(body.title,160);
        const vin = body.vin == null || body.vin === '' ? null : text(body.vin,17).toUpperCase();
        const lot = body.lot == null || body.lot === '' ? null : text(body.lot,32).toUpperCase();
        const platform = body.platform == null || body.platform === '' ? null : text(body.platform,16).toLowerCase();
        if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new Error('invalid_request');
        if (lot && !/^[A-Z0-9-]{1,32}$/.test(lot)) throw new Error('invalid_request');
        if (!!lot !== !!platform || (platform && !['copart','iaai'].includes(platform)) || (!vin && !lot)) throw new Error('invalid_request');
        if (!await db.prepare('SELECT id FROM users WHERE id = ? AND email_verified = 1').bind(client).first()) throw new Error('invalid_request');
        const id = uuid(cryptoImpl), eventId = uuid(cryptoImpl), timestamp = now();
        const cipher = await protect(JSON.stringify({message:'Utworzono sprawę importu.'}),`portal:event:${id}:${eventId}`,env);
        await db.batch([
          db.prepare('INSERT INTO import_orders (id,client_user_id,title,vin,lot,platform,last_change_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id,client,title,vin,lot,platform,eventId,user.id,timestamp,timestamp),
          db.prepare("INSERT INTO import_order_events (id,order_id,event_type,visibility,status,content_ciphertext,created_by,created_at) VALUES (?,?,'created','client','preparation',?,?,?)").bind(eventId,id,cipher,user.id,timestamp)
        ]);
        return reply({order:orderDto(await db.prepare('SELECT * FROM import_orders WHERE id = ?').bind(id).first(),true)},201);
      }

      const match = url.pathname.match(/^\/api\/portal\/orders\/([^/]+)(?:\/(messages|events|files|reply-draft|read)(?:\/([^/]+))?)?$/);
      if (!match || !UUID.test(match[1])) return fail('not_found',404,cookies);
      const orderId = match[1], action = match[2] || '', fileId = match[3] || '';
      const orderSql = owner ? 'SELECT * FROM import_orders WHERE id = ?' : 'SELECT * FROM import_orders WHERE id = ? AND client_user_id = ?';
      const order = await db.prepare(orderSql).bind(...(owner ? [orderId] : [orderId,user.id])).first();
      // Authorization precedes every metadata query, decryption and R2 access.
      if (!order) return fail('not_found',404,cookies);

      async function readEvents(limit=100,offset=0,clientVisibleOnly=false) {
        const sql = owner && !clientVisibleOnly ? 'SELECT * FROM import_order_events WHERE order_id = ? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?'
          : "SELECT * FROM import_order_events WHERE order_id = ? AND visibility = 'client' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?";
        const rows = (await db.prepare(sql).bind(orderId,limit+1,offset).all()).results || [];
        const result = [];
        for (const row of rows.slice(0,limit)) {
          const payload = JSON.parse(await unprotect(row.content_ciphertext,`portal:event:${orderId}:${row.id}`,env));
          const dto = {id:row.id,event_type:row.event_type,status:row.status,message:String(payload.message || ''),location:row.location,estimated_arrival_at:row.estimated_arrival_at,created_at:row.created_at};
          if (owner) dto.visibility = row.visibility;
          result.push(dto);
        }
        return {items:result,pagination:{limit,offset,has_more:rows.length>limit}};
      }
      async function readMessages(limit=50,offset=0) {
        const rows = (await db.prepare('SELECT m.*, EXISTS (SELECT 1 FROM import_order_message_reads r WHERE r.message_id = m.id AND r.audience = ?) AS is_read FROM import_order_messages m WHERE order_id = ? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').bind(audience,orderId,limit+1,offset).all()).results || [];
        const result = [];
        for (const row of rows.slice(0,limit)) result.push({id:row.id,author:row.author_role,text:await unprotect(row.content_ciphertext,`portal:message:${orderId}:${row.id}`,env),created_at:row.created_at,unread:row.author_role === incomingRole && Number(row.is_read) !== 1});
        return {items:result,pagination:{limit,offset,has_more:rows.length>limit}};
      }
      async function readFiles(limit=50,offset=0,clientVisibleOnly=false) {
        const sql = owner && !clientVisibleOnly ? 'SELECT * FROM import_order_files WHERE order_id = ? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?'
          : "SELECT * FROM import_order_files WHERE order_id = ? AND visibility = 'client' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?";
        const rows = (await db.prepare(sql).bind(orderId,limit+1,offset).all()).results || [];
        return {items:rows.slice(0,limit).map(row=>fileDto(row,owner)),pagination:{limit,offset,has_more:rows.length>limit}};
      }
      if (!action && request.method === 'GET') {
        const [events,messages,files,unread,stages,clientProfile] = await Promise.all([readEvents(),readMessages(),readFiles(),unreadCount(orderId),
          db.prepare("SELECT DISTINCT status FROM import_order_events WHERE order_id = ? AND visibility = 'client' AND event_type IN ('created','update') AND status IS NOT NULL").bind(orderId).all(),owner ? profileFor(order.client_user_id) : null]);
        // Evidence is collected from all client-visible history, independent of
        // pagination. No missing stage is inferred from a later transport step.
        const confirmedStages = STAGES.filter(stage => (stages.results || []).some(row => row.status === stage));
        return reply({order:orderDto({...order,unread_count:unread,...(owner ? {client_profile:clientProfile} : {})},owner),confirmed_stages:confirmedStages,events:events.items,messages:messages.items,files:files.items,
          pagination:{events:events.pagination,messages:messages.pagination,files:files.pagination}});
      }
      if (!action && request.method === 'PATCH') {
        if (!owner) return fail('forbidden',403,cookies);
        const body = await bodyJson(request);
        onlyKeys(body,['expected_version','status','location','estimated_arrival_at','vessel','container_number','event_message','event_visibility']);
        if (!Number.isSafeInteger(body.expected_version) || body.expected_version < 1) throw new Error('invalid_request');
        const visibility = body.event_visibility ?? 'client';
        if (!['client','internal'].includes(visibility)) throw new Error('invalid_request');
        const message = body.event_message == null ? '' : text(body.event_message,4000);
        const fields = ['status','location','estimated_arrival_at','vessel','container_number'];
        if (!fields.some(key=>Object.hasOwn(body,key)) && !message) throw new Error('invalid_request');
        if (visibility === 'internal' && fields.some(key=>Object.hasOwn(body,key))) throw new Error('invalid_request');
        const values = {...order};
        if (Object.hasOwn(body,'status')) { if (!STAGES.includes(body.status)) throw new Error('invalid_request'); values.status = body.status; }
        for (const key of ['location','vessel','container_number']) if (Object.hasOwn(body,key)) values[key] = text(body[key],key==='location'?240:120,true);
        if (Object.hasOwn(body,'estimated_arrival_at')) values.estimated_arrival_at = validEta(body.estimated_arrival_at);
        const eventId = uuid(cryptoImpl), timestamp = now();
        const cipher = await protect(JSON.stringify({message}),`portal:event:${orderId}:${eventId}`,env);
        let changes;
        if (visibility === 'internal') {
          // Internal notes do not alter client-visible version/timestamp/facts.
          changes = affected(await db.prepare("INSERT INTO import_order_events (id,order_id,event_type,visibility,content_ciphertext,created_by,created_at) SELECT ?,id,'note','internal',?,?,? FROM import_orders WHERE id = ? AND version = ?").bind(eventId,cipher,user.id,timestamp,orderId,body.expected_version).run());
        } else {
          const results = await db.batch([
            db.prepare('UPDATE import_orders SET status=?,location=?,estimated_arrival_at=?,vessel=?,container_number=?,version=version+1,last_change_id=?,updated_at=? WHERE id=? AND version=?').bind(values.status,values.location,values.estimated_arrival_at,values.vessel,values.container_number,eventId,timestamp,orderId,body.expected_version),
            db.prepare("INSERT INTO import_order_events (id,order_id,event_type,visibility,status,location,estimated_arrival_at,content_ciphertext,created_by,created_at) SELECT ?,id,'update','client',status,location,estimated_arrival_at,?,?,? FROM import_orders WHERE id = ? AND last_change_id = ?").bind(eventId,cipher,user.id,timestamp,orderId,eventId)
          ]);
          changes = affected(results[0]);
        }
        if (!changes) return fail('conflict',409,cookies);
        return reply({order:orderDto(await db.prepare('SELECT * FROM import_orders WHERE id = ?').bind(orderId).first(),true)});
      }
      if (action === 'read' && !fileId) {
        if (request.method !== 'POST') return fail('method_not_allowed',405,cookies);
        const body = await bodyJson(request); onlyKeys(body,['message_ids']);
        const ids = body.message_ids;
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50 || ids.some(id => typeof id !== 'string' || !UUID.test(id)) || new Set(ids).size !== ids.length) throw new Error('invalid_request');
        const placeholders = ids.map(() => '?').join(',');
        const messages = (await db.prepare('SELECT id FROM import_order_messages WHERE order_id = ? AND author_role = ? AND id IN (' + placeholders + ')').bind(orderId,incomingRole,...ids).all()).results || [];
        if (messages.length !== ids.length) throw new Error('invalid_request');
        const timestamp = now();
        await db.batch(ids.map(id => db.prepare('INSERT INTO import_order_message_reads (message_id,audience,read_at) SELECT id,?,? FROM import_order_messages WHERE id = ? AND order_id = ? AND author_role = ? ON CONFLICT(message_id,audience) DO NOTHING').bind(audience,timestamp,id,orderId,incomingRole)));
        return reply({read_message_ids:ids,unread_count:await unreadCount(orderId)});
      }
      if (action === 'events' && !fileId && request.method === 'GET') {
        const {limit,offset}=page(url), result=await readEvents(limit,offset);
        return reply({events:result.items,pagination:result.pagination});
      }
      if (action === 'messages' && !fileId) {
        if (request.method === 'GET') {
          const {limit,offset}=page(url), result=await readMessages(limit,offset);
          return reply({messages:result.items,pagination:result.pagination});
        }
        if (request.method !== 'POST') return fail('method_not_allowed',405,cookies);
        const body = await bodyJson(request); onlyKeys(body,['text']);
        const clear = text(body.text,4000), id = uuid(cryptoImpl), timestamp = now();
        const cipher = await protect(clear,`portal:message:${orderId}:${id}`,env);
        await db.prepare('INSERT INTO import_order_messages (id,order_id,author_user_id,author_role,content_ciphertext,created_at) VALUES (?,?,?,?,?,?)').bind(id,orderId,user.id,role,cipher,timestamp).run();
        return reply({message:{id,author:role,text:clear,created_at:timestamp}},201);
      }
      if (action === 'files') {
        if (fileId) {
          if (!UUID.test(fileId) || request.method !== 'GET') return fail('not_found',404,cookies);
          const sql = owner ? 'SELECT * FROM import_order_files WHERE id = ? AND order_id = ?' : "SELECT * FROM import_order_files WHERE id = ? AND order_id = ? AND visibility = 'client'";
          const file = await db.prepare(sql).bind(fileId,orderId).first();
          if (!file) return fail('not_found',404,cookies);
          if (typeof attachmentService?.download !== 'function') return fail('unavailable',503,cookies);
          const result = await attachmentService.download({request,env,order,file,user});
          if (!(result instanceof Response)) return fail('unavailable',503,cookies);
          const headers = new Headers(result.headers);
          for (const [key,value] of Object.entries(JSON_HEADERS)) if (key !== 'Content-Type') headers.set(key,value);
          for (const cookie of cookies) headers.append('Set-Cookie',cookie);
          return new Response(result.body,{status:result.status,headers});
        }
        if (request.method === 'GET') {
          const {limit,offset}=page(url), result=await readFiles(limit,offset);
          return reply({files:result.items,pagination:result.pagination});
        }
        if (request.method !== 'POST') return fail('method_not_allowed',405,cookies);
        if (!owner) return fail('forbidden',403,cookies);
        if (typeof attachmentService?.upload !== 'function') return fail('unavailable',503,cookies);
        const id = uuid(cryptoImpl), timestamp = now();
        const file = await attachmentService.upload({request,env,order,user,fileId:id});
        if (!file || typeof file.object_key !== 'string' || typeof file.filename !== 'string' || typeof file.content_type !== 'string'
          || !Number.isSafeInteger(file.size_bytes) || file.size_bytes < 1 || !/^[a-f0-9]{64}$/i.test(file.sha256 || '') || !['client','internal'].includes(file.visibility)) throw new Error('unavailable');
        try {
          await db.prepare('INSERT INTO import_order_files (id,order_id,object_key,filename,content_type,size_bytes,sha256,visibility,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id,orderId,file.object_key,file.filename,file.content_type,file.size_bytes,file.sha256,file.visibility,user.id,timestamp).run();
        } catch (error) { if (typeof attachmentService.remove === 'function') await attachmentService.remove({env,objectKey:file.object_key}); throw error; }
        return reply({file:fileDto({id,order_id:orderId,...file,created_at:timestamp},owner)},201);
      }
      if (action === 'reply-draft' && !fileId && request.method === 'GET') {
        if (!owner) return fail('forbidden',403,cookies);
        const kind = url.searchParams.get('kind') || 'status_update';
        if (!['status_update','documents_ready','delay','payment_received'].includes(kind)) throw new Error('invalid_request');
        if (typeof makeReplyDraft !== 'function') return fail('unavailable',503,cookies);
        const [events,files] = await Promise.all([readEvents(100,0,true),readFiles(50,0,true)]);
        // A payment confirmation can be older than the latest source page.
        // Look up that explicit client-visible fact rather than infer payment
        // from a later transport stage or scan/decrypt all historical notes.
        if (kind === 'payment_received' && order.status !== 'payment_confirmed' && events.pagination.has_more
          && !events.items.some(event=>event.status === 'payment_confirmed')) {
          const confirmation = await db.prepare("SELECT * FROM import_order_events WHERE order_id = ? AND visibility = 'client' AND status = 'payment_confirmed' ORDER BY created_at DESC,id DESC LIMIT 1").bind(orderId).first();
          if (confirmation) {
            const payload = JSON.parse(await unprotect(confirmation.content_ciphertext,`portal:event:${orderId}:${confirmation.id}`,env));
            events.items.push({id:confirmation.id,event_type:confirmation.event_type,status:confirmation.status,message:String(payload.message || ''),
              location:confirmation.location,estimated_arrival_at:confirmation.estimated_arrival_at,created_at:confirmation.created_at,visibility:'client'});
          }
        }
        const draft = await makeReplyDraft({kind,order:orderDto(order,true),events:events.items,files:files.items});
        return reply({draft,source_pagination:{events:events.pagination,files:files.pagination},source_complete:!events.pagination.has_more && !files.pagination.has_more});
      }
      return fail('method_not_allowed',405,cookies);
    } catch (error) {
      if (error?.message === 'invalid_request') return fail('invalid_request',400,cookies);
      if ([400,413,415,429].includes(error?.status) && ['invalid_file','file_too_large','unsupported_file','rate_limited'].includes(error?.code)) return fail(error.code,error.status,cookies);
      // No SQL, encryption error, provider token or internal identifier in replies.
      return fail('unavailable',503,cookies);
    }
  };
}

module.exports = {createImportPortalHandler,STAGES};
