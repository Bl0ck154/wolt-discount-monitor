import test from "node:test";
import assert from "node:assert/strict";
import { isWoltLink, pageCityId, trackOutboundClick } from "../docs/outbound-clicks.mjs";
import worker from "../cloudflare/wolt-click-analytics/worker.mjs";
const origin = "https://bl0ck154.github.io";
test("only real HTTPS Wolt links are eligible", () => {
 assert.equal(isWoltLink("https://wolt.com/en/deu/berlin/venue/example"), true);
 assert.equal(isWoltLink("https://www.wolt.com/en/"), true);
 assert.equal(isWoltLink("https://wolt.com.evil.org/"), false);
 assert.equal(isWoltLink("javascript:alert(1)"), false);
 assert.equal(isWoltLink("http://wolt.com/"), false);
});
test("city from page route or query is validated", () => {
 assert.equal(pageCityId("https://bl0ck154.github.io/wolt-discount-monitor/de/cities/deu/berlin/"),"deu/berlin");
 assert.equal(pageCityId("https://bl0ck154.github.io/wolt-discount-monitor/cities/ltu/vilnius/"),"ltu/vilnius");
 assert.equal(pageCityId("https://bl0ck154.github.io/wolt-discount-monitor/?city=pol%2Fwarsaw"),"pol/warsaw");
 assert.equal(pageCityId("https://bl0ck154.github.io/wolt-discount-monitor/", "ltu/vilnius"),"ltu/vilnius");
 assert.equal(pageCityId("https://bl0ck154.github.io/wolt-discount-monitor/?city=wrong"),null);
});
test("click payload contains only city identifier and cannot include checkout details", () => {
 let sent;
 assert.equal(trackOutboundClick("deu/berlin",{send:(url,body)=>{sent={url,body};return true;}}),true);
 assert.deepEqual(JSON.parse(sent.body),{cityId:"deu/berlin"});
 assert.match(sent.url,/api\/click$/);
 assert.equal(trackOutboundClick("garbage",{send:()=>{throw Error("should not send");}}),false);
});
test("Worker refuses unauthorized origin and malformed telemetry", async()=>{
 const blocked=await worker.fetch(new Request("https://example.test/api/click",{
   method:"POST",headers:{Origin:"https://evil.test"},body:JSON.stringify({cityId:"deu/berlin"})
 }),{});
 assert.equal(blocked.status,403);
 const malformed=await worker.fetch(new Request("https://example.test/api/click",{
   method:"POST",headers:{Origin:origin},body:JSON.stringify({cityId:"../../etc"})
 }),{DB:{}});
 assert.equal(malformed.status,400);
});
test("Worker aggregates one day/city without storing user or destination",async()=>{
 const originalFetch=globalThis.fetch;
 const sql=[];
 globalThis.fetch=async()=>new Response(JSON.stringify({cities:[{id:"deu/berlin"}]}),{status:200});
 try {
  const db={prepare(query){sql.push(query);return {bind(...values){sql.push(values);return {async run(){return {meta:{changes:1}};}};}}}};
  const req=new Request("https://example.test/api/click",{
    method:"POST",headers:{Origin:origin,"Content-Type":"text/plain"},
    body:JSON.stringify({cityId:"deu/berlin"})
  });
  const response=await worker.fetch(req,{DB:db});
  assert.equal(response.status,202);
  assert.match(sql[0],/INSERT INTO outbound_clicks/);
  assert.equal(sql[1][1],"deu/berlin");
  assert.equal(sql[1].length,2);
 } finally{globalThis.fetch=originalFetch;}
});
test("Pages includes the click tracker for the homepage and city pages", async()=>{
 const {readFile}=await import("node:fs/promises");
 const html=await readFile(new URL("../docs/index.html",import.meta.url),"utf8");
 const builder=await readFile(new URL("../src/build-seo-site.mjs",import.meta.url),"utf8");
 const workflow=await readFile(new URL("../.github/workflows/deploy-pages.yml",import.meta.url),"utf8");
 assert.match(html,/outbound-clicks\.mjs/);
 assert.match(builder,/outbound-clicks\.mjs/);
 assert.match(workflow,/docs\/outbound-clicks\.mjs/);
});
