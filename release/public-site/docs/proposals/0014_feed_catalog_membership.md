# Additive catalogue membership bootstrap (local proposal)

This proposal creates three empty tables and a NULL pointer. It does not change provider plans, budgets, canonical listing IDs, vehicle sources, prices, observation dates, auction history, saved references or portal data. No deployment, remote DDL or activation is implied by the file.

## Source proof and activation

A baseline descriptor is immutable and bound by SHA-256. It pins environment scope, exact compressed snapshot SHA/generation/count, the captured change cursor and response artifact SHA, capture timestamp, snapshot request start, source observation bound, and explicitly known/unknown provider generation time. Vehicle updated_at maximum is not snapshot generation time.

Capture must precede the snapshot request. This alone does not prove a fresh snapshot: downloading old initial generation 4548 now cannot establish a new baseline at the latest cursor.

Seal requires an explicit sourceProofSha256 argument matching the pinned artifact and one of these typed proofs:

- fresh-generation: provider generation timestamp is known and at least the cursor capture timestamp;
- provider-checkpoint: the provider explicitly binds the exact snapshot SHA to the exact replayStartSequence, equal to the descriptor capture.sequence.

Unknown generation time stays null. Unknown source order never seals; arbitrary acknowledged booleans/generation IDs/local download dates cannot substitute for provider proof. The module checks binding and chronology; the operator must inspect the actual provider evidence before supplying its SHA at seal.

Snapshot accounting must reach the exact record count, and at least one verified delta checkpoint must exist, including a verified empty page when head equals the start cursor. Replay uses after/through provider cursor continuity, allowing legitimate sequence gaps. Root verifies transport/parser ordering and retention completeness; module does not claim that integers represent event counts.

Seal defaults to zero excluded/unresolved source records. Any explicit nonzero review must name the exact combined count and a review artifact SHA; no silent bad-VIN acceptance. The new baseline stays invisible until the atomic pointer switch. Root must separately review any source rejection tolerance.

## Canonical snapshot integration

Create FeedBootstrapMembership({db,store}) with the same RefreshStore/shared lease. begin(plan) inserts or verifies the exact immutable descriptor, never resets prior progress. The optional importSnapshotBatch prepareCheckpointStatements callback runs after canonical preparation and before commit; return snapshotStatements(...).statements (four statements). They append after canonical writes inside the same commitInventoryBatch transaction.

snapshotStatements receives baselineId, offset, endOffset, batchSha256, resolved identities, excludedCount and unresolvedCount. Resolved identities contain listingId,sourceKey,platform,lot,vin. Counts sum to the entire source page (maximum60). Membership guard rechecks the exact resolved canonical identity, Apibara source and full VIN after canonical writes. Duplicate membership across snapshot pages rejects. A rejected/unresolved source record never creates an active member.

A matching newer canonical record can join without overwriting its newer data. The resolver must validate the source identity, canonical Open/Live eligibility, full VIN, unique platform/LOT and source. Such skipped rows also carry expected:{updatedAt,sourceUpdatedAt,summarySyncedAt,detailSyncedAt,auctionState}; every field is compared using SQL IS to prevent a race after resolution. Prepared rows already have the canonical import CAS. Unsafe skipped rows count as unresolved.

Verified old canonical audit replay bypasses the extension; the coordinator checks the durable membership offset and lastBatch SHA. A lost response is an unknown result: read durable canonical and membership receipts, do not blindly repeat a write. All checkpoint/member writes share rollback with canonical writes and the shared lease guard.

## Continuous changes and pointer

deltaStatements receives baselineId, after, through, batchSha256, changes, unresolvedCount and returns four composable statements. Caller appends these to the SAME canonical/event/global-cursor transaction. Each changed identity has a proven final active boolean and sequence in (after,through]; collapse repeated identity events to their final verified decision before calling. Terminal/exit means inactive. Proven complete Open/Live creation/update means active. A partial record with unknown eligibility preserves existing membership or creates a durable unresolved reconciliation requirement; it cannot be guessed active.

seal({baselineId,through,sourceProofSha256,...}) checks exact completed snapshot, replay cursor, source proof and reviewed unresolved accounting. switchPointer({baselineId,expectedBaselineId,expectedRevision,checkpointStatements}) atomically checks the sealed target and pointer revision. At most six root-owned checkpoint statements may join pointer activation (for example a coordinated global cursor alignment); no manual lower cursor should replay newer canonical data as old data.

Public catalogue/filter queries must use the active pointer and active membership. Membership lookup is a primary-key search on (baseline_id,listing_id); preserve existing route/auth/cache isolation. Pointer NULL means legacy catalogue view, which is also the first-activation rollback destination. Detail/history lookup remains canonical, and an absent membership can be described only as not in the current verified baseline; it does not prove Sold or a final price.

Rollback is pointer CAS to a previous sealed baseline or NULL. It does not roll back canonical prices/history or provider/global cursors. A previous baseline may be stale and needs an explicit continuity check before promising fresh coverage. Cache invalidation/versioning must accompany pointer changes so prior catalogue/filter cache does not mask the switch.

## Cost and defaults

No table scan/backfill or destructive reset is needed for DDL. Membership adds approximately one table-row write per distinct accepted snapshot listing; its WITHOUT ROWID primary key avoids a second membership index. There are no state/active secondary indexes. Each batch adds one baseline checkpoint update and two short-lived guard row writes; the existing shared lease adds its normal guard writes. Delta pages write only affected membership rows plus bounded checkpoint/guard work, not the full baseline. Actual D1 billing must be recorded from response metadata, including index accounting and failed/uncertain requests; row-operation estimates are not an invoice promise.

Public per-listing EXISTS probes are indexed, but metadata aggregation must scan only appropriate members and should retain the existing shared public-taxonomy cache. Root owns the query plan verification. New empty tables alone do not activate anything; code does not touch runtime flags, D1 caps or provider limits. Existing daily accounting remains authoritative and caller must reserve/account all extra operations before running.

Offline tests cover transaction failure, lost response, immutable source binding, source-order failure, skipped-row races, snapshot duplicates, exact accounting, unresolved gates, legitimate sequence gaps, enter/exit, shared lease, atomic pointer/global cursor checks, NULL rollback and preservation of canonical saved references. No provider or remote database calls are made.
Grouped delta fragments use deltaFragmentStatements with the same after/through for an entire file or verified API page. Each fragment shares the canonical batch transaction, holds replaySequence at after, stores a pendingDelta bound, and applies only per-identity newer membership sequences. Sequence order between LOT groups/buckets is intentionally irrelevant. Fragment mode clears replayVerified and prevents seal. The canonical batch audit and immutable extension tag are the authoritative duplicate/replay receipt: verified replay MUST omit the fragment callback, otherwise a newly built duplicate could recount unresolved records. There is no fourth membership receipt table.

Only after every canonical receipt for that exact file/page has been verified may root append deltaStatements with empty changes and zero new unresolved records to the final global-cursor commit. It must match pending after/through exactly. This clears pendingDelta and advances once; a previously ready active baseline regains ready only when no new unresolved issue requires review. Initial bootstrap remains replaying until the explicit source-reviewed seal. Failure rolls back membership and canonical changes together. No pointer activation is performed by fragments or final delta checkpoints.

The shared delta adapter is createBootstrapDeltaExtension from sync/feed-bootstrap-delta.cjs. It returns the importer extension key membership:<baselineId> and prepare callback. The callback performs one bounded primary-key membership lookup for at most100 known canonical IDs, then returns the four fragment statements. Existing membership survives ordinary bid-only and stale events; absent old canonical rows cannot re-enter from an old Open label or a bid-only event. Those unknown eligibility cases are counted for reconciliation.

The group reducer now exposes an additive acceptedEligibility proof without changing canonical assignments, patch counts or existing update semantics. It follows the same identity, source-version and observation-time guards, including a fresh explicit Open/Live value equal to the canonical value. Unknown or missing eligibility values are unresolved; later stale raw events do not override accepted evidence. A created full record uses the existing pure hydration selector and requires matching full identity, Open/Live state, exact canonical source/summary version and no newer detail/last-seen observation. Unknown terminal events create no fabricated canonical or membership row.
