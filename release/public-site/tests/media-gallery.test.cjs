const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {isHttpUrl, normalizeMedia, canEmbed360, isViewer360Url, isIaaiVideoUrl} = require('../public/rexbid-media.js');

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
  const button = () => ({hidden: false, handlers: {}, classList:{add(){},remove(){}}, setAttribute(){}, addEventListener(type, handler) { this.handlers[type] = handler; }});
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
  const mediaScript = html.indexOf('<script src="/rexbid-media.js?v=4"></script>');
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

test('an open vehicle page picks up newly published photos on its usual refresh', async () => {
  const {JSDOM}=require('jsdom');
  const vm=require('node:vm');
  const html=fs.readFileSync(path.join(__dirname,'../public/car.html'),'utf8');
  const block=html.slice(html.indexOf('  function showNewGallery('),html.indexOf('  /* AUCTION HISTORY'));
  const old={platform:'copart',lot_number:'101',vin:'VIN1',media:{items:[]}};
  const photo={large:'https://example.org/a.jpg',thumb:'https://example.org/b.jpg'};
  const dom=new JSDOM('<div class="gallery gallery-empty"><img id="mainImage"><div class="gallery-badges"></div><a id="missingGallerySource"></a><button id="openHd"></button></div><span id="detailPhotoCount"></span>',{pretendToBeVisual:true});
  const {document}=dom.window;
  const state={document,car:old,photos:[],photoIndex:0,fetchVehicle:async()=>({...old,media:{items:[photo]}}),
    normalizeVehicleMedia:fresh=>fresh.media.items,auctionRefreshInFlight:false,auctionRefreshLastAt:0,
    getAuctionBid:()=>0,updateAuctionUi(){},saveAuctionSnapshot(){},renderPhotos(){},console};
  vm.createContext(state);
  vm.runInContext(block,state);
  await state.refreshAuctionData();
  assert.equal(state.photos[0],photo);
  assert.equal(document.querySelector('.gallery-empty, #missingGallerySource'),null);
  assert.equal(document.querySelector('.gallery-badge').textContent,'HD');
  assert.equal(document.getElementById('detailPhotoCount').textContent,'Zdjęcia: 1');
  state.showNewGallery(old,{...old,media:{items:[]}});
  assert.equal(state.photos[0],photo);
  state.photos=[];
  for(const other of [{platform:'iaai'},{lot_number:'102'},{vin:'VIN2'}]){
    state.showNewGallery(old,{...old,...other,media:{items:[photo]}});
    assert.equal(state.photos.length,0);
  }
  dom.window.close();
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

test('IAAI video and 360 endpoints remain separate from the photo gallery', () => {
  const photo = 'https://vis.iaai.com/resizer?imageKeys=full-example';
  const thumb = 'https://vis.iaai.com/resizer?imageKeys=thumbnail-example';
  const video = 'https://mediaretriever.iaai.com/api/EngineVideoRetriever?partitionKey=example';
  const viewer = 'https://vis.iaai.com/Home/ThreeSixtyView?itemId=example';
  const vehicle={media:{items:[{large:viewer,url:photo},video,viewer,'https://cdn.example/lot.mp4?size=large'],
    thumbs:[thumb,video,viewer]}};
  assert.deepEqual(normalizeMedia(vehicle),[{type:'image',large:photo,thumb}]);
  assert.equal(isHttpUrl(video),true);
  assert.equal(isHttpUrl(viewer),true);
  assert.equal(vehicle.media.items[1],video);
  assert.equal(vehicle.media.items[2],viewer);
});

test('extensionless IAAI inspection video is never included as a gallery image',()=>{
  const url='https://mediastorageaccountprod.blob.core.windows.net/media/example_VES-1_2';
  const photo='https://vis.iaai.com/resizer?imageKeys=opaque';
  assert.ok(isIaaiVideoUrl(url));
  assert.deepEqual(normalizeMedia({media:{items:[photo,url]}}),[{type:'image',large:photo,thumb:photo}]);
  assert.equal(isIaaiVideoUrl('https://mediastorageaccountprod.blob.core.windows.net.invalid/media/example_VES-1_2'),false);
});

test('only the verified IAAI endpoint embeds and a lot number in a photo URL is no viewer',()=>{
  const viewer='https://vis.iaai.com/Home/ThreeSixtyView?itemId=example';
  assert.ok(canEmbed360(viewer));
  assert.ok(isViewer360Url(viewer));
  assert.equal(canEmbed360('https://vis.iaai.com.other.invalid/Home/ThreeSixtyView'),false);
  assert.equal(canEmbed360('https://vis.iaai.com/Home/ThreeSixtyViewCopy'),false);
  assert.equal(canEmbed360('https://vis.iaai.com:444/Home/ThreeSixtyView'),false);
  assert.equal(isViewer360Url('https://vis.iaai.com/resizer?imageKeys=036088'),false);
});

test('embedded 360 has a direct source link and an isolated frame', async()=>{
  const vm=require('node:vm');
  const html=fs.readFileSync(path.join(__dirname,'../public/car.html'),'utf8');
  const source=html.slice(html.indexOf('  async function openViewer('), html.indexOf('  async function closeViewer('));
  const children=[];
  const content={innerHTML:'',appendChild(node){children.push(node);}};
  const modal={classList:{add(){}},setAttribute(){}};
  const context={window:{RexBidMedia:{canEmbed360}},document:{
    getElementById(id){return id==='viewerContent'?content:modal;},
    createElement(tag){return {tag,style:{},setAttribute(key,value){this[key]=value;}};},
    body:{classList:{add(){}}}
  }};
  vm.runInNewContext(source+';globalThis.open=openViewer;',context);
  const viewer='https://vis.iaai.com/Home/ThreeSixtyView?itemId=example';
  await context.open(viewer,'360');
  assert.equal(children[0].src,viewer);
  assert.equal(children[0].sandbox,'allow-scripts allow-same-origin');
  assert.equal(children[1].href,viewer);
  assert.equal(children[1].target,'_blank');
  assert.equal(children[1].rel,'noopener noreferrer');
  await context.open('https://other.invalid/ThreeSixtyView','360');
  assert.equal(children.length,2);
});

test('car gallery hides dead lightbox and navigation controls when media is absent', () => {
  const context = galleryRuntime();
  const {elements} = context;
  context.renderPhotos();
  assert.equal(elements.mainImage.style.display, 'none');
  assert.equal(elements.photoCount.textContent, 'Brak zdjęć w danych aukcji');
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
  const context = { window:{RexBidMedia:{isIaaiVideoUrl}}, document: {
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
  await context.openVideo('https://mediastorageaccountprod.blob.core.windows.net/media/example_VES-1_2','video');
  assert.equal(children[2].tag,'video');
});
