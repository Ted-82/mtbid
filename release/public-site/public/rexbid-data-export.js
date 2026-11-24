(function(root) {
  'use strict';

  const SECTIONS=Object.freeze(['account','profile','favorites','orders','events','messages','files']);
  const PAGE_SIZE=50, MAX_BYTES=100*1024*1024, MAX_PAGES=10000, REQUEST_TIMEOUT_MS=10000;
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const ITEM_FIELDS={
    account:['id','auth_provider','email_verified','created_at','updated_at'],
    profile:['name','email','phone','created_at','updated_at'],
    favorites:['key','vin','lot','platform','created_at','updated_at'],
    orders:['id','title','vin','lot','platform','status','location','estimated_arrival_at','vessel','container_number','version','created_at','updated_at'],
    events:['id','order_id','event_type','status','location','estimated_arrival_at','created_at','message'],
    messages:['id','order_id','created_at','author','text'],
    files:['id','order_id','filename','content_type','size_bytes','created_at','download_url']
  };
  let active=null;
  function problem(code,status) { return Object.assign(new Error(code),{code,...(status?{status}:{})}); }
  function identity(getIdentity) {
    try {
      const id=getIdentity();
      return typeof id==='string' && id.length>0 && id.length<=80 && !/[\s\u0000-\u001f\u007f]/.test(id)?id:null;
    } catch { return null; }
  }
  function defaultIdentity() { return root.RexBidAuth?.enabled && root.RexBidAuth.status==='authenticated'?root.RexBidAuth.user?.id:null; }
  function isObject(value) { return !!value && typeof value==='object' && !Array.isArray(value); }
  function timestamp(value) { return typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)); }
  function cursor(value) { return typeof value==='string' && value.length<=4096 && /^rxb1\.[A-Za-z0-9_-]+$/.test(value); }
  function pick(value,fields) {
    if(!isObject(value)) throw problem('EXPORT_RESPONSE_INVALID');
    const result={};
    for(const field of fields) if(Object.hasOwn(value,field)) {
      const item=value[field];
      if(item!==null && !['string','number','boolean'].includes(typeof item)) throw problem('EXPORT_RESPONSE_INVALID');
      result[field]=item;
    }
    return result;
  }
  function utf8TextSize(text) {
    let bytes=0;
    for(const char of text) { const code=char.codePointAt(0); bytes+=code<128?1:code<2048?2:code<65536?3:4; }
    return bytes;
  }
  function utf8Size(value) { return utf8TextSize(JSON.stringify(value)); }
  function createSession(options) {
    if(active) throw problem('EXPORT_BUSY');
    const getIdentity=options.getIdentity || defaultIdentity, userId=identity(getIdentity);
    if(!userId) throw problem('EXPORT_UNAUTHORIZED',401);
    const controller=new root.AbortController();
    let reason=null,rejectCancelled;
    const cancelled=new Promise((_,reject)=>{rejectCancelled=reject;});
    // The request races attach the real rejection handler; this also covers
    // pagehide between requests without creating an unhandled rejection.
    cancelled.catch(()=>{});
    const cancel=code=>{
      if(reason) return;
      reason=problem(code || 'EXPORT_CANCELLED'); controller.abort(); rejectCancelled(reason);
    };
    const guard=()=>{
      if(reason) throw reason;
      if(identity(getIdentity)!==userId) { cancel('EXPORT_IDENTITY_CHANGED');throw reason; }
    };
    const onAuth=event=>{
      if(event.detail?.status && event.detail.status!=='authenticated') cancel('EXPORT_IDENTITY_CHANGED');
      else if(identity(getIdentity)!==userId) cancel('EXPORT_IDENTITY_CHANGED');
    };
    const onPageHide=()=>cancel('EXPORT_CANCELLED');
    const onAbort=()=>cancel('EXPORT_CANCELLED');
    root.addEventListener('rexbid:auth-state',onAuth);root.addEventListener('pagehide',onPageHide);
    options.signal?.addEventListener('abort',onAbort,{once:true});
    if(options.signal?.aborted) cancel('EXPORT_CANCELLED');
    const session={userId,getIdentity,guard,cancel,controller,cancelled,bytes:0,pages:0,
      maxBytes:Math.min(MAX_BYTES,Number.isSafeInteger(options.maxBytes) && options.maxBytes>0?options.maxBytes:MAX_BYTES),
      maxPages:Math.min(MAX_PAGES,Number.isSafeInteger(options.maxPages) && options.maxPages>0?options.maxPages:MAX_PAGES),
      onProgress:typeof options.onProgress==='function'?options.onProgress:null,
      cleanup(){root.removeEventListener('rexbid:auth-state',onAuth);root.removeEventListener('pagehide',onPageHide);options.signal?.removeEventListener('abort',onAbort);if(active===session)active=null;}
    };
    active=session;
    return session;
  }
  async function readJson(path,session,options) {
    session.guard();
    const fetchImpl=options.fetchImpl || root.fetch.bind(root);
    const timeoutMs=Math.min(REQUEST_TIMEOUT_MS,Number.isSafeInteger(options.timeoutMs) && options.timeoutMs>0?options.timeoutMs:REQUEST_TIMEOUT_MS);
    const timer=root.setTimeout(()=>session.cancel('EXPORT_TIMEOUT'),timeoutMs);
    try {
      const response=await Promise.race([Promise.resolve().then(()=>fetchImpl(path,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal:session.controller.signal})),session.cancelled]);
      session.guard();
      if(!response || response.redirected===true || (response.url && new URL(response.url,root.location.href).origin!==root.location.origin)) throw problem('EXPORT_RESPONSE_INVALID');
      let body;
      try { body=await Promise.race([response.json(),session.cancelled]); } catch(error) { session.guard();throw error?.code?error:problem('EXPORT_RESPONSE_INVALID'); }
      session.guard();
      if(!response.ok || body?.ok!==true) {
        const status=response.status;
        const code=status===401?'EXPORT_UNAUTHORIZED':status===403 && body?.error==='owner_mfa_required'?'EXPORT_OWNER_MFA_REQUIRED':status===403?'EXPORT_FORBIDDEN':status===410?'EXPORT_EXPIRED':status===429?'EXPORT_RATE_LIMITED':'EXPORT_UNAVAILABLE';
        throw problem(code,status);
      }
      session.bytes+=utf8Size(body);
      if(session.bytes>session.maxBytes) throw problem('EXPORT_TOO_LARGE');
      return body;
    } catch(error) { session.guard();throw error?.code?error:problem('EXPORT_NETWORK_FAILURE'); }
    finally { root.clearTimeout(timer); }
  }
  function cleanItem(section,item,userId) {
    const clean=pick(item,ITEM_FIELDS[section]);
    if(section==='account' && clean.id!==userId) throw problem('EXPORT_IDENTITY_CHANGED');
    if(!['account','profile'].includes(section) && typeof clean[section==='favorites'?'key':'id']!=='string') throw problem('EXPORT_RESPONSE_INVALID');
    if(section==='files' && (typeof clean.download_url!=='string' || !/^\/api\/portal\/orders\/[a-f0-9-]{36}\/files\/[a-f0-9-]{36}$/i.test(clean.download_url)
      || !UUID.test(clean.order_id) || !UUID.test(clean.id) || clean.download_url!==`/api/portal/orders/${clean.order_id}/files/${clean.id}`)) throw problem('EXPORT_RESPONSE_INVALID');
    return clean;
  }
  async function collectWithSession(session,options) {
    const sections={};let completed=false;
    try {
      const config=await readJson('/api/portal/config',session,options);
      if(typeof config.enabled!=='boolean') throw problem('EXPORT_RESPONSE_INVALID');
      if(config.enabled===false) {
        const legacy=await readJson('/api/me/export',session,options);
        if(!Array.isArray(legacy.favorites)) throw problem('EXPORT_RESPONSE_INVALID');
        const profile=cleanItem('account',legacy.profile,session.userId),favorites=legacy.favorites.map(row=>cleanItem('favorites',row,session.userId));
        session.guard();completed=true;
        return {schema_version:'rexbid-personal-data-download-v1',exported_at:timestamp(legacy.exported_at)?legacy.exported_at:new Date().toISOString(),complete:true,
          completion:'all_included_sections',scope:'account_favorites_only',sections:{account:[profile],favorites},excluded_sections:['profile','orders','events','messages','files'],
          notices:['Panel importów jest wyłączony. Ten plik zawiera wyłącznie dane konta i ulubione; nie obejmuje importów, rozmów ani plików.']};
      }
      const manifest=await readJson('/api/portal/export',session,options);
      if(manifest.schema_version!=='rexbid-personal-export-v1' || !UUID.test(manifest.export_id) || manifest.scope!=='authenticated_account_and_own_customer_orders'
        || manifest.page_size!==PAGE_SIZE || !timestamp(manifest.as_of) || !timestamp(manifest.expires_at) || !isObject(manifest.consistency)
        || manifest.consistency.mode!=='created_at_cutoff_with_live_values' || typeof manifest.consistency.description!=='string'
        || !isObject(manifest.attachments) || manifest.attachments.file_bytes_included!==false
        || !Array.isArray(manifest.sections) || manifest.sections.length!==SECTIONS.length || new Set(manifest.sections.map(row=>row?.section)).size!==SECTIONS.length
        || manifest.sections.some(row=>!SECTIONS.includes(row?.section) || !cursor(row.start_cursor) || !Number.isSafeInteger(row.observed_count) || row.observed_count<0)) throw problem('EXPORT_RESPONSE_INVALID');
      const observedCounts={};
      for(const section of SECTIONS) {
        const descriptor=manifest.sections.find(row=>row.section===section), seenCursors=new Set(),seenItems=new Set(),items=[];
        observedCounts[section]=descriptor.observed_count;sections[section]=items;
        let token=descriptor.start_cursor,done=false;
        while(!done) {
          session.guard();
          if(seenCursors.has(token)) throw problem('EXPORT_CURSOR_REPEATED');
          if(++session.pages>session.maxPages) throw problem('EXPORT_PAGE_LIMIT');
          seenCursors.add(token);
          const page=await readJson(`/api/portal/export?section=${section}&cursor=${encodeURIComponent(token)}`,session,options);
          if(page.schema_version!==manifest.schema_version || page.export_id!==manifest.export_id || page.section!==section || page.as_of!==manifest.as_of
            || page.expires_at!==manifest.expires_at || page.scope!==manifest.scope || !Array.isArray(page.items) || page.items.length>PAGE_SIZE
            || typeof page.section_complete!=='boolean' || (page.section_complete ? page.next_cursor!==null : !cursor(page.next_cursor) || page.items.length!==PAGE_SIZE)) throw problem('EXPORT_RESPONSE_INVALID');
          for(const raw of page.items) {
            const item=cleanItem(section,raw,session.userId),key=section==='account' || section==='profile'?session.userId:item[section==='favorites'?'key':'id'];
            if(seenItems.has(key)) throw problem('EXPORT_ITEM_REPEATED');
            seenItems.add(key);items.push(item);
          }
          session.guard();
          session.onProgress?.({section,completed_sections:Object.keys(sections).length-1,items_collected:items.length,pages_read:session.pages});
          session.guard();
          done=page.section_complete;token=page.next_cursor;
        }
      }
      session.guard();completed=true;
      return {schema_version:'rexbid-personal-data-download-v1',export_id:manifest.export_id,exported_at:new Date().toISOString(),as_of:manifest.as_of,
        complete:true,completion:'all_included_sections',scope:manifest.scope,consistency:pick(manifest.consistency,['mode','description','manifest_counts']),
        observed_manifest_counts:observedCounts,sections,attachments:{included:'client_visible_metadata_and_authenticated_download_urls',file_bytes_included:false},
        notices:['Eksport obejmuje dane konta, profil kontaktowy, ulubione i własne importy wraz z widoczną historią oraz rozmowami.',
          'Załączniki zawierają metadane i adresy wymagające logowania. Treści zdjęć i dokumentów należy pobrać osobno z panelu importów.',
          'Nowe rekordy utworzone po as_of są pomijane. Istniejące dane są odczytywane podczas pobierania kolejnych stron; nie jest to zamrożona kopia bazy.']};
    } finally { if(!completed) for(const key of Object.keys(sections)) sections[key].length=0; }
  }
  async function collect(options={}) {
    const session=createSession(options);
    try { return await collectWithSession(session,options); } finally { session.cleanup(); }
  }
  async function download(options={}) {
    const session=createSession(options);let objectUrl,anchor;
    try {
      const data=await collectWithSession(session,options);session.guard();
      const date=new Date().toISOString().slice(0,10),fileName=data.scope==='account_favorites_only'?`rexbid-dane-konta-i-ulubionych-${date}.json`:`rexbid-dane-${date}.json`;
      if(typeof root.URL?.createObjectURL!=='function' || typeof root.URL?.revokeObjectURL!=='function') throw problem('EXPORT_DOWNLOAD_UNAVAILABLE');
      const serialized=JSON.stringify(data,null,2);
      if(utf8TextSize(serialized)>session.maxBytes) throw problem('EXPORT_TOO_LARGE');
      session.guard();
      const blob=new root.Blob([serialized],{type:'application/json'});session.guard();
      objectUrl=root.URL.createObjectURL(blob);session.guard();
      anchor=root.document.createElement('a');anchor.href=objectUrl;anchor.download=fileName;anchor.hidden=true;anchor.rel='noopener';
      root.document.body.append(anchor);session.guard();anchor.click();
      return {ok:true,scope:data.scope,data,file_name:fileName};
    } finally {
      anchor?.remove();if(objectUrl)root.URL.revokeObjectURL(objectUrl);session.cleanup();
    }
  }
  root.RexBidDataExport=Object.freeze({collect,download,cancel(){active?.cancel('EXPORT_CANCELLED');},get busy(){return !!active;}});
})(typeof window!=='undefined'?window:globalThis);
