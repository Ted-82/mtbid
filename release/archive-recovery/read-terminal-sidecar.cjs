'use strict';

const LIMIT = 115;
const MAX_BYTES = 65536;
const hex = /^[a-f0-9]{64}$/;

async function checkedJSON(bucket, key, digest, hash, expectedBytes) {
  if (!hex.test(digest)) throw Error('archive_sidecar_checksum');
  const object = await bucket.get(key);
  if (!object || !Number.isSafeInteger(object.size) || object.size < 1 || object.size > MAX_BYTES
    || expectedBytes !== undefined && object.size !== expectedBytes) throw Error('archive_sidecar_size');
  const body = await object.text();
  if (new TextEncoder().encode(body).length !== object.size || await hash(body) !== digest) throw Error('archive_sidecar_checksum');
  return JSON.parse(body);
}

async function readTerminalSidecar({ bucket, generation, after, manifestChecksum, hash, limit=LIMIT }) {
  const { generation_id:id, sha256, first_sequence:from, last_sequence:through } = generation;
  if (!Number.isSafeInteger(id) || !hex.test(sha256) || !Number.isSafeInteger(from) || !Number.isSafeInteger(through)
    || !Number.isSafeInteger(after) || after > through || !Number.isInteger(limit) || limit < 1 || limit > LIMIT) {
    throw Error('archive_sidecar_scope');
  }
  const base = `v2/private/terminal/${id}/${sha256}/`;
  const manifest = await checkedJSON(bucket, base+'manifest.json', manifestChecksum, hash);
  if (manifest.version !== 1 || manifest.kind !== 'archive-terminal-sidecar' || manifest.generation !== id
    || manifest.rawSha256 !== sha256 || manifest.from !== from || manifest.through !== through
    || !Array.isArray(manifest.parts) || manifest.parts.length > 256) throw Error('archive_sidecar_scope');
  let prev = from - 1, count = 0;
  for (const [index, part] of manifest.parts.entries()) {
    const { name, bytes, sha256:sha, start, end, count:rows } = part;
    if (!hex.test(sha) || name !== `part-${String(index).padStart(4,'0')}-${sha}.json` || !Number.isInteger(bytes)
      || bytes < 1 || bytes > MAX_BYTES || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || start <= prev || end < start || end > through || !Number.isInteger(rows) || rows<1 || rows>LIMIT
      || index < manifest.parts.length - 1 && rows !== LIMIT) throw Error('archive_sidecar_manifest');
    prev=end;
    count+=rows;
  }
  if (manifest.terminal !== count) throw Error('archive_sidecar_manifest');
  const events=[];
  let partsRead=0;
  for (const part of manifest.parts) {
    if (part.end<=after) continue;
    const payload = await checkedJSON(bucket, base+part.name, part.sha256, hash, part.bytes);
    partsRead++;
    if (!Array.isArray(payload) || payload.length!==part.count || payload[0]?.sequence!==part.start
      || payload.at(-1)?.sequence!==part.end) throw Error('archive_sidecar_event');
    prev=part.start-1;
    for (const event of payload) {
      if (event?.generation!==id || !Number.isSafeInteger(event.sequence) || event.sequence<=prev || event.sequence>part.end
        || !['copart','iaai'].includes(event.platform) || !/^[A-HJ-NPR-Z0-9]{17}$/.test(event.vin)
        || !/^\d{5,14}$/.test(event.lot) || !['sold','not_sold','ended_unknown'].includes(event.status)
        || !Number.isFinite(Date.parse(event.recordedAt)) || event.saleCents!==null
        && (event.status!=='sold' || !Number.isSafeInteger(event.saleCents) || event.saleCents<=0)) throw Error('archive_sidecar_event');
      prev=event.sequence;
      if (event.sequence>after && events.length<limit) events.push(event);
    }
    if (events.length>=limit) break;
  }
  return { events, partsRead, mayContinue: events.length>0 && events.at(-1).sequence<manifest.parts.at(-1).end };
}

module.exports={readTerminalSidecar};
