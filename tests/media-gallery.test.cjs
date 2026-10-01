const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {isHttpUrl, normalizeMedia} = require('../public/rexbid-media.js');

test('real car page loads the tested media normalizer before initializing the gallery', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/car.html'), 'utf8');
  assert.match(html, /<script src="\/rexbid-media\.js"><\/script>\s*<script>/);
  assert.match(html, /photos\s*=\s*window\.RexBidMedia\.normalizeMedia\(car\)/);
  assert.doesNotMatch(html, /function\s+isHttpUrl\s*\(|(?<!RexBidMedia\.)\bisHttpUrl\s*\(/);
  assert.match(html, /RexBidMedia\.isHttpUrl\(url\)/);
});

test('shared media URL helper validates the links used by video, 360 and source navigation', () => {
  assert.equal(isHttpUrl('https://cdn.example/photo.jpg'), true);
  assert.equal(isHttpUrl('http://cdn.example/photo.jpg'), false);
  assert.equal(isHttpUrl('/relative/photo.jpg'), false);
});

test('canonical parallel media URL and thumbnail arrays render one gallery item per image', () => {
  const media = {
    media: {
      items: Array.from({length: 13}, (_, index) => `https://cdn.example/car-${index + 1}-full.jpg`),
      thumbs: Array.from({length: 13}, (_, index) => `https://cdn.example/thumb/car-${index + 1}-small.jpg`)
    },
    photos: Array.from({length: 13}, (_, index) => `https://cdn.example/alternate/car-${index + 1}.jpg`)
  };
  const photos = normalizeMedia(media);
  assert.equal(photos.length, 13);
  assert.equal(photos[0].large, 'https://cdn.example/car-1-full.jpg');
  assert.equal(photos[0].thumb, 'https://cdn.example/thumb/car-1-small.jpg');
  assert.equal(photos[12].large, 'https://cdn.example/car-13-full.jpg');
  assert.equal(photos[12].thumb, 'https://cdn.example/thumb/car-13-small.jpg');
});

test('canonical gallery keeps all full-size images when a thumbnail is missing and excludes non-HTTPS media', () => {
  const photos = normalizeMedia({media:{
    items:['https://cdn.example/one.jpg','https://cdn.example/two.jpg','http://cdn.example/insecure.jpg'],
    thumbs:['https://cdn.example/one-thumb.jpg']
  }});
  assert.equal(photos.length, 2);
  assert.deepEqual(photos.map(photo => photo.large), ['https://cdn.example/one.jpg','https://cdn.example/two.jpg']);
  assert.equal(photos[1].thumb, photos[1].large);
});

test('provider photo identities deduplicate alternate IAAI URLs without turning thumbnails into extra images', () => {
  const photos = normalizeMedia({media:{
    items:['https://img.example/photo?imageKeys=abc&size=full'],
    thumbs:['https://img.example/photo?imageKeys=abc&size=thumb']
  }});
  assert.equal(photos.length, 1);
  assert.equal(photos[0].large, 'https://img.example/photo?imageKeys=abc&size=full');
  assert.equal(photos[0].thumb, 'https://img.example/photo?imageKeys=abc&size=thumb');
});
