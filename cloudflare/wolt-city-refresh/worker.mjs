// Wolt on-demand city refresh coordinator. This Worker NEVER calls Wolt directly.
// A bounded Github Actions scan updates GitHub Pages asynchronously.
const ALLOWED_ORIGIN = "https://bl0ck154.github.io";
const REPO = "Bl0ck154/wolt-discount-monitor";
const CITIES_URL = "https://bl0ck154.github.io/wolt-discount-monitor/data/cities.json";
const MIN_REFRESH_MS = 4 * 60 * 60 * 1000;
const MAX_GLOBAL_SCANS_PER_DAY = 8;
const MAX_VISITOR_SCANS_PER_DAY = 3;

const json = (data, status = 200, origin = "") => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(origin === ALLOWED_ORIGIN ? {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    } : {}),
  },
});

const utcDate = (now) => new Date(now).toISOString().slice(0, 10);

async function knownCity(cityId) {
  const response = await fetch(CITIES_URL, { cf: { cacheEverything: true, cacheTtl: 1800 } });
  if (!response.ok) throw new Error("City catalog unavailable");
  const data = await response.json();
  return data.cities?.some((city) => city.id === cityId) === true;
}

async function visitorHash(request, day, secret) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const input = new TextEncoder().encode(day + ":" + ip + ":" + secret);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function budgetIncrement(db, table, day, visitorHashValue, maximum) {
  const visitor = table === "visitor_budget";
  const sql = visitor
    ? `INSERT INTO visitor_budget(day,visitor_hash,scans) VALUES(?,?,1)
       ON CONFLICT(day,visitor_hash) DO UPDATE SET scans=scans+1 WHERE scans < ?`
    : `INSERT INTO daily_budget(day,scans) VALUES(?,1)
       ON CONFLICT(day) DO UPDATE SET scans=scans+1 WHERE scans < ?`;
  const args = visitor ? [day, visitorHashValue, maximum] : [day, maximum];
  const result = await db.prepare(sql).bind(...args).run();
  return result.meta?.changes === 1;
}

async function refresh(request, env) {
  if (!env.DB || !env.GITHUB_TOKEN) {
    return json({ ok: false, message: "Refresh service unavailable" }, 503, request.headers.get("Origin"));
  }

  let body;
  try { body = await request.json(); } catch {
    return json({ ok: false, message: "Invalid request" }, 400, request.headers.get("Origin"));
  }
  const cityId = String(body?.cityId ?? "");
  if (!/^[a-z]{3}\/[a-z0-9-]{2,70}$/.test(cityId) || !(await knownCity(cityId))) {
    return json({ ok: false, message: "Unknown city" }, 400, request.headers.get("Origin"));
  }
  const now = Date.now();
  const day = utcDate(now);
  const existing = await env.DB.prepare("SELECT requested_at FROM city_jobs WHERE city_id = ?").bind(cityId).first();
  if (existing && now - existing.requested_at < MIN_REFRESH_MS) {
    return json({ ok: true, queued: false, requestedAt: existing.requested_at }, 200, request.headers.get("Origin"));
  }

  const visitor = await visitorHash(request, day, env.GITHUB_TOKEN);
  // A single-UPSERT claim prevents concurrent visitors from dispatching the same city.
  const claim = await env.DB.prepare(`INSERT INTO city_jobs(city_id,requested_at,dispatch_status) VALUES(?,?,'pending')
     ON CONFLICT(city_id) DO UPDATE SET requested_at=excluded.requested_at, dispatch_status='pending'
     WHERE city_jobs.requested_at < ?`).bind(cityId, now, now - MIN_REFRESH_MS).run();
  if (claim.meta?.changes !== 1) {
    const last = await env.DB.prepare("SELECT requested_at FROM city_jobs WHERE city_id = ?").bind(cityId).first();
    return json({ ok: true, queued: false, requestedAt: last?.requested_at ?? now }, 200, request.headers.get("Origin"));
  }

  const visitorAllowed = await budgetIncrement(env.DB, "visitor_budget", day, visitor, MAX_VISITOR_SCANS_PER_DAY);
  const globalAllowed = visitorAllowed &&
    await budgetIncrement(env.DB, "daily_budget", day, null, MAX_GLOBAL_SCANS_PER_DAY);
  if (!globalAllowed) {
    // Restore eligibility for a later attempt; leave budget limits intact.
    await env.DB.prepare("DELETE FROM city_jobs WHERE city_id=? AND requested_at=?").bind(cityId, now).run();
    return json({ ok: false, message: "Refresh temporarily unavailable" }, 429, request.headers.get("Origin"));
  }

  let githubResponse;
  try {
    githubResponse = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/check-discounts.yml/dispatches`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "wolt-demand-refresh",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { cities: cityId, force_refresh: "true" } }),
    });
  } catch {
    githubResponse = null;
  }
  if (githubResponse?.status !== 204) {
    await env.DB.prepare("DELETE FROM city_jobs WHERE city_id=? AND requested_at=?").bind(cityId, now).run();
    return json({ ok: false, message: "Refresh temporarily unavailable" }, 502, request.headers.get("Origin"));
  }
  await env.DB.prepare("UPDATE city_jobs SET dispatch_status='dispatched' WHERE city_id=? AND requested_at=?").bind(cityId, now).run();
  return json({ ok: true, queued: true, requestedAt: now }, 202, request.headers.get("Origin"));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "wolt-city-refresh" });
    }
    if (origin !== ALLOWED_ORIGIN) return json({ ok: false }, 403);
    if (request.method === "OPTIONS") return json({ ok: true }, 200, origin);
    if (url.pathname !== "/api/refresh" || request.method !== "POST") {
      return json({ ok: false }, 404, origin);
    }
    try {
      return await refresh(request, env);
    } catch {
      return json({ ok: false, message: "Refresh temporarily unavailable" }, 503, origin);
    }
  },
};
