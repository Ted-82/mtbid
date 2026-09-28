"use strict";

const DEFAULT_BUDGET_POLICY = Object.freeze({
  pageSize: 20,
  hotShare: 0.05,
  hotSweepsPerDay: 4,
  detailSharePerDay: 0.02,
  historySharePerDay: 0.01,
  historyContinuationShare: 0.1,
  retryReserveRate: 0.05,
  metadataRequestsPerDay: 0
});

function countCeil(value) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError("Liczba rekordów musi być nieujemna.");
  return Math.ceil(value);
}

function calculateDailyRequestPlan(listingCount, overrides = {}) {
  const count = countCeil(Number(listingCount));
  const policy = { ...DEFAULT_BUDGET_POLICY, ...overrides };
  if (!Number.isInteger(policy.pageSize) || policy.pageSize < 1) throw new TypeError("pageSize musi być dodatnią liczbą całkowitą.");
  for (const key of ["hotShare", "detailSharePerDay", "historySharePerDay", "historyContinuationShare", "retryReserveRate"]) {
    if (!Number.isFinite(policy[key]) || policy[key] < 0 || policy[key] > 1) throw new TypeError(`${key} musi należeć do zakresu 0..1.`);
  }
  for (const key of ["hotSweepsPerDay", "metadataRequestsPerDay"]) {
    if (!Number.isFinite(policy[key]) || policy[key] < 0) throw new TypeError(`${key} musi być nieujemne.`);
  }
  const pages = records => countCeil(records / policy.pageSize);
  const discovery = pages(count);
  const hotRecords = countCeil(count * policy.hotShare);
  const hotRefresh = countCeil(policy.hotSweepsPerDay) * pages(hotRecords);
  const detail = countCeil(count * policy.detailSharePerDay);
  const historyRecords = countCeil(count * policy.historySharePerDay);
  const historyFirstPage = historyRecords;
  const historyContinuation = countCeil(historyRecords * policy.historyContinuationShare);
  const metadata = countCeil(policy.metadataRequestsPerDay);
  const base = discovery + hotRefresh + detail + historyFirstPage + historyContinuation + metadata;
  const retryReserve = countCeil(base * policy.retryReserveRate);
  return Object.freeze({
    listingCount: count,
    categories: Object.freeze({ discovery, hotRefresh, detail, historyFirstPage, historyContinuation, metadata, retryReserve }),
    baseRequestsPerDay: base,
    totalRequestsPerDay: base + retryReserve,
    averageRequestsPerHour: (base + retryReserve) / 24
  });
}

class RequestBudgetGuard {
  constructor({ limit, consumed = 0 } = {}) {
    if (!Number.isInteger(limit) || limit < 0 || !Number.isInteger(consumed) || consumed < 0 || consumed > limit) {
      throw new TypeError("Nieprawidłowy dzienny limit requestów.");
    }
    this.limit = limit;
    this.consumed = consumed;
    this.reserved = 0;
    this.nextId = 1;
    this.reservations = new Map();
  }

  get remaining() { return Math.max(0, this.limit - this.consumed - this.reserved); }
  get canSchedule() { return this.remaining > 0; }

  reserve(kind, count = 1) {
    if (!Number.isInteger(count) || count < 1 || !String(kind || "").trim()) throw new TypeError("Nieprawidłowa rezerwacja budżetu.");
    if (count > this.remaining) return { allowed: false, reason: "BUDGET_EXHAUSTED", remaining: this.remaining };
    const id = this.nextId++;
    const reservation = { id, kind: String(kind), count, started: false };
    this.reservations.set(id, reservation);
    this.reserved += count;
    return { allowed: true, reservation: { ...reservation }, remaining: this.remaining };
  }

  start(reservationId) {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new Error("RESERVATION_NOT_FOUND");
    if (reservation.started) return false;
    reservation.started = true;
    this.reserved -= reservation.count;
    this.consumed += reservation.count;
    return true;
  }

  complete(reservationId) {
    const reservation = this.reservations.get(reservationId);
    if (!reservation || !reservation.started) return false;
    this.reservations.delete(reservationId);
    return true;
  }

  cancel(reservationId) {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) return false;
    if (reservation.started) throw new Error("IN_FLIGHT_REQUEST_CANNOT_BE_CANCELLED");
    this.reserved -= reservation.count;
    this.reservations.delete(reservationId);
    return true;
  }
}

function timeValue(value, label) {
  const result = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(result)) throw new TypeError(`${label} musi być podany jawnie jako czas.`);
  return result;
}

function planFreshness(listing, now, policy) {
  if (!listing || typeof listing !== "object") throw new TypeError("Wymagany listing.");
  const at = timeValue(now, "now");
  const required = ["hotIntervalMs", "warmIntervalMs", "coldIntervalMs", "hotWindowMs"];
  if (!policy || required.some(key => !Number.isFinite(policy[key]) || policy[key] < 0)) {
    throw new TypeError("Freshness policy musi jawnie podać nieujemne interwały.");
  }

  const state = String(listing.auction?.state ?? listing.auction_state ?? "").trim().toLowerCase();
  const terminal = new Set(["finished", "sold", "not_sold", "cancelled", "closed", "ended"]);
  const timedEnd = listing.auction?.timed_end_at ?? listing.timed_end_at ?? null;
  const auctionAt = listing.auction?.auction_at ?? listing.auction_at ?? null;
  const timedEndMs = timedEnd ? Date.parse(timedEnd) : NaN;
  const auctionMs = auctionAt ? Date.parse(auctionAt) : NaN;
  let freshnessClass;
  let reason;
  let interval;

  if (terminal.has(state)) {
    freshnessClass = "COLD"; reason = "terminal_state"; interval = policy.coldIntervalMs;
  } else if (listing.watched === true || ["live", "in_progress", "running"].includes(state)
      || (Number.isFinite(timedEndMs) && timedEndMs >= at && timedEndMs - at <= policy.hotWindowMs)
      || (Number.isFinite(auctionMs) && auctionMs >= at && auctionMs - at <= policy.hotWindowMs)) {
    freshnessClass = "HOT"; reason = listing.watched === true ? "watched" : "near_or_live_auction"; interval = policy.hotIntervalMs;
  } else if (["upcoming", "scheduled", "active", "pre_bid", "prebid", "timed"].includes(state)
      || Number.isFinite(auctionMs) || Number.isFinite(timedEndMs)) {
    freshnessClass = "WARM"; reason = "active_not_imminent"; interval = policy.warmIntervalMs;
  } else {
    freshnessClass = "COLD"; reason = "insufficient_schedule_data"; interval = policy.coldIntervalMs;
  }

  const lastSynced = listing.lastSyncedAt ?? listing.summary_synced_at ?? null;
  const lastSyncedMs = lastSynced === null ? NaN : timeValue(lastSynced, "lastSyncedAt");
  const due = !Number.isFinite(lastSyncedMs) || at - lastSyncedMs >= interval;
  return Object.freeze({ freshnessClass, reason, due, nextRefreshAt: Number.isFinite(lastSyncedMs) ? lastSyncedMs + interval : at, intervalMs: interval });
}

module.exports = { DEFAULT_BUDGET_POLICY, calculateDailyRequestPlan, RequestBudgetGuard, planFreshness };
