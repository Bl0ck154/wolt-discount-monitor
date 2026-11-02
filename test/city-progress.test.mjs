import test from "node:test";
import assert from "node:assert/strict";
import { elapsedTime, progressStep, progressFromCoordinator } from "../docs/city-progress.mjs";
import worker from "../cloudflare/wolt-city-refresh/worker.mjs";

test("elapsed timer shows honest time, not a fabricated completion percentage",()=>{
 assert.equal(elapsedTime(1_000,1_000),"00:00");
 assert.equal(elapsedTime(1_000,66_000),"01:05");
 assert.equal(elapsedTime(1_000,3_601_000),"60:00");
 assert.equal(elapsedTime(1_000,0),"00:00");
 assert.equal(progressStep("queued"),1);
 assert.equal(progressStep("scanning"),2);
 assert.equal(progressStep("ready"),3);
 assert.equal(progressFromCoordinator({state:"queued"}),"queued");
 assert.equal(progressFromCoordinator({state:"dispatched"}),"scanning");
 assert.equal(progressFromCoordinator({}),"checking");
});
test("status endpoint reports queue position and dispatch stage without GitHub calls",async()=>{
 let called=false;
 const env={DB:{prepare(sql){
  assert.ok(/SELECT/.test(sql));
  return {bind(value){
   return {async first(){
    if(sql.includes("COUNT(*)")){ assert.equal(value,100);return {ahead:2};}
    assert.equal(value,"deu/erlangen");
    return {requested_at:100,dispatched_at:null,dispatch_status:"queued"};
   }};
  }};
 }}};
 const original=globalThis.fetch;
 globalThis.fetch=()=>{called=true;throw Error("No GitHub calls allowed");};
 try{
  const res=await worker.fetch(new Request("https://test.invalid/api/status?cityId=deu%2Ferlangen",
    {headers:{Origin:"https://bl0ck154.github.io"}}),env);
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{ok:true,state:"queued",queueAhead:2,requestedAt:100,dispatchedAt:null});
  assert.equal(called,false);
 }finally{globalThis.fetch=original;}
});
test("status endpoint restricts external origins, and rejects invalid identifiers",async()=>{
 const bad=await worker.fetch(new Request("https://test.invalid/api/status?cityId=%2Fbad",
   {headers:{Origin:"https://bl0ck154.github.io"}}),{DB:{}});
 assert.equal(bad.status,400);
 const forbidden=await worker.fetch(new Request("https://test.invalid/api/status?cityId=deu%2Ferlangen",
   {headers:{Origin:"https://wrong-site.invalid"}}),{DB:{}});
 assert.equal(forbidden.status,403);
});
test("frontend progress UI is localized, accessible and respects reduced motion",async()=>{
 const {readFile}=await import("node:fs/promises");
 const html=await readFile(new URL("../docs/index.html",import.meta.url),"utf8");
 const app=await readFile(new URL("../docs/app.js",import.meta.url),"utf8");
 const css=await readFile(new URL("../docs/styles.css",import.meta.url),"utf8");
 const data=await import("../docs/i18n-extra.mjs");
 const deploy=await readFile(new URL("../.github/workflows/deploy-pages.yml",import.meta.url),"utf8");
 assert.match(html,/id="scanProgress"/);
 assert.match(html,/role="progressbar"/);
 assert.match(html,/id="scanProgressElapsed"/);
 assert.match(html,/data-scan-step="queue"/);
 assert.match(app,/CITY_SCAN_STATUS_API/);
 assert.match(app,/updateScanQueueStatus/);
 assert.match(app,/beginScanProgress\(requestId/);
 assert.match(app,/hideScanProgress\(\)/);
 assert.match(app,/renderScanProgress\(\)/);
 assert.match(app,/removeAttribute\("aria-valuenow"\)/);
 assert.match(css,/prefers-reduced-motion: reduce/);
 for(const l of ["en","de","lt","pl","cs"]){
  assert.ok(data.extended[l].scanQueued);
  assert.ok(data.extended[l].scanScanning);
  assert.ok(data.extended[l].scanQueueAhead.includes("{count}"));
 }
 assert.match(deploy,/docs\/city-progress\.mjs/);
});
