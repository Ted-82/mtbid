'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),html=fs.readFileSync(require.resolve('../public/car.html'),'utf8');
const from=html.indexOf('  async function fetchVehicle()'),through=html.indexOf('  function collectObjects(',from);assert.ok(from>0&&through>from);
function runtime(fetchImpl){let deadline,cleared=0;const c={LOT:'74863846',VIN:'',PLATFORM:'copart',API_BASE:'/api',AbortController,fetch:fetchImpl,unwrapResult:body=>body.data,setTimeout(fn,ms){assert.equal(ms,15000);deadline=fn;return 1;},clearTimeout(id){assert.equal(id,1);cleared++;}};vm.createContext(c);vm.runInContext(html.slice(from,through)+';globalThis.run=fetchVehicle;',c);return{run:c.run,deadline:()=>deadline(),cleared:()=>cleared};}
test('public vehicle read omits cookies and clears its body deadline after success',async()=>{
 let calls=0;const r=runtime(async(url,options)=>{calls++;assert.equal(url,'/api/car/74863846?platform=copart');assert.equal(options.credentials,'omit');assert.ok(options.signal);return{ok:true,text:async()=>JSON.stringify({data:{lot_number:'74863846'}})};});assert.equal((await r.run()).lot_number,'74863846');assert.equal(calls,1);assert.equal(r.cleared(),1);
});
test('vehicle deadline aborts a stalled body without a duplicate list/provider fallback',async()=>{
 let calls=0,signal;const r=runtime(async(_url,options)=>{calls++;signal=options.signal;return{ok:true,text:()=>new Promise((_yes,no)=>signal.addEventListener('abort',()=>no(Object.assign(Error('Deadline'),{name:'AbortError'}))))};});
 const pending=r.run();await new Promise(resolve=>setImmediate(resolve));assert.equal(r.cleared(),0);r.deadline();await assert.rejects(pending,/Deadline/);assert.equal(signal.aborted,true);assert.equal(calls,1);assert.equal(r.cleared(),1);
});
test('vehicle hero image is eager and high priority; private account transport remains separate',()=>{
 const dom=new JSDOM('<body>'+html.slice(html.indexOf('<img id="mainImage"'),html.indexOf('<img id="mainImage"')+400)+'</body>'),img=dom.window.document.getElementById('mainImage');assert.equal(img.getAttribute('loading'),'eager');assert.equal(img.getAttribute('fetchpriority'),'high');assert.equal(img.getAttribute('decoding'),'async');dom.window.close();
 const auth=fs.readFileSync(require.resolve('../public/rexbid-auth.js'),'utf8');assert.match(auth,/credentials:\s*["']same-origin["']/);assert.match(auth,/cache:\s*["']no-store["']/);
});

test('the car request starts before calculator scripts and a failed early request can be retried', async t => {
  const dom = new JSDOM(html, {
    url: 'https://rexbid.pl/car?lot=74863846&platform=copart',
    runScripts: 'outside-only'
  });
  t.after(() => dom.window.close());
  const requests = [];
  dom.window.fetch = async (url, options) => {
    requests.push({ url, credentials: options.credentials });
    throw new Error('Fixture network failure');
  };
  const { document } = dom.window;
  const scripts = [...document.scripts];
  const early = scripts.find(script => script.textContent.includes('const initialVehicleRequest'));
  const calculator = scripts.find(script => script.getAttribute('src') === '/rexbid-calculator-v4-rates.js');
  const main = scripts.find(script => script.textContent.includes('init(initialVehicleRequest)'));
  assert.ok(early && calculator && main);
  assert.ok(scripts.indexOf(early) < scripts.indexOf(calculator));

  const context = dom.getInternalVMContext();
  vm.runInContext(early.textContent, context);
  assert.deepEqual(requests, [{ url: '/api/car/74863846?platform=copart', credentials: 'omit' }]);
  await new Promise(resolve => setImmediate(resolve));

  dom.window.console.error = () => {};
  vm.runInContext(main.textContent, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  const retry = document.getElementById('retryVehicleLoad');
  assert.ok(retry);
  retry.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0]);
});
