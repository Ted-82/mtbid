"use strict";

// Pure public query/coverage formatting, independent of staging or sync runners.
function coverageMetadata(coverage) {
  const platforms = coverage?.platforms || [];
  return {catalog_complete: Boolean(coverage?.complete), scope_status: coverage?.complete ? "complete"
    : platforms.some(item => item.status === "failed") ? "failed"
    : platforms.some(item => item.status === "stale") ? "stale"
    : platforms.every(item => item.status === "not_synced") ? "missing" : "partial",
    platform_coverage: platforms.map(item => ({platform: item.platform, status: item.status,
      complete: item.complete, scope_count: item.scope_count, cursor_present: item.next_page_available,
      last_complete_at: item.last_complete_at}))};
}

function queryOptions(url, now = Date.now()) {
  const q = url.searchParams;
  const intOrNull = value => value !== null && /^\d+$/.test(value) ? Number(value) : null;
  const numberOrNull = value => value !== null && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
  const status = (q.get("lot_status") || "").trim();
  const statusLower = status.toLowerCase();
  const lotSubStatus = q.get("lot_sub_status");
  const timed = statusLower === "timed" ? true : q.has("timed") ? q.get("timed") === "true" : null;
  const buyNow = statusLower === "buy now" || q.get("buy_now") === "true";
  const auctionState = lotSubStatus || (status && !["timed", "buy now"].includes(statusLower) ? status : null);
  return {category: q.get("category"), platform: q.get("platform"), make: q.get("make"), model: q.get("model"),
    search: q.get("s") || q.get("search"), yearFrom: intOrNull(q.get("year_from")), yearTo: intOrNull(q.get("year_to")),
    timed, buyNow, auctionState: q.has("category") && auctionState === "Open" ? null : auctionState,
    sourceStatus: q.get("source_status"), upcoming: ["only", "without"].includes(q.get("upcoming")) ? q.get("upcoming") : null,
    bodyStyle: q.get("type"), fuelType: q.get("fuel_type"), transmission: q.get("transmission"),
    driveType: q.get("drive_type"), runCondition: q.get("run_cond"), damage: q.get("damage"),
    sellerType: q.get("seller_type"), saleDocumentType: q.get("sale_document_type"), saleDocumentName: q.get("sale_document_name"), locationState: q.get("loc_state"),
    priceMin: numberOrNull(q.get("price_min")), priceMax: numberOrNull(q.get("price_max")),
    odometerFrom: numberOrNull(q.get("odometer_from")), odometerTo: numberOrNull(q.get("odometer_to")),
    nowIso: new Date(now).toISOString(),
    limit: q.has("per_page") && /^\d+$/.test(q.get("per_page")) ? Math.min(50, Math.max(1, Number(q.get("per_page")))) : 20,
    cursor: q.get("cursor"), sort: q.get("sort")};
}

module.exports = {coverageMetadata, queryOptions};
