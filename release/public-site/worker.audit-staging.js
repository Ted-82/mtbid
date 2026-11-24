import website from './worker.js';
import vehiclePages from './sync/vehicle-page.cjs';
import verifiedFields from './staging/audit-verified-fields.json';

const origin = 'https://rexbid.pl';
const publicData = new Set(['/api/cars', '/api/filters', '/api/archiwum', '/api/exchange-rates']);
const previewOrigin = 'https://rexbid-audit-staging.tedn828.workers.dev';
const featureFlags = {REXBID_CANONICAL_ORIGIN:origin, REXBID_AUDIT_PREVIEW:'enabled'};
for (const feature of ['TRANSPORT_CALCULATOR', 'CALCULATOR_V3', 'CALCULATOR_V4']) {
  featureFlags['REXBID_' + feature + '_ENABLED'] = 'enabled';
  featureFlags['REXBID_' + feature + '_ALLOWED_ORIGINS'] = previewOrigin;
}
function json(value, status = 200) { return Response.json(value, {status}); }
function mark(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  headers.set('X-REXBID-Environment', 'read-only-staging');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.delete('Set-Cookie');
  return new Response(response.body, {status:response.status, headers});
}
async function preview(request, env, ctx) {
  const url = new URL(request.url);
  if (!['GET','HEAD'].includes(request.method)) return json({error:'Podgląd umożliwia wyłącznie odczyt.'}, 405);
  if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', {headers:{'Content-Type':'text/plain'}});
  if (url.pathname === '/api/auth/config' || url.pathname === '/api/contact/config' || url.pathname === '/api/portal/config') return json({ok:true,enabled:false});
  if (url.pathname === '/api/me') return json({ok:false,authenticated:false},401);
  if (url.pathname==='/car' || url.pathname==='/car.html') {
    const example=url.searchParams.get('proba')==='dane' && verifiedFields.find(item =>
      item.platform===url.searchParams.get('platform') && item.lot_number===url.searchParams.get('lot') && item.vin===url.searchParams.get('vin'));
    let exampleApplied=false;
    const render=()=>website.fetch(new Request(previewOrigin+url.pathname+url.search,{method:'GET'}),{ASSETS:env.ASSETS,...featureFlags},ctx);
    const read=async route=>{
      if (!(await env.PUBLIC_READ_LIMIT.limit({key:request.headers.get('CF-Connecting-IP') || 'preview'})).success) return json({ok:false},429);
      const source=await fetch(origin+route,{redirect:'manual',headers:{Accept:'application/json','X-RexBid-Traffic-Test':'1'},signal:AbortSignal.timeout(20000)});
      if (!example || !source.ok) return source;
      const body=await source.json();
      const record=body.data;
      if (body.ok && record?.vin===example.vin && record.platform===example.platform && String(record.lot_number)===example.lot_number) {
        record.exterior_color=example.exterior_color;
        record.sale_document={...record.sale_document,...example.sale_document};
        exampleApplied=true;
      }
      return Response.json(body);
    };
    const result=await vehiclePages.vehiclePage(request,{read,render});
    if (!exampleApplied || !result.ok || request.method==='HEAD') return result;
    return new HTMLRewriter().on('main',{element(element){
      element.prepend('<p role="note">Próba danych na stagingu. Kolor i dokument z odczytu Apibary 24 listopada 2026 o 18:09 czasu polskiego.</p>',{html:true});
    }}).transform(result);
  }
  const archivePhoto = /^\/archiwum-zdjecie\/(?:iaai|copart)\/\d{1,15}\/\d+\/[a-zA-Z0-9_.-]+$/.test(url.pathname);
  if (url.pathname.startsWith('/api/') || archivePhoto) {
    if (!(archivePhoto || publicData.has(url.pathname) || url.pathname === '/api/vehicle-specs' || /^\/api\/car\/[A-Za-z0-9]{5,20}(?:\/history)?$/.test(url.pathname))) return json({error:'Niedostępne w podglądzie.'},404);
    if (url.search.length > 2000) return json({error:'Za długie zapytanie.'},400);
    if (!(await env.PUBLIC_READ_LIMIT.limit({key:request.headers.get('CF-Connecting-IP') || 'preview'})).success) return json({error:'Spróbuj ponownie za minutę.'},429);
    if (url.pathname === '/api/vehicle-specs') return website.fetch(new Request(previewOrigin+url.pathname+url.search,{method:request.method}),featureFlags,ctx);
    const upstream = await fetch(origin+url.pathname+url.search,{method:request.method,redirect:'manual',headers:{Accept:archivePhoto?'image/*':'application/json','X-RexBid-Traffic-Test':'1'},signal:AbortSignal.timeout(20000)});
    if (upstream.status >= 300 && upstream.status < 400) return json({error:'Dane chwilowo niedostępne.'},502);
    return new Response(upstream.body,{status:upstream.status,headers:{'Content-Type':upstream.headers.get('Content-Type') || 'application/json','Cache-Control':upstream.headers.get('Cache-Control') || 'no-store'}});
  }
  if (/^\/(administracja|panel|konto|rejestracja|logowanie|reset-hasla)(?:\.html)?\/?$/.test(url.pathname)) {
    return new Response('Podgląd katalogu. Logowanie i prywatne rozmowy są dostępne w osobnym środowisku testowym.', {headers:{'Content-Type':'text/plain; charset=utf-8'}});
  }
  if (url.pathname.startsWith('//') || url.pathname.includes('\\')) return new Response(null,{status:404});
  const result = await website.fetch(new Request(previewOrigin+url.pathname+url.search,{method:request.method}),{ASSETS:env.ASSETS,...featureFlags},ctx);
  if (result.status >= 300 && result.status < 400) {
    const target = new URL(result.headers.get('Location') || '/',origin);
    if (![origin,previewOrigin].includes(target.origin)) return new Response(null,{status:404});
    return new Response(null,{status:result.status,headers:{Location:target.pathname+target.search}});
  }
  return result;
}
export default { async fetch(request,env,ctx) {
  try { return mark(await preview(request,env,ctx)); }
  catch { return mark(json({error:'Podgląd jest chwilowo niedostępny.'},503)); }
} };
