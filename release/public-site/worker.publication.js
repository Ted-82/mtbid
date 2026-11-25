import rexWorker from "./worker.js";
import storedReads from "./staging/d1-primary-reads.cjs";
import savedReadCache from "./sync/stored-read-cache.cjs";
import automaticRefreshModule from "./sync/automatic-refresh.cjs";
import accountsReadinessModule from "./auth/routes.js";
import trafficModule from "./portal/traffic.cjs";
import liveModule from "./portal/live-auction.cjs";
import archiveModule from "./sync/auction-archive-public.cjs";
import archiveState from "./sync/auction-archive-state.cjs";
import contactDelivery from "./portal/contact-delivery.cjs";
import transactionalMail from "./portal/transactional-mail.cjs";
import fileDeletion from "./portal/file-deletions.cjs";
import publicBackup from "./sync/catalog-backup.cjs";
import vehiclePages from "./sync/vehicle-page.cjs";
import {CatalogBackup, refreshCatalogBackup} from "./sync/catalog-backup-service.mjs";

export const RexBidTraffic = trafficModule.RexBidTraffic;
export const RexBidLive = liveModule.RexBidLive;
export {CatalogBackup};

// Public isolated catalogue. Browsing always reads saved D1/cache records;
// the explicitly enabled scheduled handler alone can obtain provider updates.
const ORIGIN = "https://rexbid.pl";
const WWW_ORIGIN = "https://www.rexbid.pl";
const DATABASE = "rexbid-production-preflight-db";
const DATABASE_ID = "c8a30088-70af-43a6-9a7f-c4018279d37d";
const PRIVATE_PAGE_PATHS = new Set(["/konto", "/logowanie", "/rejestracja", "/reset-hasla", "/panel", "/administracja"]);

function catalogPrivatePage(pathname) {
  return PRIVATE_PAGE_PATHS.has(pathname.replace(/\.html$/, "").replace(/\/$/, ""));
}

function catalogPageResponse(request) {
  return new Response(request.method === "HEAD" ? null : `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Funkcja niedostępna — REXBID</title></head><body><main><h1>Konta i panel nie są jeszcze dostępne</h1><p>W tej wersji możesz przeglądać samochody, obliczać koszty i zapisywać ulubione w swojej przeglądarce.</p><nav aria-label="Dostępne funkcje"><a href="/?catalog=1#results">Przejdź do katalogu</a> · <a href="/ulubione.html">Obserwowane</a> · <a href="/kontakt.html">Kontakt</a></nav></main></body></html>`, {
    status: 404,
    headers: {"Content-Type": "text/html; charset=UTF-8", "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"}
  });
}

function catalogOnlyNavigation(response) {
  if (!response.headers.get("Content-Type")?.toLowerCase().includes("text/html") || !response.body) return response;
  // Render the actual public HTML without links to unlaunched account features.
  // Server-side removal also covers guide pages which do not load Auth JS, and
  // does not depend on bootstrap timing. Staging and later Auth phases retain
  // their original navigation, sessions and handlers.
  return new HTMLRewriter().on("html", {element(element) {
    element.setAttribute("data-rexbid-publication-phase", "catalog");
  }}).on("a[href]", {element(element) {
    try {
      const target = new URL(element.getAttribute("href"), ORIGIN);
      if (target.origin === ORIGIN && catalogPrivatePage(target.pathname)) element.remove();
    } catch { /* A malformed href is handled by the existing page contract. */ }
  }}).transform(response);
}

function publicationDiscovery(request) {
  const url = new URL(request.url);
  if (!["/robots.txt", "/sitemap.xml"].includes(url.pathname)) return null;
  if (!["GET", "HEAD"].includes(request.method)) return safeResponse(request, 405, "method_not_allowed", {Allow: "GET, HEAD"});
  const robots = url.pathname === "/robots.txt";
  const body = robots
    ? "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /__staging/\nDisallow: /auth-test.html\nDisallow: /health\nDisallow: /ready\n"
      + [...PRIVATE_PAGE_PATHS, "/ulubione"].map(p => "Disallow: " + p + "\n").join("")
      + "\nSitemap: " + ORIGIN + "/sitemap.xml\n"
    : '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + ["/", "/jak-to-dziala", "/o-nas", "/kontakt", "/pomoc", "/kalkulator-budzet"]
        .map(p => "  <url><loc>" + ORIGIN + p + "</loc></url>").join("\n")
      + "\n</urlset>\n";
  return new Response(request.method === "HEAD" ? null : body, {headers: {
    "Content-Type": robots ? "text/plain; charset=UTF-8" : "application/xml; charset=UTF-8",
    "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"
  }});
}

async function refreshReadiness(env) {
  const refresh = {status: "unavailable", last_success_at: null, last_finished_at: null};
  try {
    const row = await env.REXBID_DB.prepare(`SELECT last_started_at,last_finished_at,last_success_at,lease_until,pause_until,
      CASE WHEN lease_owner IS NOT NULL THEN 1 ELSE 0 END AS lease_active,
      CASE WHEN blocked_reason IS NOT NULL THEN 1 ELSE 0 END AS blocked
      FROM automatic_refresh_state WHERE singleton=1`).first();
    if (!row) return refresh;
    const time = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
      && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
    const now = Date.now(), started = time(row.last_started_at), lease = time(row.lease_until), pause = time(row.pause_until);
    refresh.last_success_at = time(row.last_success_at);
    refresh.last_finished_at = time(row.last_finished_at);
    // These states describe the scheduler, never a guarantee that every offer
    // has been refreshed. No budget, lease owner, raw error or account data leaks.
    refresh.status = row.blocked === 1 ? "blocked"
      : pause && Date.parse(pause) > now ? "paused"
      : row.lease_active === 1 && lease && Date.parse(lease) > now ? "running"
      : !started ? "awaiting"
      : !refresh.last_finished_at || Date.parse(refresh.last_finished_at) < now - 30 * 60000 ? "due"
      : "scheduled";
  } catch { /* Saved-catalogue availability is independent of scheduler health. */ }
  return refresh;
}

async function catalogReadiness(request, env, phase = "catalog") {
  const scheduled = env.REXBID_AUTO_REFRESH_ENABLED === "enabled";
  const checks = {catalog: "unavailable", assets: "unavailable", provider: scheduled ? "scheduled_only" : "disabled"};
  try {
    // The first public phase needs an actual listing with its saved observation.
    // SELECT 1 alone would report readiness for an empty or incomplete database.
    const row = await env.REXBID_DB.prepare("SELECT l.listing_id FROM auction_listings l JOIN auction_listing_snapshots s ON s.listing_id = l.listing_id LIMIT 1").first();
    if (row?.listing_id) checks.catalog = "ok";
  } catch { /* Fail closed without logging SQL, rows or credentials. */ }
  try {
    const asset = await env.ASSETS.fetch(new Request(new URL("/index.html", ORIGIN)));
    if (asset.ok && asset.headers.get("Content-Type")?.toLowerCase().includes("text/html")) checks.assets = "ok";
  } catch { /* The public response contains only named checks. */ }
  if (phase !== "catalog") {
    // Configuration only: never log in, send email or contact a provider from
    // a public readiness request. Email E2E is a separate release gate.
    checks.auth = {enabled: true, configured: accountsReadinessModule.isAuthConfigurationComplete(env, request.url)};
  }
  const ok = checks.catalog === "ok" && checks.assets === "ok" && (!checks.auth || checks.auth.configured);
  const refresh = scheduled ? await refreshReadiness(env) : null;
  return new Response(request.method === "HEAD" ? null : JSON.stringify({ok, status: ok ? "ready" : "not_ready", checks, ...(scheduled ? {refresh} : {})}), {
    status: ok ? 200 : 503, headers: {"Content-Type": "application/json; charset=UTF-8", "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "Strict-Transport-Security": "max-age=31536000", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"}
  });
}

function safeResponse(request, status, code, extraHeaders = {}) {
  return new Response(request.method === "HEAD" ? null : JSON.stringify({ok: false, error: code}), {
    status, headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      ...extraHeaders
    }
  });
}

function configuredPublicationPhase(env) {
  if (env?.REXBID_CANONICAL_ORIGIN !== ORIGIN || env?.REXBID_RELEASE_ORIGIN !== ORIGIN
    || env?.REXBID_RELEASE_D1_TARGET !== DATABASE || env?.REXBID_RELEASE_D1_DATABASE_ID !== DATABASE_ID
    || env?.REXBID_PRODUCTION_UI_ENABLED !== "enabled"
    || env?.REXBID_D1_PRIMARY_READS !== "false" || env?.REXBID_LEGACY_SYNC_ENABLED !== "false"
    || env?.REXBID_PUBLIC_CATALOG_MODE !== "stored") return null;
  const phase = env?.REXBID_PUBLICATION_PHASE;
  const auth = env?.AUTH_ENABLED, portal = env?.REXBID_PORTAL_ENABLED;
  const setupOnly = env?.REXBID_PORTAL_OWNER_SETUP_ONLY;
  // Existing private attachment service retains owner MFA, order scope,
  // client/internal visibility, encryption and authenticated downloads.
  if (phase === "portal-files") {
    return auth === "true" && portal === "enabled" && setupOnly !== "true"
      && env?.REXBID_PORTAL_FILES_ENABLED === "enabled"
      && ["put", "get", "delete"].every(method => typeof env?.REXBID_PRIVATE_FILES?.[method] === "function")
      ? phase : null;
  }
  // Earlier rollout modes remain attachment-free and fail closed.
  if (env?.REXBID_PORTAL_FILES_ENABLED !== "disabled" || env?.REXBID_PRIVATE_FILES) return null;
  if (phase === "catalog" && auth === "false" && portal === "disabled" && setupOnly !== "true") return phase;
  if (phase === "auth-setup" && auth === "true" && portal === "disabled" && setupOnly !== "true") return phase;
  if (phase === "owner-setup" && auth === "true" && portal === "enabled" && setupOnly === "true") return phase;
  if (phase === "portal-no-files" && auth === "true" && portal === "enabled" && setupOnly !== "true") return phase;
  return null;
}

async function readPublicCatalog(request, env, context, strictMissing = false, queueHistoryRefresh = true) {
  const url = new URL(request.url);
  const list = url.pathname === "/api/cars";
  const history = /^\/api\/car\/[^/]+\/history$/.test(url.pathname);
  const detail = /^\/api\/car\/[^/]+$/.test(url.pathname);
  const stored = (targetRequest, targetEnv, namespace) => savedReadCache.cachedStoredRead(
    targetRequest, globalThis.caches?.default, () => storedReads.handleStoredRead(targetRequest, targetEnv), {
      namespace: targetEnv.REXBID_CATALOG_MEMBERSHIP_ENABLED === "enabled"
        ? () => storedReads.catalogMembershipNamespace(targetRequest, targetEnv, namespace) : namespace,
      storedTaxonomy: targetEnv.REXBID_PUBLIC_CATALOG_MODE === "stored" && targetEnv.REXBID_CATALOG_MEMBERSHIP_ENABLED === "enabled",
      revalidateClient: targetEnv.REXBID_CATALOG_MEMBERSHIP_ENABLED === "enabled", context
    });
  const namespace = list || detail ? "public-dated-v2" : "public-saved-v1";
  const legacy = () => stored(request, env, "isolated-" + namespace);
  if (request.method !== "GET") return {response: await legacy()};
  if (!env.REXBID_ACTIVE_CATALOG?.prepare) {
    return {response: await publicBackup.fallback(request,env) ?? await legacy()};
  }
  if (!list && !history && !detail && url.pathname !== "/api/filters") return {response: await legacy()};
  const catalogue = env.REXBID_ACTIVE_CATALOG;
  if (history) {
    return {response: await savedReadCache.historyReads.readCatalogHistory(request, {
      active: req => stored(req, {...env, REXBID_DB: catalogue}, "active-history-merged-v1"),
      legacy: req => stored(req, env, "legacy-history-merged-v1"), db: queueHistoryRefresh ? catalogue : null
    })};
  }
  const readActive = async () => {
    // A fresh Request gives the retry a fresh membership lookup.
    try {
      // The first (membership) read pins the current catalogue on the primary.
      // The list query can then use an equally fresh EU replica.
      const database = list && typeof catalogue.withSession === "function"
        ? catalogue.withSession("first-primary") : catalogue;
      return await stored(new Request(request), {...env, REXBID_DB: database},
        list || detail ? "active-dated-catalog-v2" : "active-catalog-10733-v1");
    }
    catch { console.warn("REXBID active catalogue read unavailable"); return null; }
  };
  const started = Date.now();
  let current = await publicBackup.readWithFallback(request, env, readActive);
  if (list) {
    // Two staggered retries can bridge a brief D1 outage without switching
    // catalogues or piling all retry traffic back onto the database at once.
    for (let attempt = 0; attempt < 2 && (!current || current.status === 503); attempt++) {
      const delay = attempt === 0 ? 1800 + Math.floor(Math.random() * 1200) : 2300 + Math.floor(Math.random() * 1200);
      if (Date.now() - started + delay > 10500 || request.signal.aborted) break;
      await new Promise(resolve => setTimeout(resolve, delay));
      if (request.signal.aborted) break;
      await current?.body?.cancel().catch(() => {});
      current = await readActive();
    }
    return {response: current ?? safeResponse(request, 503, "saved_catalog_temporarily_unavailable"), active: true};
  }
  if (current?.headers.get("X-RexBid-Auction-Visibility") === "awaiting-date") return {response: current, active: true};
  if (current && current.status < 500 && !(detail && current.status === 404)) return {response: current, active: true};
  const previous = await legacy();
  if (strictMissing && (!current || current.status >= 500) && (!previous || previous.status === 404)) {
    return {response:safeResponse(request,503,"saved_catalog_temporarily_unavailable")};
  }
  return {response: previous ?? current};
}

export default {
  async scheduled(controller, env, context) {
    if (controller?.cron === '*/15 * * * *' && configuredPublicationPhase(env) &&
        env.REXBID_PUBLIC_CATALOG_BACKUP === 'enabled') {
      const backup = refreshCatalogBackup(env).catch(() => console.warn('REXBID catalogue backup refresh unavailable'));
      context?.waitUntil?.(backup);
      if (!context?.waitUntil) await backup;
    }
    if (controller?.cron === '*/15 * * * *' && configuredPublicationPhase(env) && typeof storedReads.refreshTimed === 'function'
        && env.REXBID_TIMED_IAAI_ENABLED === 'enabled') {
      const timed=storedReads.refreshTimed(env).catch(error=>{
        const code=String(error?.message);
        console.warn('REXBID Timed IAAI', /^TIMED_[A-Z0-9_]+$/.test(code)?code:'TIMED_REFRESH_UNAVAILABLE');
      });
      context?.waitUntil?.(timed);
      if(!context?.waitUntil)await timed;
    }
    if (controller?.cron === '*/15 * * * *' && configuredPublicationPhase(env) === 'portal-files') {
      const cleanup = fileDeletion.retryPending(env).catch(() => console.warn('REXBID attachment cleanup unavailable'));
      context?.waitUntil?.(cleanup);
      if (!context?.waitUntil) await cleanup;
    }
    // A separate durable mail outbox is independent of catalogue authority.
    // Use the existing cadence; no new service or import limits are created.
    if(controller?.cron==='*/15 * * * *'&&configuredPublicationPhase(env)&&transactionalMail.enabled(env)){
      const delivery=transactionalMail.dispatchAll(env).catch(()=>console.warn('REXBID mail retry unavailable'));
      context?.waitUntil?.(delivery);
      if(!context?.waitUntil)await delivery;
    }
    // Auth rollout phases retain the same bounded catalogue scheduler. The
    // phase must be internally consistent and isolated; Cron
    // never dispatches Auth/portal handlers or broadens their permissions.
    try {
      const limits = automaticRefreshModule.configuration(env);
      if (controller?.cron !== "*/15 * * * *" || !configuredPublicationPhase(env)
          || !limits.enabled || env.REXBID_AUTO_REFRESH_DATABASE_ID !== DATABASE_ID
          || limits.daily > 500 || limits.monthly > 12000 || limits.perRun > 8
          || limits.newPerDay > 2000 || limits.quotaReserve < 500) {
        return {ok: false, stopReason: "publication_scheduler_configuration_unavailable"};
      }
      const authority = await storedReads.scheduledCatalogAuthority(env);
      if (authority) return {ok: true, attempts: 0, stopReason: 'server_feed_owns_updates', source: authority};
      const task = automaticRefreshModule.runAutomaticRefresh({env}).catch(() => ({ok: false, stopReason: "publication_scheduler_unavailable"}));
      context?.waitUntil?.(task);
      const result = await task;
      console.info("REXBID scheduled refresh", JSON.stringify(result));
      return result;
    } catch {
      // Never log SQL, configuration, response bodies or a secret-bearing error.
      console.error("REXBID scheduled refresh unavailable");
      return {ok: false, stopReason: "publication_scheduler_unavailable"};
    }
  },
  async fetch(request, env, context) {
    const url = new URL(request.url);
    // Reject alias mutations and unknown hosts before the Auth handler, D1,
    // assets or provider can be reached. Do not forward cookies on www.
    if (url.origin !== ORIGIN && url.origin !== WWW_ORIGIN) return safeResponse(request, 421, "origin_not_allowed");
    const phase = configuredPublicationPhase(env);
    if (!phase) return safeResponse(request, 503, "publication_configuration_unavailable");
    if (url.origin === WWW_ORIGIN) {
      if (request.method !== "GET" && request.method !== "HEAD") return safeResponse(request, 421, "use_canonical_origin");
      return new Response(null, {status: 308, headers: {
        Location: `${ORIGIN}${url.pathname}${url.search}`,
        "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY"
      }});
    }
    if (url.pathname === '/api/live/socket') return liveModule.handleLive(request, env);
    const contactResponse=await contactDelivery.handleContact(request,env,context);
    if(contactResponse)return contactResponse;
    const archiveResponse = await archiveModule.handleArchive(request, env, new Date(), context);
    if (archiveResponse) return archiveResponse;
    const discovery = publicationDiscovery(request);
    if (discovery) return discovery;
    if (url.pathname === "/ready") {
      if (!["GET", "HEAD"].includes(request.method)) return safeResponse(request, 405, "method_not_allowed", {Allow: "GET, HEAD"});
      return catalogReadiness(request, env, phase);
    }
    if (phase === "catalog" && (request.method === "GET" || request.method === "HEAD") && catalogPrivatePage(url.pathname)) {
      return catalogPageResponse(request);
    }
    if (phase === "owner-setup" && (url.pathname === "/api/portal" || url.pathname.startsWith("/api/portal/"))) {
      const ownerMfaRead = url.pathname === "/api/portal/security" && request.method === "GET";
      const ownerMfaMutation = ["/api/portal/security/enroll", "/api/portal/security/challenge", "/api/portal/security/verify"]
        .includes(url.pathname) && request.method === "POST";
      // The existing UI uses portal/security. Only its normal TOTP setup and
      // verification enter the existing server-side owner handler; never reset.
      if (ownerMfaRead || ownerMfaMutation) return rexWorker.fetch(request, env, context);
      if (url.pathname === "/api/portal/config" && (request.method === "GET" || request.method === "HEAD")) {
        return new Response(request.method === "HEAD" ? null : JSON.stringify({ok: true, enabled: false, uploads_enabled: false}), {
          headers: {"Content-Type": "application/json; charset=UTF-8", "Cache-Control": "private, no-store", Vary: "Cookie"}
        });
      }
      return safeResponse(request, 503, "owner_setup_in_progress");
    }
    if (["/car","/car.html"].includes(url.pathname) && ["GET","HEAD"].includes(request.method)) {
      const render=()=>rexWorker.fetch(request.method==="HEAD" ? new Request(request,{method:"GET"}) : request,env,context);
      const read=async route=>{
        const detail=new Request(new URL(route,ORIGIN),{headers:{Accept:"application/json"},signal:request.signal});
        const normal=()=>readPublicCatalog(detail,env,context,true,false);
        const timed=env.REXBID_TIMED_IAAI_ENABLED==="enabled" ? await storedReads.readTimed?.(detail,env,normal) : null;
        return (timed || await normal()).response;
      };
      const historyVisible=async vin=>{
        const {index}=await archiveState.getIndex(env.REXBID_AUCTION_ARCHIVE);
        return !index.hidden.includes(await archiveState.hash(vin));
      };
      const response=await vehiclePages.vehiclePage(request,{read,render,historyVisible});
      trafficModule.recordTraffic(request,response,env,context);
      return phase==="catalog" ? catalogOnlyNavigation(response) : response;
    }
    const readNormal = () => readPublicCatalog(request, env, context);
    const timed=env.REXBID_TIMED_IAAI_ENABLED === 'enabled' ? await storedReads.readTimed?.(request,env,readNormal) : null;
    const {response: storedResponse, active} = timed || await readNormal();
    if (storedResponse) {
      const headers = new Headers(storedResponse.headers);
      headers.delete("X-Robots-Tag");
      headers.set("X-Frame-Options", "DENY");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Referrer-Policy", "no-referrer");
      headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
      if(!headers.has("X-RexBid-Read-Source"))headers.set("X-RexBid-Read-Source", "d1");
      if (active) headers.set("X-RexBid-Catalog", "active-10733");
      return new Response(storedResponse.body, {status: storedResponse.status, headers});
    }
    // Keep session/CSRF, AAL2, portal
    // authorization and Calculator V4; this is not the inactive release wrapper.
    const response = await rexWorker.fetch(request, env, context);
    trafficModule.recordTraffic(request, response, env, context);
    return phase === "catalog" ? catalogOnlyNavigation(response) : response;
  }
};
