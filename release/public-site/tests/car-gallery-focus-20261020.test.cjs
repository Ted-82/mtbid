const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function galleryRuntime(photos = Array.from({length: 3}, (_, index) => ({
  thumb: `https://cdn.example/thumb-${index}.jpg`,
  large: `https://cdn.example/full-${index}.jpg`
}))) {
  const html = fs.readFileSync(path.join(__dirname, '../public/car.html'), 'utf8');
  const slice = (start, end) => {
    const from = html.indexOf(start), to = html.indexOf(end, from);
    assert.ok(from >= 0 && to > from, 'production gallery code is present');
    return html.slice(from, to);
  };
  const document = {};
  const element = (attributes = {}) => {
    const classes = new Set((attributes.class || '').split(/\s+/).filter(Boolean));
    return {
      attributes: {...attributes}, hidden: false, style: {}, handlers: {}, connected: true,
      focusCalls: [], textContent: '',
      classList: {add: value => classes.add(value), remove: value => classes.delete(value),
        contains: value => classes.has(value)},
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return this.attributes[name] ?? null; },
      addEventListener(type, callback) { this.handlers[type] = callback; },
      focus(options) {
        if (this.connected) {
          document.activeElement = this;
          this.focusCalls.push(options);
        }
      },
      click() { this.handlers.click?.({target: this}); },
      activateWithKeyboard(key) {
        assert.ok(['Enter', ' '].includes(key));
        assert.equal(document.activeElement, this, 'keyboard activation starts at the focused button');
        // A native button emits click for Enter/Space; dispatch that click without
        // moving focus. Removing that element must reset focus to body below.
        this.click();
      }
    };
  };
  const image = source => {
    const node = element(source ? {src: source} : {});
    Object.assign(node, {complete: false, naturalWidth: 0, sourceWrites: []});
    Object.defineProperty(node, 'src', {
      get() { return this.getAttribute('src'); },
      set(value) {
        this.setAttribute('src', value);
        this.sourceWrites.push(value);
        this.complete = false;
      }
    });
    return node;
  };
  document.body = element();
  document.activeElement = document.body;
  const thumbs = element();
  thumbs.buttons = [];
  thumbs.querySelectorAll = () => thumbs.buttons;
  Object.defineProperty(thumbs, 'innerHTML', {
    get() { return this.html || ''; },
    set(value) {
      if (this.buttons.includes(document.activeElement)) document.activeElement = document.body;
      for (const button of this.buttons) button.connected = false;
      this.html = value;
      this.buttons = Array.from(value.matchAll(/<button class="([^"]+)" data-i="(\d+)"[^>]*aria-pressed="([^"]+)"[^>]*>\s*<img src="([^"]+)"/g), match => {
        const button = element({class: match[1], 'aria-pressed': match[3]});
        button.dataset = {i: match[2]};
        button.image = image(match[4]);
        button.unavailable = element();
        button.unavailable.hidden = true;
        button.querySelector = selector => selector === 'img' ? button.image : button.unavailable;
        return button;
      });
    }
  });
  const elements = {thumbs};
  for (const id of ['photoCount', 'openHd', 'prevPhoto', 'nextPhoto', 'mainImageUnavailable',
    'lightbox', 'lbImageUnavailable', 'lbInfo', 'lbClose', 'lbMinus', 'lbPlus', 'lbReset',
    'lbPrev', 'lbNext']) elements[id] = element();
  elements.mainImage = image();
  elements.lbImage = image();
  document.getElementById = id => elements[id];
  const context = {photos, photoIndex: 0, zoom: 1, panX: 0, panY: 0, galleryGestures:null, document, elements,
    esc: value => String(value), getTitle: () => 'Synthetic vehicle'};
  vm.runInNewContext([
    slice('  function setGalleryImage(', '\n  function bindPageEvents('),
    slice('  function openLightbox()', '\n  async function openViewer('),
    slice('    document.getElementById("prevPhoto")?.addEventListener', '    document.getElementById("openVideo")?.addEventListener'),
    slice('  document.getElementById("lbClose").addEventListener', '  document.getElementById("viewerClose").addEventListener')
  ].join('\n'), context);
  context.renderPhotos();
  return context;
}

test('Enter and Space activation preserve the loaded thumbnail and its keyboard focus without rebuilding', () => {
  for (const key of ['Enter', ' ']) {
    const context = galleryRuntime();
    const {elements, document} = context;
    const oldButton = elements.thumbs.buttons[1];
    oldButton.focus();
    oldButton.activateWithKeyboard(key);
    const selected = elements.thumbs.buttons[1];
    assert.equal(selected, oldButton, 'navigation reuses the loaded thumbnail DOM');
    assert.equal(oldButton.connected, true);
    assert.equal(document.activeElement, selected);
    assert.equal(selected.focusCalls.length, 1);
    assert.equal(selected.focusCalls.length, 1, 'selection does not refocus the thumbnail');
    assert.equal(context.photoIndex, 1);
    assert.equal(elements.mainImage.src, context.photos[1].large);
    assert.equal(selected.getAttribute('aria-pressed'), 'true');
    assert.equal(selected.classList.contains('active'), true);
    assert.equal(elements.thumbs.buttons[0].getAttribute('aria-pressed'), 'false');
    assert.equal(elements.thumbs.buttons[2].getAttribute('aria-pressed'), 'false');
    elements.thumbs.buttons[2].focus();
    elements.thumbs.buttons[2].activateWithKeyboard(key);
    assert.equal(document.activeElement, elements.thumbs.buttons[2], 'subsequent keyboard navigation remains usable');
  }
});

test('the actual focused thumbnail survives, even when another thumbnail is activated programmatically', () => {
  const context = galleryRuntime();
  const {elements, document} = context;
  elements.thumbs.buttons[2].focus();
  elements.thumbs.buttons[1].click();
  assert.equal(context.photoIndex, 1);
  assert.equal(document.activeElement, elements.thumbs.buttons[2]);
  assert.equal(elements.thumbs.buttons[2].getAttribute('aria-pressed'), 'false');
  assert.equal(elements.thumbs.buttons[1].getAttribute('aria-pressed'), 'true');
});

test('main previous and next controls retain focus, wrap correctly and do not focus a thumbnail', () => {
  const context = galleryRuntime();
  const {elements, document} = context;
  for (const [control, expectedIndex] of [[elements.prevPhoto, 2], [elements.nextPhoto, 0]]) {
    control.focus();
    control.activateWithKeyboard('Enter');
    assert.equal(context.photoIndex, expectedIndex);
    assert.equal(document.activeElement, control);
    assert.equal(elements.mainImage.src, context.photos[expectedIndex].large);
    assert.equal(elements.thumbs.buttons[expectedIndex].getAttribute('aria-pressed'), 'true');
    assert.equal(elements.thumbs.buttons.reduce((sum, button) => sum + button.focusCalls.length, 0), 0);
  }
});

test('lightbox next and previous keep modal focus, synchronize the gallery and close back to the opener', () => {
  const context = galleryRuntime();
  const {elements, document} = context;
  elements.thumbs.buttons[1].focus();
  elements.thumbs.buttons[1].activateWithKeyboard(' ');
  elements.openHd.focus();
  elements.openHd.activateWithKeyboard('Enter');
  assert.equal(document.activeElement, elements.lbClose);
  assert.equal(elements.lightbox.classList.contains('open'), true);
  assert.equal(elements.lbImage.src, context.photos[1].large);
  for (const [control, expectedIndex] of [[elements.lbNext, 2], [elements.lbPrev, 1]]) {
    control.focus();
    control.activateWithKeyboard('Enter');
    assert.equal(context.photoIndex, expectedIndex);
    assert.equal(document.activeElement, control, 'background thumbnail rebuilding must not steal modal focus');
    assert.equal(elements.lbImage.src, context.photos[expectedIndex].large);
    assert.equal(elements.mainImage.src, context.photos[expectedIndex].large);
    assert.equal(elements.thumbs.buttons[expectedIndex].getAttribute('aria-pressed'), 'true');
  }
  elements.lbClose.focus();
  elements.lbClose.activateWithKeyboard(' ');
  assert.equal(elements.lightbox.classList.contains('open'), false);
  assert.equal(document.activeElement, elements.openHd);
});

test('an empty or single-image gallery does not introduce extra focus movement', () => {
  const empty = galleryRuntime([]);
  assert.equal(empty.document.activeElement, empty.document.body);
  assert.equal(empty.elements.thumbs.buttons.length, 0);
  assert.equal(empty.elements.openHd.hidden, true);
  const context = galleryRuntime([{large: 'https://cdn.example/one.jpg'}]);
  const {elements, document} = context;
  assert.equal(elements.prevPhoto.hidden, true);
  assert.equal(elements.nextPhoto.hidden, true);
  elements.thumbs.buttons[0].focus();
  elements.thumbs.buttons[0].activateWithKeyboard('Enter');
  assert.equal(document.activeElement, elements.thumbs.buttons[0]);
  assert.equal(elements.mainImage.src, context.photos[0].large);
});
