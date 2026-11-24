'use strict';

const {gzipSync,gunzipSync}=require('node:zlib');
const COMPRESSED_HEADER='rexbid-media-v2:gzip:';
const MAX_MEDIA_BYTES=262144;

const HEADER = 'rexbid-media-v1:';
const PREFIXES = [
  'https://vis.iaai.com/resizer?imageKeys=',
  'https://cs.copart.com/v1/AUTH_svc.pdoc00001/',
  'https://mediaretriever.iaai.com/api/EngineVideoRetriever?',
  'https://vis.iaai.com/Home/ThreeSixtyView?'
];
const MARKER = '"~rb:';

function packMediaJson(value) {
  if(typeof value==='string'&&value.startsWith(COMPRESSED_HEADER))return value;
  if(typeof value==='string'&&(value.startsWith('[')||value.startsWith(HEADER))){
    const raw=unpackMediaJson(value);
    const bytes=Buffer.from(raw);
    if(bytes.length<=MAX_MEDIA_BYTES){
      const compressed=COMPRESSED_HEADER+gzipSync(bytes).toString('base64');
      // Compare against the original prefix encoding as well; retain the smallest representation.
      const prior=packPrefixJson(raw);
      return Buffer.byteLength(compressed)<Buffer.byteLength(prior)?compressed:prior;
    }
  }
  return packPrefixJson(value);
}

function packPrefixJson(value) {
  if (typeof value !== 'string' || !value.startsWith('[') || value.includes(MARKER)) return value;
  let packed = value;
  for (const [index, prefix] of PREFIXES.entries()) {
    packed = packed.replaceAll('"' + prefix, MARKER + index + ':');
  }
  return packed.length + HEADER.length < value.length ? HEADER + packed : value;
}

function unpackMediaJson(value) {
  if(typeof value==='string'&&value.startsWith(COMPRESSED_HEADER)){
    const encoded=value.slice(COMPRESSED_HEADER.length);
    if(encoded.length>MAX_MEDIA_BYTES*2||encoded.length%4!==0||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))throw Error('CATALOG_MEDIA_ENCODING');
    const raw=gunzipSync(Buffer.from(encoded,'base64'),{maxOutputLength:MAX_MEDIA_BYTES}).toString('utf8');
    if(!raw.startsWith('[')||!Array.isArray(JSON.parse(raw)))throw Error('CATALOG_MEDIA_ENCODING');
    return raw;
  }
  if (typeof value !== 'string' || !value.startsWith(HEADER)) return value;
  let json = value.slice(HEADER.length);
  for (const [index, prefix] of PREFIXES.entries()) {
    json = json.replaceAll(MARKER + index + ':', '"' + prefix);
  }
  return json;
}

// SQL identifiers here are internal constants. Match the JavaScript encoding
// exactly, so the one-time rewrite and ongoing import use the same format.
function packedColumn(column) {
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  let packed = column;
  for (const [index, prefix] of PREFIXES.entries()) {
    packed = `replace(${packed},${quote('"' + prefix)},${quote(MARKER + index + ':')})`;
  }
  return `CASE WHEN substr(${column},1,1)='[' AND instr(${column},${quote(MARKER)})=0
    AND length(${packed})+${HEADER.length}<length(${column}) THEN ${quote(HEADER)}||${packed} ELSE ${column} END`;
}

module.exports = {packMediaJson, unpackMediaJson, packedColumn};

