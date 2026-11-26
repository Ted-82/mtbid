'use strict';
// Private server-only intake. A successful download is not a catalogue commit.
const {createHash, randomUUID} = require('node:crypto');
const MAX_BYTES = 128 * 1024 * 1024, PART_BYTES = 5 * 1024 * 1024;
function fail(code) {throw Object.assign(Error(code), {code});}
function validateFeedUrl(value) {
  let url; try {url = new URL(value);} catch {fail('FEED_URL_INVALID');}
  if (url.origin !== 'https://apibara.tech' || url.username || url.password || url.search || url.hash
      || !/^\/data-feeds\/[A-Za-z0-9_-]+\/latest$/.test(url.pathname)) fail('FEED_URL_INVALID');
  return url.href;
}
async function downloadLatest({bucket, url, fetchImpl = fetch, now = Date.now, maxBytes = MAX_BYTES, beforeUpload, beforeComplete} = {}) {
  validateFeedUrl(url);
  if (!bucket?.createMultipartUpload || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) fail('FEED_DOWNLOAD_CONFIG');
  let response;
  try {response = await fetchImpl(url, {redirect: 'manual', signal: AbortSignal.timeout(240000),
    headers: {Accept: 'application/gzip', 'Accept-Encoding': 'identity'}});} catch {fail('FEED_DOWNLOAD_TRANSPORT');}
  if (response.status !== 200) {
    await response.body?.cancel();
    const error = Object.assign(Error('FEED_DOWNLOAD_HTTP'), {code: 'FEED_DOWNLOAD_HTTP', status: response.status});
    const retry = Number(response.headers.get('retry-after'));
    if (Number.isFinite(retry) && retry > 0) error.retryAfter = Math.min(86400, Math.ceil(retry));
    throw error;
  }
  const disposition = response.headers.get('content-disposition') || '';
  const match = /(?:^|;\s*)filename="?apibara-feed-(\d+)-(\d+)\.jsonl\.gz"?(?:;|$)/.exec(disposition);
  const length = Number(response.headers.get('content-length'));
  if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) < 1
      || !response.body || response.headers.get('content-encoding')
      || !/^(application\/(gzip|octet-stream|x-gzip))(?:;|$)/i.test(response.headers.get('content-type') || '')
      || !Number.isSafeInteger(length) || length < 1 || length > maxBytes) {
    await response.body?.cancel(); fail('FEED_DOWNLOAD_HEADERS');
  }
  const observedAt = new Date(now()).toISOString(), generationId = Number(match[2]), feedId = Number(match[1]);
  let plan;
  try { plan = beforeUpload ? await beforeUpload({generationId, feedId, observedAt, compressedBytes: length}) : null; }
  catch (error) { await response.body.cancel().catch(() => {}); throw error; }
  const rawKey = plan?.rawKey || `raw/${generationId}/${randomUUID()}.jsonl.gz`;
  const existing = plan?.existingCapture || null;
  if (plan && (!rawKey.startsWith(`raw/${generationId}/`) || !/[a-f0-9-]{36}\.jsonl\.gz$/.test(rawKey) || plan.observedAt && !Number.isFinite(Date.parse(plan.observedAt)))) fail('FEED_DOWNLOAD_CONFIG');
  const upload = existing ? null : await bucket.createMultipartUpload(rawKey, {httpMetadata: {contentType: 'application/gzip'},
    customMetadata: {observedAt, generationId: String(generationId), feedId: String(feedId)}});
  const reader = response.body.getReader(), digest = createHash('sha256'), parts = [];
  let size = 0, pending = new Uint8Array(PART_BYTES), used = 0, magic = [];
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      if (!(value instanceof Uint8Array) || (size += value.byteLength) > maxBytes || size > length) fail('FEED_DOWNLOAD_SIZE');
      for (let i = 0; magic.length < 2 && i < value.length; i++) magic.push(value[i]);
      digest.update(value);
      for (let offset = 0; upload && offset < value.byteLength;) {
        const count = Math.min(PART_BYTES - used, value.byteLength - offset);
        pending.set(value.subarray(offset, offset + count), used); used += count; offset += count;
        if (used === PART_BYTES) {parts.push(await upload.uploadPart(parts.length + 1, pending)); pending = new Uint8Array(PART_BYTES); used = 0;}
      }
    }
    if (size !== length || magic[0] !== 31 || magic[1] !== 139) fail('FEED_DOWNLOAD_TRUNCATED');
    const sha256 = digest.digest('hex');
    if (existing && (existing.generationId !== generationId || existing.feedId !== feedId || existing.compressedBytes !== size || existing.sha256 !== sha256)) fail('FEED_DOWNLOAD_GENERATION_CHANGED');
    await beforeComplete?.({generationId, feedId, sha256, rawKey, observedAt, compressedBytes: size});
    if (upload) {
      if (used) parts.push(await upload.uploadPart(parts.length + 1, pending.subarray(0, used)));
      await upload.complete(parts);
    }
    return existing ? {...existing, reused: true} : {generationId, feedId, sha256, rawKey, observedAt: plan?.observedAt || observedAt, compressedBytes: size};
  } catch (error) {
    try {await reader.cancel();} catch {}
    try {await upload?.abort();} catch {}
    if (/^FEED_[A-Z_]+$/.test(error?.code || '')) throw error;
    fail('FEED_DOWNLOAD_STORAGE');
  } finally {reader.releaseLock();}
}
module.exports = {MAX_BYTES, PART_BYTES, validateFeedUrl, downloadLatest};
