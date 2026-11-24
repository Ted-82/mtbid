'use strict';

const {ownerTrafficPreference,isTrafficExcludedBrowser}=require('../auth/traffic-preference.cjs');
const PATH='/api/portal/admin/traffic';
const PAGES=/^\/(?:$|(?:index|car|porownanie|ulubione|jak-to-dziala|kontakt|pomoc|o-nas|prywatnosc|warunki)(?:\.html)?\/?$)/;
const SOURCES=new Set(['direct','google','bing','duckduckgo','facebook','instagram','tiktok','youtube','other']);
const RANGES=new Set(['today','yesterday','7','30']);
const known=(host,domain)=>host===domain || host.endsWith('.'+domain);
const countryCode=value=>/^[A-Z]{2}$/.test(value||'') && !['XX','T1'].includes(value) ? value : 'ZZ';
function cityName(value,country) {
  if (typeof value!=='string' || country==='ZZ') return '';
  const city=value.normalize('NFC').trim().replace(/\s+/g,' ');
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\p{N} .’'()\-]{0,95}$/u.test(city)) return '';
  return country==='PL' && /^warsaw$/i.test(city) ? 'Warszawa' : city;
}
const dayKey=date=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
// Confirmed deltas from traffic-admin-20261113/source-attribution-check.json.
// Apply only to the report, leaving the original daily counters intact.
const VERIFIED_TEST_DAY='2026-11-13';
const VERIFIED_TEST_COUNTS=new Map([['view:',2],['country:PL',2],['source:google',1],['source:facebook',1]]);

function excludeVerifiedHistoricalTests(rows) {
  const testDayCounts=new Map(rows.filter(row=>row.day===VERIFIED_TEST_DAY).map(({kind,label,n})=>[`${kind}:${label}`,n]));
  if (!Array.from(VERIFIED_TEST_COUNTS).every(([key,n])=>testDayCounts.get(key)>=n)) return rows;
  return rows.map(row=>row.day===VERIFIED_TEST_DAY
    ? {...row,n:row.n-(VERIFIED_TEST_COUNTS.get(`${row.kind}:${row.label}`)||0)}
    : row).filter(row=>row.n>0);
}
function previousDay(day,offset) {
  const date=new Date(day+'T12:00:00Z');
  date.setUTCDate(date.getUTCDate()-offset);
  return date.toISOString().slice(0,10);
}

function classify(request,response) {
  const url=new URL(request.url), h=request.headers, cf=request.cf;
  if (url.origin!=='https://rexbid.pl' || request.method!=='GET' || !PAGES.test(url.pathname)
    || response.status!==200 || !response.headers.get('content-type')?.toLowerCase().startsWith('text/html')
    || h.get('sec-fetch-mode')!=='navigate' || h.get('sec-fetch-dest')!=='document'
    || isTrafficExcludedBrowser(request) || h.get('x-rexbid-traffic-test')==='1' || url.searchParams.get('rex_traffic_test')==='1'
    || h.get('sec-gpc')==='1' || h.get('dnt')==='1' || cf?.botManagement?.verifiedBot
    || /prefetch|prerender/i.test([h.get('purpose'),h.get('sec-purpose')].join(' '))
    || /bot|crawler|spider|headless|lighthouse/i.test(h.get('user-agent')||'')) return null;
  let host='';
  try {
    const referer=new URL(h.get('referer'));
    if (['https:','http:'].includes(referer.protocol)) host=referer.hostname;
  } catch {}
  const country=countryCode(cf?.country);
  if (['rexbid.pl','www.rexbid.pl'].includes(host) || h.get('sec-fetch-site')==='same-origin') return {country,source:null};
  const source=!host ? 'direct'
    : /^(?:[a-z0-9-]+\.)?google\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(host) ? 'google'
    : known(host,'bing.com') ? 'bing' : known(host,'duckduckgo.com') ? 'duckduckgo'
    : known(host,'facebook.com') || known(host,'fb.com') ? 'facebook'
    : known(host,'instagram.com') ? 'instagram' : known(host,'tiktok.com') ? 'tiktok'
    : known(host,'youtube.com') || known(host,'youtu.be') ? 'youtube' : 'other';
  const city=cityName(cf?.city,country);
  return city ? {country,source,city} : {country,source};
}

function recordTraffic(request,response,env,context) {
  if (!env.REXBID_TRAFFIC || typeof context?.waitUntil!=='function') return;
  const event=classify(request,response);
  if (!event) return;
  context.waitUntil(Promise.resolve().then(async()=>{
    const result=await env.REXBID_TRAFFIC.getByName('rexbid-traffic-v1').fetch('https://traffic.internal/record',{
      method:'POST',body:JSON.stringify(event)
    });
    if (!result.ok) throw new Error('traffic_record_failed');
  }).catch(()=>console.warn('REXBID visit counter unavailable')));
}

function json(data,status=200,cookies=[]) {
  const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
    Vary:'Cookie','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'});
  for(const cookie of cookies) headers.append('Set-Cookie',cookie);
  if(status===405) headers.set('Allow','GET');
  return new Response(JSON.stringify(data),{status,headers});
}

function createTrafficHandler(resolveAccount) {
  return async (request,env)=>{
    const url=new URL(request.url);
    if(url.pathname!==PATH) return null;
    const fail=(error,status,cookies)=>json({ok:false,error},status,cookies);
    if(request.method!=='GET') return fail('method_not_allowed',405);
    if(url.origin!==env.AUTH_CANONICAL_ORIGIN || (request.headers.has('origin') && request.headers.get('origin')!==url.origin)
      || ['cross-site','same-site'].includes(request.headers.get('sec-fetch-site'))) return fail('forbidden',403);
    let cookies=[];
    try {
      const account=await resolveAccount(request,env);
      cookies=account?.cookies||[];
      if(account?.status!==200 || !account?.user?.id) return fail('unauthorized',401,cookies);
      if(!env.REXBID_OWNER_USER_ID || account.user.id!==env.REXBID_OWNER_USER_ID) return fail('forbidden',403,cookies);
      if(account.assurance_level!=='aal2') return fail('owner_mfa_required',403,cookies);
      cookies=[...cookies,...ownerTrafficPreference(request,env,account.user)];
      const days=url.searchParams.get('days')??'7';
      if(!RANGES.has(days)) return fail('invalid_request',400,cookies);
      const response=await env.REXBID_TRAFFIC?.getByName('rexbid-traffic-v1').fetch('https://traffic.internal/report?days='+days);
      if(!response?.ok) return fail('unavailable',503,cookies);
      return json({ok:true,...await response.json()},200,cookies);
    } catch { return fail('unavailable',503,cookies); }
  };
}

// Binding only. No route from the public internet reaches this object directly.
class RexBidTraffic {
  constructor(ctx) {
    this.sql=ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS traffic (day TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY(day,kind,label)) WITHOUT ROWID');
    this.prunedDay='';
  }
  async fetch(request) {
    const url=new URL(request.url), today=dayKey(new Date());
    if (this.prunedDay!==today) {
      this.sql.exec('DELETE FROM traffic WHERE day < ?',previousDay(today,29));
      this.prunedDay=today;
    }
    if(request.method==='POST' && url.pathname==='/record') {
      const {country,source,city}=await request.json();
      if((country!=='ZZ' && countryCode(country)!==country) || (source!==null && !SOURCES.has(source))) return new Response(null,{status:400});
      const location=cityName(city,country);
      // Replace the country bucket with a city bucket when available.
      // Both shapes carry country and use the same number of writes per visit.
      const locationKind=location?'city':'country';
      const locationLabel=location?JSON.stringify([country,location,source]):country;
      this.sql.exec(`INSERT INTO traffic(day,kind,label,n)
        SELECT ?,kind,label,1 FROM (
          SELECT 'view' AS kind,'' AS label
          UNION ALL SELECT ?,? WHERE ? IS NOT NULL
          UNION ALL SELECT 'source',? WHERE ? IS NOT NULL
        ) WHERE 1
        ON CONFLICT(day,kind,label) DO UPDATE SET n=n+1`,today,locationKind,locationLabel,source,source,source);
      return new Response(null,{status:204});
    }
    if(request.method==='GET' && url.pathname==='/report') {
      const range=url.searchParams.get('days')??'7';
      if(!RANGES.has(range)) return new Response(null,{status:400});
      const days=range==='30'?30:range==='7'?7:1;
      const through=range==='yesterday'?previousDay(today,1):today;
      const from=previousDay(through,days-1);
      // Keep the weekly chart in both one-day views. Read the same aggregates
      // in one indexed query, with no new table, scheduled job or visit write.
      const chartDays=days===30?30:7;
      const chartFrom=previousDay(today,chartDays-1);
      const rows=this.sql.exec('SELECT day,kind,label,n FROM traffic WHERE day BETWEEN ? AND ?',chartFrom,today).toArray();
      const timeline=new Map(),totals={source:new Map(),country:new Map(),city:new Map()};
      const add=(kind,label,n)=>totals[kind].set(label,(totals[kind].get(label)||0)+n);
      let views=0;
      for(const {day,kind,label,n} of excludeVerifiedHistoricalTests(rows)) {
        if(kind==='source') timeline.set(day,(timeline.get(day)||0)+n);
        if(day<from || day>through) continue;
        if(kind==='view') views+=n;
        else if(kind==='city') {
          const [country]=JSON.parse(label);
          add('country',country,n);
          add('city',label,n);
        } else if(kind==='source' || kind==='country') add(kind,label,n);
      }
      const list=kind=>Array.from(totals[kind],([label,n])=>({label,n})).sort((a,b)=>b.n-a.n||a.label.localeCompare(b.label));
      const sources=list('source');
      const cities=list('city').map(({label,n})=>{
        const [country,city,source]=JSON.parse(label);
        return {country,city,source,n};
      });
      const daily=Array.from({length:chartDays},(_,i)=>{
        const day=previousDay(today,chartDays-1-i);
        return {day,visits:timeline.get(day)||0};
      });
      return Response.json({days,from,through,views,visits:sources.reduce((n,r)=>n+r.n,0),sources,countries:list('country'),cities,daily});
    }
    return new Response(null,{status:404});
  }
}

module.exports={classify,recordTraffic,createTrafficHandler,RexBidTraffic,dayKey,excludeVerifiedHistoricalTests};
