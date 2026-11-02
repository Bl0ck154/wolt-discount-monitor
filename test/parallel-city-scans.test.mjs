import test from "node:test";
import assert from "node:assert/strict";
import {runCityScans} from "../src/parallel-city-scans.mjs";
import {ON_DEMAND_BATCH_SIZE} from "../cloudflare/wolt-city-refresh/worker.mjs";
test("three city scans overlap without losing order and without shared commits",async()=>{
  const ids=["deu/erlangen","pol/krakow","ltu/vilnius"];
  let active=0,peak=0; const started=[];
  const out=await runCityScans(ids,async (city)=>{
    started.push(city);
    active++;peak=Math.max(peak,active);
    await new Promise(r=>setTimeout(r,city==="pol/krakow"?3:16));
    active--; return {id:city};
  },{concurrency:3});
  assert.equal(peak,3);
  assert.deepEqual(started,ids);
  assert.deepEqual(out.results.map(x=>x.id),ids);
  assert.deepEqual(out.failures,[]);
});
test("one city error does not discard another city result",async()=>{
  const ids=["deu/erlangen","pol/krakow","deu/furth"];
  const out=await runCityScans(ids,async city=>{
    if(city==="pol/krakow")throw new Error("Wolt unavailable");
    return {id:city};
  },{concurrency:3});
  assert.deepEqual(out.results.map(x=>x.id),["deu/erlangen","deu/furth"]);
  assert.equal(out.failures.length,1);
  assert.equal(out.failures[0].cityId,"pol/krakow");
});
test("parallelism never exceeds cap and sequential remains the default",async()=>{
  await assert.rejects(runCityScans(["one"],async x=>x,{concurrency:4}),RangeError);
  let active=0,peak=0;
  await runCityScans([1,2,3],async city=>{
    active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;
    return city;
  });
  assert.equal(peak,1);
  assert.equal(ON_DEMAND_BATCH_SIZE,3);
});
test("workflow accepts parallel on-demand requests but schedules stay serial",async()=>{
 const {readFile}=await import("node:fs/promises");
 const flow=await readFile(new URL("../.github/workflows/check-discounts.yml",import.meta.url),"utf8");
 const src=await readFile(new URL("../src/check-discounts.mjs",import.meta.url),"utf8");
 assert.match(flow,/parallel_scan:/);
 assert.match(flow,/WOLT_SCAN_CONCURRENCY:/);
 assert.match(flow,/inputs\.parallel_scan/);
 assert.match(src,/runCityScans/);
 assert.match(src,/await writeCitiesIndex\(catalog, results\)/);
 assert.match(src,/await buildSeoSite\(\)/);
});
