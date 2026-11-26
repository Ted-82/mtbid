'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),{bind}=require('../public/rexbid-gallery-gestures.js');
function setup(t,{pointer=true}={}){
 const dom=new JSDOM('<div id="stage"><img></div>',{pretendToBeVisual:true});t.after(()=>dom.window.close());
 const win=dom.window,stage=win.document.getElementById('stage'),image=stage.querySelector('img');
 Object.defineProperty(win,'PointerEvent',{value:pointer?function(){}:undefined});
 for(const [target,key,value]of[[stage,'clientWidth',300],[stage,'clientHeight',400],[image,'offsetWidth',300],[image,'offsetHeight',400]])Object.defineProperty(target,key,{value});
 stage.getBoundingClientRect=()=>({left:0,top:0,width:300,height:400});
 const captures=new Set();stage.setPointerCapture=id=>captures.add(id);stage.releasePointerCapture=id=>captures.delete(id);
 let state={zoom:1,panX:0,panY:0},enabled=true;const nav=[],writes=[];
 const controller=bind({stage,image,win,active:()=>enabled,getState:()=>state,setState:next=>{state=next;writes.push(next);image.style.transform=`translate(${next.panX}px,${next.panY}px) scale(${next.zoom})`;},navigate:d=>nav.push(d)});
 function event(type,props={}){const e=new win.Event(type,{bubbles:true,cancelable:true});for(const [key,value]of Object.entries(props))Object.defineProperty(e,key,{value});stage.dispatchEvent(e);return e;}
 const p=(type,id,x,y,time=0,extra={})=>event('pointer'+type,{pointerId:id,clientX:x,clientY:y,timeStamp:time,pointerType:'touch',button:0,...extra});
 const touch=(type,touches,time=0)=>event('touch'+type,{timeStamp:time,changedTouches:touches.map(([identifier,clientX,clientY])=>({identifier,clientX,clientY}))});
 return {stage,image,win,controller,p,touch,event,nav,writes,captures,get state(){return state;},set state(s){state=s;},disable(){enabled=false;}};
}
test('one-finger horizontal swipes change photos in either direction',t=>{
 const g=setup(t);g.p('down',1,250,200,1);g.p('move',1,80,210,100);g.p('up',1,80,210,150);g.p('down',2,40,200,200);g.p('up',2,160,202,350);
 assert.deepEqual(g.nav,[1,-1]);assert.equal(g.captures.size,0);
});
test('short, vertical and slow gestures do not accidentally change photos',t=>{
 const g=setup(t);for(const [x,y,duration]of[[130,200,100],[100,50,100],[10,200,1000]]){g.p('down',1,150,200,1);g.p('up',1,x,y,duration);}assert.deepEqual(g.nav,[]);
});
test('pinch zooms around its midpoint and moves the enlarged image',t=>{
 const g=setup(t);g.p('down',1,100,200);g.p('down',2,200,200);g.p('move',1,50,200);g.p('move',2,250,200);
 assert.deepEqual(g.state,{zoom:2,panX:0,panY:0});
 g.p('move',1,75,220);g.p('move',2,275,220);assert.deepEqual(g.state,{zoom:2,panX:25,panY:20});
 g.p('up',1,75,220,100);g.p('up',2,275,220,120);assert.deepEqual(g.nav,[]);
});
test('pinch limits fit to 5x and shrinking restores centered image',t=>{
 const g=setup(t);g.p('down',1,140,200);g.p('down',2,160,200);g.p('move',1,0,200);g.p('move',2,300,200);assert.equal(g.state.zoom,5);
 g.p('move',1,149,200);g.p('move',2,151,200);assert.deepEqual(g.state,{zoom:1,panX:0,panY:0});
});
test('lifting one finger after pinch rebases panning without a jump or photo swipe',t=>{
 const g=setup(t);g.p('down',1,100,200);g.p('down',2,200,200);g.p('move',1,50,200);g.p('move',2,250,200);g.p('up',1,50,200,100);g.p('move',2,260,215,120);
 assert.deepEqual(g.state,{zoom:2,panX:10,panY:15});g.p('up',2,280,215,150);assert.deepEqual(g.nav,[]);
});
test('double tap toggles zoom, a single tap leaves the image unchanged',t=>{
 const g=setup(t);g.p('down',1,150,200,1);g.p('up',1,150,200,50);assert.equal(g.state.zoom,1);g.p('down',1,150,200,150);g.p('up',1,150,200,200);assert.equal(g.state.zoom,2.5);
 g.p('down',1,150,200,500);g.p('up',1,150,200,550);g.p('down',1,150,200,650);g.p('up',1,150,200,700);assert.deepEqual(g.state,{zoom:1,panX:0,panY:0});
});
test('panning is bounded and cannot swipe to another photo while zoomed',t=>{
 const g=setup(t);g.state={zoom:2,panX:0,panY:0};g.p('down',1,150,200);g.p('move',1,1500,-500,100);assert.deepEqual(g.state,{zoom:2,panX:150,panY:-200});g.p('up',1,1500,-500,200);assert.deepEqual(g.nav,[]);
});
test('cancellation and lost capture clear gestures and cannot navigate',t=>{
 const g=setup(t);for(const type of['cancel','lostpointercapture']){g.p('down',1,250,200);g.p('move',1,20,200);if(type==='cancel')g.p(type,1,20,200);else g.event(type,{pointerId:1});g.p('up',1,20,200,100);assert.deepEqual(g.nav,[]);assert.equal(g.captures.size,0);}
});
test('closing, resize and focus loss reset pending taps or active gestures',t=>{
 const g=setup(t);g.p('down',1,200,200);g.controller.reset();g.p('up',1,20,200,100);assert.deepEqual(g.nav,[]);
 g.state={zoom:2,panX:999,panY:999};g.win.dispatchEvent(new g.win.Event('resize'));assert.deepEqual(g.state,{zoom:2,panX:150,panY:200});
 g.p('down',1,200,200);g.win.dispatchEvent(new g.win.Event('blur'));assert.equal(g.captures.size,0);
});
test('inactive gallery and secondary mouse buttons do not consume page gestures',t=>{
 const g=setup(t);assert.equal(g.p('down',1,150,200,0,{pointerType:'mouse',button:2}).defaultPrevented,false);g.disable();assert.equal(g.p('down',1,150,200).defaultPrevented,false);assert.equal(g.captures.size,0);
});
test('Touch Events fallback supports Safari pinch, pan and swipe without duplicate Pointer Events',t=>{
 const g=setup(t,{pointer:false});assert.equal(g.touch('start',[[1,100,200],[2,200,200]]).defaultPrevented,true);g.touch('move',[[1,50,200],[2,250,200]],100);assert.equal(g.state.zoom,2);
 g.touch('end',[[1,50,200],[2,250,200]],200);assert.deepEqual(g.nav,[]);g.state={zoom:1,panX:0,panY:0};g.touch('start',[[1,250,200]],300);g.touch('end',[[1,10,200]],400);assert.deepEqual(g.nav,[1]);
});
test('touch cancellation and native Safari gesture are handled only inside active gallery',t=>{
 const g=setup(t,{pointer:false});g.touch('start',[[1,250,200]]);g.touch('cancel',[[1,20,200]]);g.touch('end',[[1,20,200]],100);assert.deepEqual(g.nav,[]);
 assert.equal(g.event('gesturestart').defaultPrevented,true);g.disable();assert.equal(g.event('gesturestart').defaultPrevented,false);
});
test('real gallery wires tested gestures before startup and preserves accessible controls',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../public/car.html'),'utf8');assert.ok(html.indexOf('/rexbid-gallery-gestures.js?')<html.indexOf('let galleryGestures'));
 assert.match(html,/galleryGestures = window.RexBidGalleryGestures\?\.bind/);assert.match(html,/galleryGestures\?\.reset\(\)/);assert.match(html,/-webkit-touch-callout:none/);
 for(const label of['Pomniejsz zdjęcie','Powiększ zdjęcie','Dopasuj zdjęcie','Zamknij galerię'])assert.ok(html.includes('aria-label="'+label+'"'));
 assert.ok(html.includes('draggable="false"'));assert.ok(!html.includes('user-scalable=no'));
});
