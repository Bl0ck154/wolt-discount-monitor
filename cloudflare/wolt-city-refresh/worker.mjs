// Wolt city coordinator: batch up to 3 user-requested cities per GitHub scan.
// Never requests Wolt directly. The catalog is discoverable without scanning 967 cities.
const ALLOWED_ORIGIN = "https://bl0ck154.github.io";
const REPO = "Bl0ck154/wolt-discount-monitor";
const CITIES_URL = "https://bl0ck154.github.io/wolt-discount-monitor/data/cities.json";
const MIN_REFRESH_MS = 4 * 60 * 60 * 1000;
const MAX_GLOBAL_SCANS_PER_DAY = 240;
const MAX_VISITOR_SCANS_PER_DAY = 20;
const LEASE_MS = 90 * 1000;
const DISPATCH_PROPAGATION_MS = 90 * 1000;
export const ON_DEMAND_BATCH_SIZE = 3;

const json = (data, status = 200, origin = "") => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(origin === ALLOWED_ORIGIN ? {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    } : {}),
  },
});

const utcDate = (now) => new Date(now).toISOString().slice(0, 10);
const githubHeaders = (token) => ({
  Authorization: "Bearer " + token,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "wolt-demand-refresh",
});
async function knownCity(cityId) {
  const response = await fetch(CITIES_URL, { cf: { cacheEverything: true, cacheTtl: 1800 } });
  if (!response.ok) throw Error("City catalog unavailable");
  const catalog = await response.json();
  return catalog.cities?.some((c) => c.id === cityId) === true;
}
async function visitorHash(request, day, secret) {
  const input = new TextEncoder().encode(day + ":" + (request.headers.get("CF-Connecting-IP") || "unknown") + ":" + secret);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function budgetIncrement(db, table, day, visitor, maximum) {
  const isVisitor = table === "visitor_budget";
  const sql = isVisitor
    ? "INSERT INTO visitor_budget(day,visitor_hash,scans) VALUES(?,?,1) ON CONFLICT(day,visitor_hash) DO UPDATE SET scans=scans+1 WHERE scans < ?"
    : "INSERT INTO daily_budget(day,scans) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET scans=scans+1 WHERE scans < ?";
  const result = await db.prepare(sql).bind(...(isVisitor ? [day,visitor,maximum] : [day,maximum])).run();
  return result.meta?.changes === 1;
}

// A short D1 lease keeps only one workflow_dispatch active/pending at a time.
// Inside that workflow up to 3 city tasks fetch concurrently; one commit
// publishes them together, with no concurrent writes to main.
export async function dispatchNext(env, now = Date.now(), { completedScan = false } = {}) {
  if (!env.DB || !env.GITHUB_TOKEN) return { status: "unavailable" };
  const lease = await env.DB.prepare(
    "INSERT INTO scan_dispatch_lease(id,expires_at) VALUES(1,?) " +
    "ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at WHERE expires_at < ?"
  ).bind(now + LEASE_MS, now).run();
  if (lease.meta?.changes !== 1) return { status: "locked" };
  try {
    // When the queue is empty, avoid GitHub API calls.
    const queued = await env.DB.prepare(
      "SELECT city_id,requested_at FROM city_jobs WHERE dispatch_status='queued' " +
      "ORDER BY requested_at ASC, city_id ASC LIMIT ?"
    ).bind(ON_DEMAND_BATCH_SIZE).all();
    const batch = (queued.results ?? []).filter((job) =>
      /^[a-z]{3}[/][a-z0-9-]{2,70}$/.test(job.city_id)
    ).slice(0,ON_DEMAND_BATCH_SIZE);
    if (!batch.length) return { status: "empty" };
    const recent = await env.DB.prepare(
      "SELECT dispatched_at FROM city_jobs WHERE dispatched_at IS NOT NULL ORDER BY dispatched_at DESC LIMIT 1"
    ).first();
    if (!completedScan && recent && now - Number(recent.dispatched_at) < DISPATCH_PROPAGATION_MS) {
      return { status: "recently-dispatched" };
    }

    // Check both queued and in-progress runs: any new dispatch into the single
    // concurrency group would otherwise replace an older pending city.
    const statusResponse = await fetch(
      "https://api.github.com/repos/" + REPO + "/actions/workflows/check-discounts.yml/runs?per_page=20",
      { headers: githubHeaders(env.GITHUB_TOKEN) }
    );
    if (!statusResponse.ok) return { status: "github-unavailable" };
    const workflows = await statusResponse.json();
    if ((workflows.workflow_runs ?? []).some((run) => run.status !== "completed")) {
      return { status: "busy" };
    }
    const dispatch = await fetch(
      "https://api.github.com/repos/" + REPO + "/actions/workflows/check-discounts.yml/dispatches",
      { method: "POST", headers: { ...githubHeaders(env.GITHUB_TOKEN), "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "main", inputs: {
          cities: batch.map((city) => city.city_id).join(","),
          force_refresh: "true", parallel_scan: "true",
        } }) }
    );
    if (dispatch.status !== 204) {
      console.warn("GitHub workflow dispatch rejected", dispatch.status);
      return { status: "github-unavailable" };
    }
    // D1 batch executes the status changes as one transaction, preventing
    // half-updated groups when several cities share one dispatched workflow.
    const updates = batch.map((city) => env.DB.prepare(
      "UPDATE city_jobs SET dispatch_status='dispatched',dispatched_at=? " +
      "WHERE city_id=? AND requested_at=? AND dispatch_status='queued'"
    ).bind(now,city.city_id,city.requested_at));
    await env.DB.batch(updates);
    return { status: "dispatched", cityId: batch[0].city_id,
      cityIds: batch.map((city) => city.city_id) };
  } finally {
    await env.DB.prepare("DELETE FROM scan_dispatch_lease WHERE id=1 AND expires_at=?")
      .bind(now + LEASE_MS).run().catch(() => {});
  }
}

// A completed scan reaches the main GitHub branch before a new GitHub Pages
// deployment finishes. Serve that just-committed snapshot via GitHub's
// authenticated raw-content endpoint, with a tiny edge cache to bound API use.
// This never requests Wolt or queues scans.
async function fastSnapshot(request, env, url, ctx) {
  const origin = request.headers.get("Origin") || "";
  if (!env.DB || !env.GITHUB_TOKEN) return json({ok:false},503,origin);
  const cityId = url.searchParams.get("cityId") || "";
  if (!/^[a-z]{3}\/[a-z0-9-]{2,70}$/.test(cityId)) return json({ok:false},400,origin);
  const job = await env.DB.prepare(
    "SELECT requested_at,dispatch_status,dispatched_at FROM city_jobs WHERE city_id=?"
  ).bind(cityId).first();
  // Only fresh user-initiated requests can consume GitHub API reads.
  const dispatchTime = Number(job?.dispatched_at);
  // A long queue must not consume the fast-path window before scanning starts.
  if (!job || job.dispatch_status === "queued" || !Number.isFinite(dispatchTime) ||
      dispatchTime <= 0 || Date.now() - dispatchTime > 30 * 60 * 1000) {
    return json({ok:false,pending:true},202,origin);
  }
  const key = new Request("https://wolt-city-refresh.bl0ck-c1b.workers.dev/.internal-cache/" + cityId.replace("/", "-"));
  const cache = typeof caches === "undefined" ? null : caches.default;
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return new Response(hit.body, {status:200,headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store","Access-Control-Allow-Origin":ALLOWED_ORIGIN,
      "Vary":"Origin"
    }});
  }
  const path = cityId === "ltu/vilnius"
    ? "docs/data/latest.json"
    : "docs/data/cities/" + cityId.replace("/", "-") + "/latest.json";
  const upstream = await fetch(
    "https://api.github.com/repos/" + REPO + "/contents/" + path + "?ref=main",
    { headers: { ...githubHeaders(env.GITHUB_TOKEN),
      Accept:"application/vnd.github.raw+json" },
      cf: { cacheTtl: 0 } }
  );
  if (upstream.status === 404) return json({ok:false,pending:true},202,origin);
  if (!upstream.ok) return json({ok:false},503,origin);
  const contentLength = Number(upstream.headers.get("Content-Length") || 0);
  if (contentLength > 6_000_000) return json({ok:false},413,origin);
  // Stream large venue documents without parsing in the Worker:
  // Workers Free has a 10ms CPU budget. The browser verifies the city and age.
  const result = new Response(upstream.body, {status:200,headers:{
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store","Access-Control-Allow-Origin":ALLOWED_ORIGIN,
    "Vary":"Origin"
  }});
  if (cache && ctx?.waitUntil) {
    const entry = new Response(result.clone().body,{status:200,
      headers:{"Content-Type":"application/json","Cache-Control":"public,max-age=10"}});
    ctx.waitUntil(cache.put(key,entry).catch(() => {}));
  }
  return result;
}

// Lightweight, public per-city queue status for a browser waiting on its
// own refresh. No visitor identifiers and no GitHub API requests.
async function queueStatus(request, env, url) {
  const origin = request.headers.get("Origin") || "";
  if (!env.DB) return json({ok:false},503,origin);
  const cityId = url.searchParams.get("cityId") || "";
  if (!/^[a-z]{3}\/[a-z0-9-]{2,70}$/.test(cityId)) return json({ok:false},400,origin);
  const job = await env.DB.prepare(
    "SELECT requested_at,dispatched_at,dispatch_status FROM city_jobs WHERE city_id=?"
  ).bind(cityId).first();
  if (!job) return json({ok:true,state:"missing"},200,origin);
  const state = job.dispatch_status === "queued" ? "queued" :
    job.dispatch_status === "dispatched" ? "dispatched" : "unknown";
  let ahead = null;
  if (state === "queued") {
    const counts = await env.DB.prepare(
      "SELECT COUNT(*) AS ahead FROM city_jobs WHERE dispatch_status='queued' AND requested_at < ?"
    ).bind(job.requested_at).first();
    ahead = Math.max(0,Number(counts?.ahead ?? 0));
  }
  return json({ok:true,state,queueAhead:ahead,
    requestedAt:job.requested_at,dispatchedAt:job.dispatched_at ?? null},200,origin);
}

async function refresh(request, env) {
  if (!env.DB || !env.GITHUB_TOKEN) return json({ok:false,message:"Refresh service unavailable"},503,request.headers.get("Origin"));
  let body;
  try { body = await request.json(); } catch { return json({ok:false,message:"Invalid request"},400,request.headers.get("Origin")); }
  const cityId = String(body?.cityId ?? "");
  const origin = request.headers.get("Origin");
  if (!/^[a-z]{3}\/[a-z0-9-]{2,70}$/.test(cityId) || !await knownCity(cityId)) {
    return json({ok:false,message:"Unknown city"},400,origin);
  }
  const now = Date.now();
  const day = utcDate(now);
  const existing = await env.DB.prepare("SELECT requested_at,dispatch_status FROM city_jobs WHERE city_id=?").bind(cityId).first();
  if (existing && (existing.dispatch_status === "queued" || now - existing.requested_at < MIN_REFRESH_MS)) {
    // A repeat request also pokes the dispatcher in case the previous
    // completion notification was delayed, without charging a new scan.
    if (existing.dispatch_status === "queued") await dispatchNext(env).catch(() => {});
    return json({ok:true,queued:existing.dispatch_status==='queued',
      state:existing.dispatch_status,requestedAt:existing.requested_at},200,origin);
  }
  const visitor = await visitorHash(request,day,env.GITHUB_TOKEN);
  const claim = await env.DB.prepare(
    "INSERT INTO city_jobs(city_id,requested_at,dispatch_status,dispatched_at) VALUES(?,?,'queued',NULL) " +
    "ON CONFLICT(city_id) DO UPDATE SET requested_at=excluded.requested_at, dispatch_status='queued', dispatched_at=NULL " +
    "WHERE city_jobs.requested_at < ?"
  ).bind(cityId,now,now-MIN_REFRESH_MS).run();
  if (claim.meta?.changes !== 1) {
    const last = await env.DB.prepare("SELECT requested_at,dispatch_status FROM city_jobs WHERE city_id=?").bind(cityId).first();
    return json({ok:true,queued:last?.dispatch_status==='queued',state:last?.dispatch_status,requestedAt:last?.requested_at??now},200,origin);
  }
  const visitorAllowed = await budgetIncrement(env.DB,"visitor_budget",day,visitor,MAX_VISITOR_SCANS_PER_DAY);
  const globalAllowed = visitorAllowed && await budgetIncrement(env.DB,"daily_budget",day,null,MAX_GLOBAL_SCANS_PER_DAY);
  if (!globalAllowed) {
    await env.DB.prepare("DELETE FROM city_jobs WHERE city_id=? AND requested_at=? AND dispatch_status='queued'").bind(cityId,now).run();
    if (visitorAllowed) await env.DB.prepare("UPDATE visitor_budget SET scans=scans-1 WHERE day=? AND visitor_hash=? AND scans>0").bind(day,visitor).run();
    return json({ok:false,code:"daily_limit",message:"The daily scan budget is full. Try again tomorrow."},429,origin);
  }
  // Try immediately; workflow_run completion will dispatch the next queued city.
  const result = await dispatchNext(env,now);
  return json({ok:true,queued:true,
    state:result.status==="dispatched"&&result.cityIds?.includes(cityId)?"dispatched":"queued",
    requestedAt:now},202,origin);
}
export default {
  async fetch(request,env,ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    if (request.method === "GET" && url.pathname === "/health") return json({ok:true,service:"wolt-city-refresh",queue:true});
    // Only genuine, recently completed scans can trigger the next queued city.
    // GitHub verifies the run; D1 makes each completion event single-use.
    if (request.method === "POST" && url.pathname === "/api/drain") {
      try {
        const raw = await request.text();
        if (raw.length > 128) return json({ok:false},413);
        const runId = String(JSON.parse(raw).runId ?? "");
        if (!/^[0-9]{6,16}$/.test(runId) || !env.DB || !env.GITHUB_TOKEN) return json({ok:false},403);
        const response = await fetch("https://api.github.com/repos/" + REPO + "/actions/runs/" + runId,
          {headers:githubHeaders(env.GITHUB_TOKEN)});
        if (!response.ok) return json({ok:false},403);
        const run = await response.json();
        const completedAt = Date.parse(run.updated_at ?? "");
        if (run.name !== "Update Wolt discount monitor" || run.status !== "completed" ||
            run.head_branch !== "main" ||
            !["schedule","workflow_dispatch"].includes(run.event) ||
            !Number.isFinite(completedAt) ||
            Date.now() - completedAt > 60 * 60 * 1000 ||
            completedAt - Date.now() > 5 * 60 * 1000) {
          return json({ok:false},403);
        }
        const claimed = await env.DB.prepare(
          "INSERT OR IGNORE INTO scan_drain_events(run_id,claimed_at) VALUES(?,?)"
        ).bind(runId,Date.now()).run();
        if (claimed.meta?.changes !== 1) return json({ok:true,status:"already-processed"});
        const result = await dispatchNext(env, Date.now(), { completedScan: true });
        if (["github-unavailable","unavailable"].includes(result.status)) {
          await env.DB.prepare("DELETE FROM scan_drain_events WHERE run_id=?").bind(runId).run();
          return json({ok:false,status:result.status},503);
        }
        return json({ok:true,...result});
      } catch { return json({ok:false,message:"Queue drain unavailable"},503); }
    }
    if (origin !== ALLOWED_ORIGIN) return json({ok:false},403);
    if (request.method === "OPTIONS") return json({ok:true},200,origin);
    if (url.pathname === "/api/status" && request.method === "GET") {
      try { return await queueStatus(request,env,url); }
      catch { return json({ok:false},503,origin); }
    }
    if (url.pathname === "/api/snapshot" && request.method === "GET") {
      try { return await fastSnapshot(request,env,url,ctx); }
      catch { return json({ok:false},503,origin); }
    }
    if (url.pathname !== "/api/refresh" || request.method !== "POST") return json({ok:false},404,origin);
    try { return await refresh(request,env); }
    catch (error) { console.warn("Refresh queue failed",String(error)); return json({ok:false,message:"Refresh temporarily unavailable"},503,origin); }
  },
  // GitHub completion events drain this queue without a Cloudflare cron trigger.
};
