const test = require("node:test");
const assert = require("node:assert/strict");
const navigation = require("../public/rexbid-car-navigation.js");

test("vehicle return path preserves local catalog filters while rejecting external and ambiguous destinations", () => {
  assert.equal(navigation.safeLocalReturnPath("/?catalog=1&make=BMW&year_from=2020&cursor=abc#results"), "/?catalog=1&make=BMW&year_from=2020#results");
  assert.equal(navigation.safeLocalReturnPath("/index.html?catalog=1&category=buy-now"), "/index.html?catalog=1&category=buy-now#results");
  for (const invalid of [null, "", "/", "https://evil.example/?catalog=1", "//evil.example/?catalog=1", "/\\evil.example/?catalog=1", "/kontakt.html?catalog=1", "/?catalog=1&catalog=0", "/?catalog=0", "/?catalog=1&make=%0D%0Afoo", "/?catalog=1&make=" + "x".repeat(1001)])
    assert.equal(navigation.safeLocalReturnPath(invalid), "/?catalog=1#results", String(invalid));
});

test("calculator is moved below vehicle identity/details and above shipping as the same single DOM panel", () => {
  const panel = { id: "importCalculator" };
  let inserted = null;
  const documentRef = {
    getElementById(id) { return id === "importCalculator" ? panel : null; },
    querySelector(selector) {
      assert.equal(selector, ".primary-auction > #vehicleKeyDetails");
      return { after(node) { inserted = node; } };
    }
  };

  assert.equal(navigation.placeCalculatorAfterVehicleDetails(documentRef), true);
  assert.equal(inserted, panel);
});

test("calculator link click pushes the fragment and scrolls the rendered panel to the top", () => {
  const options = [];
  const frames = [];
  let clickHandler;
  let prevented = false;
  const target = { scrollIntoView(value) { options.push(value); } };
  const link = {};
  const documentRef = {
    addEventListener(type, callback) { assert.equal(type, "click"); clickHandler = callback; },
    getElementById(id) { return id === "importCalculator" ? target : null; }
  };
  const windowRef = {
    location: { hash: "" },
    history: { pushState(_state, _title, hash) { windowRef.location.hash = hash; } },
    requestAnimationFrame(callback) { frames.push(callback); }
  };
  navigation.bindCalculatorNavigation(documentRef, windowRef);

  clickHandler({
    target: { closest(selector) { assert.equal(selector, 'a[href="#importCalculator"]'); return link; } },
    preventDefault() { prevented = true; }
  });

  assert.equal(prevented, true);
  assert.equal(windowRef.location.hash, "#importCalculator");
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.deepEqual(options, [{ behavior: "smooth", block: "start", inline: "nearest" }]);
});

test("initial calculator fragment is restored only after async page layout", () => {
  const options = [];
  const frames = [];
  const documentRef = { getElementById: () => ({ scrollIntoView: value => options.push(value) }) };
  const windowRef = {
    location: { hash: "#importCalculator" },
    requestAnimationFrame(callback) { frames.push(callback); }
  };

  assert.equal(navigation.restoreCalculatorHash(documentRef, windowRef), true);
  assert.equal(frames.length, 1);
  frames.shift()();
  frames.shift()();
  assert.equal(options.length, 1);
  assert.equal(options[0].block, "start");
  windowRef.location.hash = "#details";
  assert.equal(navigation.restoreCalculatorHash(documentRef, windowRef), false);
});
