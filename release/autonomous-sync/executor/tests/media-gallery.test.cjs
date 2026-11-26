const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {isHttpUrl, normalizeMedia} = require('../public/rexbid-media.js');

function imageElement(source = '', complete = false, naturalWidth = 0) {
  let currentSource = source;
  return {
    style: {}, alt: '', complete, naturalWidth, sourceWrites: [],
    get src() { return currentSource; },
    set src(value) {
      currentSource = value;
      this.sourceWrites.push(value);
      this.complete = false;
      this.naturalWidth = 0;
    },
    getAttribute(name) { return name === 'src' ? currentSource : null; }
  };
}

function galleryRuntime(photos = [], {photoIndex = 0, cachedBrokenThumbs = []} = {}) {
  const vm = require('node:vm');
  const html = fs.readFileSync(path.join(__dirname, '../public/car.html'), 'utf8');
  const slice = (start, end) => {
    const from = html.indexOf(start);
    const to = html.indexOf(end, from);
    assert.ok(from >= 0 && to > from, 'production gallery function is present');
    return html.slice(from, to);
  };
  const button = () => ({hidden: false, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; }});
  const thumbs = {buttons: [], html: '', querySelectorAll: () => thumbs.buttons};
  Object.defineProperty(thumbs, 'innerHTML', {
    get() { return this.html; },
    set(value) {
      this.html = value;
      this.buttons = Array.from(value.matchAll(/data-i="(\d+)"[\s\S]*?<img src="([^"]+)"/g), match => {
        const index = Number(match[1]);
        const image = imageElement(match[2], cachedBrokenThumbs.includes(index));
        const unavailable = {hidden: true};
        return {...button(), dataset: {i: String(index)}, image, unavailable,
          querySelector(selector) { return selector === 'img' ? image : unavailable; }};
      });
    }
  });
  const elements = {
    mainImage: imageElement(), mainImageUnavailable: {hidden: true},
    lbImage: imageElement(), lbImageUnavailable: {hidden: true}, lbInfo: {textContent: ''},
    thumbs, photoCount: {textContent: ''}, openHd: button(),
    prevPhoto: button(), nextPhoto: button(), lbPrev: button(), lbNext: button()
  };
  const context = {photos, photoIndex, zoom: 1, panX: 0, panY: 0, galleryGestures:null, elements,
    document: {getElementById: id => elements[id]}, esc: value => String(value), getTitle: () => 'Test vehicle'};
  vm.runInNewContext([
    slice('  function setGalleryImage(', '\n  function bindPageEvents('),
    slice('  function updateLightbox()', '\n  function setZoom('),
    slice('    document.getElementById("prevPhoto")?.addEventListener', '    document.getElementById("mainImage")?.addEventListener'),
    slice('  document.getElementById("lbPrev").addEventListener', '  document.getElementById("viewerClose").addEventListener')
  ].join('\n'), context);
  return context;
}

test('real car page loads the tested media normalizer before initializing the gallery', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/car.html'), 'utf8');
  const mediaScript = html.indexOf('<script src="/rexbid-media.js"></script>');
  const galleryInit = html.indexOf('photos = normalizeVehicleMedia(car)');
  assert.ok(mediaScript >= 0 && galleryInit > mediaScript, 'shared media normalizer loads before gallery code');
  assert.match(html, /photos\s*=\s*normalizeVehicleMedia\(car\)/);
  assert.match(html, /const normalize = window\.RexBidMedia\?\.normalizeMedia/);
  assert.match(html, /function isHttpMediaUrl\(value\)/);
  assert.doesNotMatch(html, /function\s+isHttpUrl\s*\(|(?<!RexBidMedia\.)\bisHttpUrl\s*\(/);
  assert.match(html, /window\.RexBidMedia\.isHttpUrl\(value\)/);
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

test('car gallery hides dead lightbox and navigation controls when media is absent', () => {
  const context = galleryRuntime();
  const {elements} = context;
  context.renderPhotos();
  assert.equal(elements.mainImage.style.display, 'none');
  assert.equal(elements.photoCount.textContent, 'Brak zdjęć');
  assert.match(elements.thumbs.innerHTML, /Brak zdjęć w danych aukcji/);
  assert.equal(elements.openHd.hidden, true);
  assert.equal(elements.prevPhoto.hidden, true);
  assert.equal(elements.nextPhoto.hidden, true);

  context.photos = [
    {large: 'https://cdn.example/one.jpg', thumb: 'https://cdn.example/one-small.jpg'},
    {large: 'https://cdn.example/two.jpg', thumb: 'https://cdn.example/two-small.jpg'}
  ];
  context.renderPhotos();
  assert.equal(elements.mainImage.style.display, 'block');
  assert.equal(elements.mainImage.src, 'https://cdn.example/one.jpg');
  assert.equal(elements.openHd.hidden, false);
  assert.equal(elements.prevPhoto.hidden, false);
  assert.equal(elements.nextPhoto.hidden, false);
});

test('cached broken thumbnail 17 and full image show readable states without losing gallery controls', () => {
  const photos = Array.from({length: 18}, (_, i) => ({large: `https://cdn.example/photo-${i + 1}.jpg`, thumb: `https://cdn.example/thumb-${i + 1}.jpg`}));
  const context = galleryRuntime(photos, {photoIndex: 16, cachedBrokenThumbs: [16]});
  const {elements} = context;
  elements.mainImage = imageElement(photos[16].large, true, 0);
  elements.lbImage = imageElement(photos[16].large, true, 0);
  context.renderPhotos();
  context.updateLightbox();

  const brokenThumb = elements.thumbs.buttons[16];
  assert.equal(brokenThumb.image.complete, true);
  assert.equal(brokenThumb.image.naturalWidth, 0);
  assert.equal(brokenThumb.image.style.display, 'none');
  assert.equal(brokenThumb.unavailable.hidden, false);
  assert.match(elements.thumbs.innerHTML, /Miniatura niedostępna/);
  assert.equal(elements.mainImage.style.display, 'none');
  assert.equal(elements.mainImageUnavailable.hidden, false);
  assert.equal(elements.lbImage.style.display, 'none');
  assert.equal(elements.lbImageUnavailable.hidden, false);
  assert.equal(elements.openHd.hidden, false);
  assert.equal(elements.prevPhoto.hidden, false);
  assert.equal(elements.nextPhoto.hidden, false);
  assert.match(elements.photoCount.textContent, /17 \/ 18/);
  assert.match(elements.lbInfo.textContent, /17 \/ 18/);
  assert.equal(elements.mainImage.src, photos[16].large);
  assert.equal(elements.lbImage.src, photos[16].large);
  assert.equal(brokenThumb.image.src, photos[16].thumb);
  assert.equal(elements.mainImage.sourceWrites.length, 0);
  assert.equal(elements.lbImage.sourceWrites.length, 0);
  assert.equal(brokenThumb.image.sourceWrites.length, 0);
  brokenThumb.image.onerror();
  brokenThumb.image.onerror();
  assert.equal(brokenThumb.image.sourceWrites.length, 0, 'an error never assigns a replacement or starts a retry');
  elements.nextPhoto.handlers.click();
  assert.equal(context.photoIndex, 17, 'main next-photo navigation remains usable');
  assert.equal(elements.mainImage.src, photos[17].large);
  assert.equal(elements.mainImageUnavailable.hidden, true);
});

test('main and lightbox recover after transport errors through next-photo navigation and ignore old-source errors', () => {
  const photos = [
    {large: 'https://cdn.example/unavailable.jpg', thumb: 'https://cdn.example/unavailable-small.jpg'},
    {large: 'https://cdn.example/available.jpg', thumb: 'https://cdn.example/available-small.jpg'}
  ];
  const original = JSON.stringify(photos);
  const context = galleryRuntime(photos);
  const {elements} = context;
  context.renderPhotos();
  context.updateLightbox();
  const oldMainError = elements.mainImage.onerror;
  const oldLightboxError = elements.lbImage.onerror;
  elements.mainImage.complete = elements.lbImage.complete = true;
  oldMainError();
  oldLightboxError();
  elements.thumbs.buttons[0].image.onerror();
  assert.equal(elements.mainImageUnavailable.hidden, false);
  assert.equal(elements.lbImageUnavailable.hidden, false);
  assert.equal(elements.thumbs.buttons[0].unavailable.hidden, false);
  assert.equal(elements.mainImage.src, photos[0].large);
  assert.equal(elements.lbImage.src, photos[0].large);

  elements.lbNext.handlers.click();
  assert.equal(context.photoIndex, 1);
  assert.equal(elements.mainImage.src, photos[1].large);
  assert.equal(elements.lbImage.src, photos[1].large);
  oldMainError();
  oldLightboxError();
  assert.equal(elements.mainImageUnavailable.hidden, true, 'late errors for the old main source cannot hide the next image');
  assert.equal(elements.lbImageUnavailable.hidden, true, 'late errors for the old lightbox source cannot hide the next image');
  for (const image of [elements.mainImage, elements.lbImage]) {
    image.complete = true;
    image.naturalWidth = 1200;
    image.onload();
    assert.equal(image.style.display, 'block');
    assert.equal(image.sourceWrites.length, 2);
  }
  assert.equal(elements.mainImageUnavailable.hidden, true);
  assert.equal(elements.lbImageUnavailable.hidden, true);
  assert.equal(elements.thumbs.buttons.length, 2, 'broken media stays in the original dynamic gallery');
  assert.match(elements.photoCount.textContent, /2 \/ 2/);
  assert.match(elements.lbInfo.textContent, /2 \/ 2/);
  assert.equal(JSON.stringify(photos), original, 'transport errors do not falsify or remove source URLs');
});

test('redisplaying or zooming a failed full image does not retry its URL', () => {
  const context = galleryRuntime([{large: 'https://cdn.example/unavailable.jpg', thumb: 'https://cdn.example/thumb.jpg'}]);
  const {elements} = context;
  context.renderPhotos();
  context.updateLightbox();
  for (const image of [elements.mainImage, elements.lbImage]) {
    image.complete = true;
    image.naturalWidth = 0;
    image.onerror();
  }
  context.renderPhotos();
  context.zoom = 2;
  context.updateLightbox();
  assert.equal(elements.mainImage.sourceWrites.length, 1);
  assert.equal(elements.lbImage.sourceWrites.length, 1);
  assert.equal(elements.mainImage.style.display, 'none');
  assert.equal(elements.lbImage.style.display, 'none');
  assert.equal(elements.mainImageUnavailable.hidden, false);
  assert.equal(elements.lbImageUnavailable.hidden, false);
});


test('IAAI extensionless engine video uses native video, not a CSP-blocked iframe', async () => {
  const vm = require('node:vm');
  const html = fs.readFileSync(path.join(__dirname, '../public/car.html'), 'utf8');
  const source = html.slice(html.indexOf('  async function openViewer('), html.indexOf('  async function closeViewer('));
  const children = [];
  const content = { innerHTML: '', appendChild(node) { children.push(node); } };
  const modal = { classList: {add() {}}, setAttribute() {} };
  const context = { document: {
    getElementById(id) { return id === 'viewerContent' ? content : modal; },
    createElement(tag) { return {tag, style: {}, addEventListener() {}}; },
    body: {classList: {add() {}}}
  }};
  vm.runInNewContext(source + '; globalThis.openVideo = openViewer;', context);
  const url = 'https://mediaretriever.iaai.com/api/EngineVideoRetriever?partitionKey=synthetic&Tenant=iaai';
  await context.openVideo(url, 'video');
  assert.equal(children[0].tag, 'video');
  assert.equal(children[0].src, url);
  assert.equal(children[0].controls, true);
  assert.equal(children[0].playsInline, true);
  await context.openVideo('https://mediaretriever.iaai.com.attacker.invalid/api/EngineVideoRetriever', 'video');
  assert.equal(children[1].tag, 'iframe', 'host suffix cannot masquerade as the recognized direct media endpoint');
});
