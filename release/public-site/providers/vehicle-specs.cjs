'use strict';
// Public vehicle specifications only; no customer data or paid provider requests.
const PREFIX='https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/';
const TTL=30*86400, inflight=new Map();
const number=value=>typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value)?Number(value):null;
function normalize(data,vin,year){
 const row=data?.Results?.length===1?data.Results[0]:null;
 if(!row||row.VIN?.toUpperCase()!==vin||row.ErrorCode!=='0'||String(row.ModelYear)!==year||!row.Make)throw Error('identity');
 const cc=number(row.DisplacementCC), litres=number(row.DisplacementL);
 const engineCc=cc>0&&cc<=15000?Math.round(cc):litres>0&&litres<=15?Math.round(litres*1000):null;
 const level=String(row.ElectrificationLevel||''), fuel=String(row.FuelTypePrimary||'');
 const powertrain=/plug.in|PHEV/i.test(level)?'PHEV':/\bHEV\b|hybrid/i.test(level)?'HEV':/\bBEV\b|battery electric/i.test(level)?'BEV':/fuel cell|FCEV/i.test(level)?'FCEV':/not applicable|^$/.test(level)&&/^(Gasoline|Diesel|Flexible Fuel Vehicle)/i.test(fuel)&&!row.FuelTypeSecondary?'ICE':null;
 return {ok:true,vin,year:Number(year),make:row.Make,model:row.Model||null,engineCc,powertrain,source:'NHTSA vPIC',sourceUrl:'https://vpic.nhtsa.dot.gov/decoder/',checkedAt:new Date().toISOString()};
}
async function readJson(res){
 const reader=res.body?.getReader();if(!reader)throw Error('empty');let size=0,chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw Error('large');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
function reply(body,status=200,ttl=0){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':ttl?'public, max-age='+ttl:'no-store'}});}
async function vehicleSpecsResponse(request,{fetchImpl=fetch,cache=globalThis.caches?.default,timeoutMs=6000}={}){
 if(request.method!=='GET')return reply({ok:false,error:'method_not_allowed'},405);
 const url=new URL(request.url),vin=(url.searchParams.get('vin')||'').trim().toUpperCase(),year=url.searchParams.get('year')||'';
 if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)||!/^\d{4}$/.test(year)||+year<1981||+year>new Date().getUTCFullYear()+2)return reply({ok:false,error:'invalid_vehicle'},400);
 const key=new Request(url.origin+'/api/vehicle-specs?'+new URLSearchParams({vin,year}));
 try{const hit=await cache?.match(key);if(hit)return hit;}catch{}
 const id=vin+':'+year;
 if(inflight.has(id)){try{return (await inflight.get(id)).clone();}catch{return reply({ok:false,error:'specs_unavailable'},503);}}
 const task=(async()=>{
  const controller=new AbortController();let timer;
  try{
   const result=await Promise.race([(async()=>{
    const res=await fetchImpl(PREFIX+vin+'?format=json&modelyear='+year,{headers:{Accept:'application/json'},redirect:'manual',signal:controller.signal});
    if(res.status!==200)throw Error('upstream');return normalize(await readJson(res),vin,year);
   })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('timeout'));},timeoutMs);})]);
   const response=reply(result,200,TTL);try{await cache?.put(key,response.clone());}catch{}return response;
  }catch{return reply({ok:false,error:'specs_unavailable'},503);}finally{clearTimeout(timer);}
 })();
 if(inflight.size<128)inflight.set(id,task);
 try{return (await task).clone();}finally{if(inflight.get(id)===task)inflight.delete(id);}
}
module.exports={vehicleSpecsResponse,normalize};
