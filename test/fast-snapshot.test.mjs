import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/wolt-city-refresh/worker.mjs";

const origin = "https://bl0ck154.github.io";
const endpoint = "https://example.test/api/snapshot?cityId=deu%2Ferlangen";
const requestedAt = Date.parse("2026-11-02T10:00:00Z");

function mockDB(timestamp = requestedAt) {
 return { prepare(sql) {
  assert.match(sql, /FROM city_jobs WHERE city_id=\?/);
  return { bind(cityId) { assert.equal(cityId,"deu/erlangen");
    return { async first() { return {requested_at:timestamp,dispatched_at:timestamp,dispatch_status:"dispatched"}; } }; } };
 } };
}
test("snapshot endpoint refuses visitors outside GitHub Pages and invalid cities",async()=>{
 const invalid = await worker.fetch(new Request(endpoint.replace("deu%2Ferlangen","xx%2Ffoo"),
  {headers:{Origin:origin}}),{DB:{},GITHUB_TOKEN:"test"});
 assert.equal(invalid.status,400);
 const denied = await worker.fetch(new Request(endpoint,{headers:{Origin:"https://other.example"}}),{});
 assert.equal(denied.status,403);
});
test("latest committed GitHub JSON is available before Pages deployment",async()=>{
 const original = globalThis.fetch;
 const snapshot={city:{id:"deu/erlangen"},generatedAt:"2026-11-02T10:00:40Z",
  venues:[{name:"Avenue",offers:[{text:"20% off"}]}]};
 globalThis.fetch=async(url,opts)=>{
  assert.match(url,/api.github.com\/repos\/Bl0ck154\/wolt-discount-monitor\/contents\/docs\/data\/cities\/deu-erlangen\/latest.json/);
  assert.equal(opts.headers.Accept,"application/vnd.github.raw+json");
  return new Response(JSON.stringify(snapshot),{status:200,headers:{"Content-Type":"application/json"}});
 };
 const now=Date.now;
 Date.now=()=>Date.parse("2026-11-02T10:01:00Z");
 try {
  const response=await worker.fetch(new Request(endpoint,{headers:{Origin:origin}}),{
    DB:mockDB(),GITHUB_TOKEN:"test"});
  assert.equal(response.status,200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"),origin);
  assert.deepEqual(await response.json(),snapshot);
 } finally {globalThis.fetch=original;Date.now=now;}
});
test("a city can wait in queue for hours and still use the fast endpoint after dispatch",async()=>{
 const realFetch=globalThis.fetch;
 const realNow=Date.now;
 Date.now=()=>Date.parse("2026-11-02T13:01:00Z");
 globalThis.fetch=async()=>new Response(JSON.stringify({city:{id:"deu/erlangen"},
  generatedAt:"2026-11-02T13:00:50Z",venues:[{name:"Restaurant"}]}),{status:200});
 try {
  const db={prepare(){return {bind(){return {async first(){return {
    requested_at:Date.parse("2026-11-02T10:00:00Z"),
    dispatched_at:Date.parse("2026-11-02T13:00:00Z"),
    dispatch_status:"dispatched"
  };}};}}}};
  const response=await worker.fetch(new Request(endpoint,{headers:{Origin:origin}}),
   {DB:db,GITHUB_TOKEN:"test"});
  assert.equal(response.status,200);
  assert.equal((await response.json()).city.id,"deu/erlangen");
 } finally {globalThis.fetch=realFetch;Date.now=realNow;}
});
test("missing snapshot stays pending; browser must validate age",async()=>{
 const original = globalThis.fetch;
 const actualNow = Date.now;
 Date.now=()=>Date.parse("2026-11-02T10:01:00Z");
 try {
  globalThis.fetch=async()=>new Response("Not Found",{status:404});
  const pending=await worker.fetch(new Request(endpoint,{headers:{Origin:origin}}),{
    DB:mockDB(),GITHUB_TOKEN:"test"});
  assert.equal(pending.status,202);
  globalThis.fetch=async()=>new Response(JSON.stringify({
    city:{id:"deu/erlangen"},generatedAt:"2026-11-01T10:00:00Z",venues:[]
  }),{status:200});
  const stale=await worker.fetch(new Request(endpoint,{headers:{Origin:origin}}),{
    DB:mockDB(),GITHUB_TOKEN:"test"});
  assert.equal(stale.status,200);
  assert.equal((await stale.json()).generatedAt,"2026-11-01T10:00:00Z");
 } finally {globalThis.fetch=original;Date.now=actualNow;}
});


test("new visitor must select a city; blank homepage never triggers an automatic scan", async()=>{
 const {readFile}=await import("node:fs/promises");
 const app=await readFile(new URL("../docs/app.js",import.meta.url),"utf8");
 assert.match(app,/if \(cityId\) await loadSnapshotForCity\(cityId\)/);
 assert.match(app,/else showChooseCityPrompt\(\)/);
 assert.match(app,/return cityById\(requested\)\?\.id \?\? cityById\(stored\)\?\.id \?\? null/);
 assert.match(app,/url\.searchParams\.set\("city", cityId\)/);
});
