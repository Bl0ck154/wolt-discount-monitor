import test from "node:test";
import assert from "node:assert/strict";
import { dispatchNext } from "../cloudflare/wolt-city-refresh/worker.mjs";

function fakeDB(cityIds = ["deu/erlangen","pol/krakow"]) {
  const state = {
    jobs: cityIds.map((city_id,i) => ({
      city_id,requested_at:1000+i*1000,dispatch_status:"queued",dispatched_at:null,
    })),
    lease:0,
  };
  const db = {
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
    prepare(sql) {
      return {
        async first() { return this.bind().first(); },
        bind(...args) {
          return {
            async all() {
              if (sql.includes("dispatch_status='queued'")) {
                return {results: state.jobs.filter(j=>j.dispatch_status==="queued")
                  .sort((a,b)=>a.requested_at-b.requested_at || a.city_id.localeCompare(b.city_id))
                  .slice(0,args[0])};
              }
              throw Error("Unexpected SQL all "+sql);
            },
            async run() {
              if (sql.includes("INSERT INTO scan_dispatch_lease")) {
                if (state.lease >= args[1]) return {meta:{changes:0}};
                state.lease=args[0];return {meta:{changes:1}};
              }
              if (sql.includes("DELETE FROM scan_dispatch_lease")) {
                if (state.lease===args[0])state.lease=0;
                return {meta:{changes:1}};
              }
              if (sql.includes("UPDATE city_jobs SET dispatch_status='dispatched'")) {
                const job=state.jobs.find(j=>j.city_id===args[1]&&j.requested_at===args[2]);
                if(job && job.dispatch_status==="queued"){
                  job.dispatch_status="dispatched";job.dispatched_at=args[0];
                  return {meta:{changes:1}};
                }
                return {meta:{changes:0}};
              }
              throw Error("Unexpected SQL run "+sql);
            },
            async first() {
              if (sql.includes("dispatched_at IS NOT NULL")) {
                const last=state.jobs.filter(j=>j.dispatched_at!==null)
                  .sort((a,b)=>b.dispatched_at-a.dispatched_at)[0];
                return last?{dispatched_at:last.dispatched_at}:null;
              }
              throw Error("Unexpected SQL first "+sql);
            },
          };
        },
      };
    },
  };
  return {db,state};
}

test("serial queue keeps the second user's city when a workflow is active", async () => {
  const {db,state}=fakeDB(["deu/erlangen","pol/krakow","deu/augsburg","deu/landshut"]),originalFetch=globalThis.fetch;
  let jobsActive=false, dispatches=0, firstBatch=null;
  globalThis.fetch=async (url,params={})=>{
    if (String(url).includes("/runs?")) {
      return new Response(JSON.stringify({workflow_runs:jobsActive?[{status:"in_progress"}]:[]}),{status:200});
    }
    if (String(url).includes("/dispatches")) {
      dispatches++;
      const payload=JSON.parse(params.body);
      assert.equal(payload.inputs.parallel_scan,"true");
      firstBatch ??= payload.inputs.cities;
      return new Response(null,{status:204});
    }
    throw Error("Unexpected fetch");
  };
  try {
    const env={DB:db,GITHUB_TOKEN:"test"};
    const first=await dispatchNext(env,100000);
    assert.equal(first.status,"dispatched");
    assert.equal(first.cityId,"deu/erlangen");
    assert.equal(firstBatch,"deu/erlangen,pol/krakow,deu/augsburg");
    assert.deepEqual(first.cityIds,["deu/erlangen","pol/krakow","deu/augsburg"]);
    assert.equal(dispatches,1);
    const second=await dispatchNext(env,130000);
    assert.equal(second.status,"recently-dispatched");
    assert.equal(dispatches,1);
    jobsActive=true;
    const third=await dispatchNext(env,200000);
    assert.equal(third.status,"busy");
    assert.equal(state.jobs[3].dispatch_status,"queued");
    jobsActive=false;
    const fourth=await dispatchNext(env,250000);
    assert.equal(fourth.status,"dispatched");
    assert.equal(fourth.cityId,"deu/landshut");
    assert.equal(dispatches,2);
  } finally {globalThis.fetch=originalFetch;}
});
test("completed workflow drains a second city even when the first scan finished within 90 seconds",async()=>{
  const {db,state}=fakeDB(["deu/erlangen","pol/krakow","deu/augsburg","deu/landshut"]);
  const fetchBefore=globalThis.fetch;
  let requests=0;
  globalThis.fetch=async(url)=>{
    if(String(url).includes("/runs?"))return new Response(JSON.stringify({workflow_runs:[]}),{status:200});
    if(String(url).includes("/dispatches")){requests++;return new Response(null,{status:204});}
    throw Error("Unexpected external request "+url);
  };
  try{
    const env={DB:db,GITHUB_TOKEN:"test"};
    const first=await dispatchNext(env,100000);
    assert.equal(first.cityId,"deu/erlangen");
    const second=await dispatchNext(env,155000,{completedScan:true});
    assert.equal(second.cityId,"deu/landshut");
    assert.equal(requests,2);
    assert.equal(state.jobs[3].dispatch_status,"dispatched");
  }finally{globalThis.fetch=fetchBefore;}
});
test("GitHub API failure leaves a queued city intact",async()=>{
  const {db,state}=fakeDB(),originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response("temporarily unavailable",{status:503});
  try {
    const result=await dispatchNext({DB:db,GITHUB_TOKEN:"test"},200000);
    assert.equal(result.status,"github-unavailable");
    assert.equal(state.jobs[0].dispatch_status,"queued");
    assert.equal(state.jobs[1].dispatch_status,"queued");
  } finally {globalThis.fetch=originalFetch;}
});
test("browser waits for queue and refuses ancient successful snapshots",async()=>{
  const {readFile}=await import("node:fs/promises");
  const app=await readFile(new URL("../docs/app.js",import.meta.url),"utf8");
  assert.match(app,/CITY_REFRESH_MAX_POLLS = 144/);
  assert.match(app,/CITY_SNAPSHOT_FAST_API/);
  assert.match(app,/CITY_REFRESH_POLL_MS = 5000/);
  assert.match(app,/state === "queued"/);
  assert.match(app,/age >= CITY_MAX_DISPLAY_AGE_MS/);
  assert.match(app,/cached\.snapshot\?\.generatedAt \?\? null/);
  assert.doesNotMatch(app,/showCityFetchFailure\(/);
});


test("drain endpoint rejects malformed completed-run IDs", async () => {
  const worker=(await import("../cloudflare/wolt-city-refresh/worker.mjs")).default;
  const response=await worker.fetch(new Request("https://example.test/api/drain",{
    method:"POST",body:JSON.stringify({runId:"wrong"})
  }),{DB:{},GITHUB_TOKEN:"test"});
  assert.equal(response.status,403);
});
test("GitHub completion event drains without needing a Cloudflare cron",async()=>{
  const {readFile}=await import("node:fs/promises");
  const yaml=await readFile(new URL("../.github/workflows/drain-city-queue.yml",import.meta.url),"utf8");
  assert.match(yaml,/workflow_run:/);
  assert.match(yaml,/types: \[completed\]/);
  assert.match(yaml,/workflow_run\.id/);
  assert.match(yaml,/api\/drain/);
});
