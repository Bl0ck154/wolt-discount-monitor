// Independent aggregate counter. Stores only date and city ID.
const ALLOWED_ORIGIN = "https://bl0ck154.github.io";
const CITIES_URL = "https://bl0ck154.github.io/wolt-discount-monitor/data/cities.json";
const responseJson = (body,status=200,origin="") => new Response(JSON.stringify(body),{
 status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
 ...(origin===ALLOWED_ORIGIN?{"Access-Control-Allow-Origin":ALLOWED_ORIGIN,
   "Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Vary":"Origin"}:{})}
});
async function cityExists(cityId){
 const res=await fetch(CITIES_URL,{cf:{cacheEverything:true,cacheTtl:1800}});
 if(!res.ok)throw new Error("Catalog unavailable");
 const data=await res.json();return data.cities?.some(c=>c.id===cityId)===true;
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(request.method==="GET"&&url.pathname==="/health")return responseJson({ok:true,service:"wolt-click-analytics"});
  const origin=request.headers.get("Origin")||"";
  if(origin!==ALLOWED_ORIGIN)return responseJson({ok:false},403);
  if(request.method==="OPTIONS")return responseJson({ok:true},200,origin);
  if(request.method!=="POST"||url.pathname!=="/api/click")return responseJson({ok:false},404,origin);
  if(!env.DB)return responseJson({ok:false},503,origin);
  let cityId;
  try{
   const raw=await request.text();
   if(raw.length>256)return responseJson({ok:false},413,origin);
   cityId=JSON.parse(raw)?.cityId;
  }catch{return responseJson({ok:false},400,origin);}
  if(typeof cityId!=="string"||!/^[a-z]{3}\/[a-z0-9-]{2,70}$/.test(cityId))return responseJson({ok:false},400,origin);
  try{
   if(!await cityExists(cityId))return responseJson({ok:false},400,origin);
   const day=new Date().toISOString().slice(0,10);
   const result=await env.DB.prepare(
     "INSERT INTO outbound_clicks(day,city_id,clicks) VALUES(?,?,1) "+
     "ON CONFLICT(day,city_id) DO UPDATE SET clicks=clicks+1"
   ).bind(day,cityId).run();
   return responseJson(result.meta?.changes===1?{ok:true}:{ok:false},
     result.meta?.changes===1?202:503,origin);
  }catch{return responseJson({ok:false},503,origin);}
 }
};
