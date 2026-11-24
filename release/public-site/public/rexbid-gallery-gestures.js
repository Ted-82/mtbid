(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RexBidGalleryGestures=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  // Gestures affect this image only. Browser/page zoom remains available outside
  // the gallery. No image URLs, network reads or persisted state are involved.
  function bind({stage,image,active,getState,setState,navigate,win=window}){
    const points=new Map();
    let origin=null,pinch=null,multiple=false,maxTravel=0,lastTap=null;
    const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
    const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
    const prevent=e=>{if(e.cancelable)e.preventDefault();};
    const point=e=>({x:e.clientX,y:e.clientY});
    function clamp(next){
      const zoom=Math.max(1,Math.min(5,next.zoom));
      const x=Math.max(0,((image.offsetWidth||stage.clientWidth)*zoom-stage.clientWidth)/2);
      const y=Math.max(0,((image.offsetHeight||stage.clientHeight)*zoom-stage.clientHeight)/2);
      return {zoom,panX:zoom===1?0:Math.max(-x,Math.min(x,next.panX)),panY:zoom===1?0:Math.max(-y,Math.min(y,next.panY))};
    }
    const apply=next=>setState(clamp(next));
    function reset(){
      const ids=[...points.keys()];points.clear();origin=null;pinch=null;multiple=false;maxTravel=0;lastTap=null;
      image.classList.remove('dragging');
      for(const id of ids)try{stage.releasePointerCapture?.(id);}catch(_){}
    }
    function base(now){
      const p=[...points.values()];
      if(p.length>=2){
        multiple=true;lastTap=null;
        pinch={mid:midpoint(p[0],p[1]),distance:Math.max(1,distance(p[0],p[1])),...getState()};
      }else if(p.length===1){origin={...p[0],time:now,...getState()};pinch=null;}
      image.classList.toggle('dragging',p.length>0&&getState().zoom>1);
    }
    function down(id,p,now){
      if(!points.size){multiple=false;maxTravel=0;}
      points.set(id,p);base(now);
    }
    function move(id,p){
      if(!points.has(id))return;
      points.set(id,p);const list=[...points.values()];
      if(list.length>=2&&pinch){
        const mid=midpoint(list[0],list[1]),zoom=Math.max(1,Math.min(5,pinch.zoom*distance(list[0],list[1])/pinch.distance));
        const box=stage.getBoundingClientRect(),cx=box.left+box.width/2,cy=box.top+box.height/2,ratio=zoom/pinch.zoom;
        apply({zoom,panX:mid.x-cx-(pinch.mid.x-cx-pinch.panX)*ratio,panY:mid.y-cy-(pinch.mid.y-cy-pinch.panY)*ratio});
      }else if(origin){
        maxTravel=Math.max(maxTravel,distance(origin,p));
        if(origin.zoom>1)apply({zoom:origin.zoom,panX:origin.panX+p.x-origin.x,panY:origin.panY+p.y-origin.y});
      }
    }
    function up(id,p,now){
      if(!points.has(id))return;
      move(id,p);const single=points.size===1,wasMultiple=multiple,start=origin;
      points.delete(id);
      if(points.size){base(now);return;}
      image.classList.remove('dragging');origin=null;pinch=null;multiple=false;
      if(!single||wasMultiple||!start)return;
      const dx=p.x-start.x,dy=p.y-start.y,elapsed=now-start.time;
      if(start.zoom<=1&&Math.abs(dx)>=48&&Math.abs(dx)>Math.abs(dy)*1.25&&elapsed<900){lastTap=null;navigate(dx<0?1:-1);return;}
      if(maxTravel<=12&&elapsed<300){
        if(lastTap&&now-lastTap.time<330&&distance(p,lastTap)<28){
          const state=getState(),box=stage.getBoundingClientRect(),zoom=state.zoom>1?1:2.5,ratio=zoom/state.zoom;
          apply({zoom,panX:(p.x-box.left-box.width/2)*(1-ratio)+state.panX*ratio,panY:(p.y-box.top-box.height/2)*(1-ratio)+state.panY*ratio});lastTap=null;
        }else lastTap={...p,time:now};
      }else lastTap=null;
    }
    if(win.PointerEvent){
      stage.addEventListener('pointerdown',e=>{
        if(!active()||(e.pointerType==='mouse'&&e.button!==0))return;
        prevent(e);down(e.pointerId,point(e),e.timeStamp);
        try{stage.setPointerCapture(e.pointerId);}catch(_){}
      });
      stage.addEventListener('pointermove',e=>{if(!active()||!points.has(e.pointerId))return;prevent(e);move(e.pointerId,point(e));});
      stage.addEventListener('pointerup',e=>{if(!points.has(e.pointerId))return;prevent(e);up(e.pointerId,point(e),e.timeStamp);try{stage.releasePointerCapture(e.pointerId);}catch(_){}});
      for(const type of ['pointercancel','lostpointercapture'])stage.addEventListener(type,e=>{if(points.has(e.pointerId))reset();});
    }else{
      // Safari versions without Pointer Events use the same state machine.
      stage.addEventListener('touchstart',e=>{if(!active())return;prevent(e);for(const t of e.changedTouches)down(t.identifier,point(t),e.timeStamp);},{passive:false});
      stage.addEventListener('touchmove',e=>{if(!active())return;prevent(e);for(const t of e.changedTouches)move(t.identifier,point(t));},{passive:false});
      stage.addEventListener('touchend',e=>{if(!active())return;prevent(e);for(const t of e.changedTouches)up(t.identifier,point(t),e.timeStamp);},{passive:false});
      stage.addEventListener('touchcancel',reset);
    }
    for(const type of ['gesturestart','gesturechange','gestureend'])stage.addEventListener(type,e=>{if(active())prevent(e);},{passive:false});
    image.addEventListener('dragstart',prevent);
    win.addEventListener('blur',reset);
    win.addEventListener('resize',()=>{reset();apply(getState());});
    return {reset,clamp};
  }
  return {bind};
});
