import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROUTE_STAGES = new Set([
  "route_prepare_start",
  "route_text_ocr_recovery",
  "route_text_ocr_retry",
  "route_plan_ready",
  "route_ready",
  "route_failed",
  "route_failure_retained",
]);

export function summarizeCourierPilotRouteEvents(events, day = "") {
  const ordered = [...events]
    .filter((event) => event && typeof event === "object")
    .sort((a, b) => Number(a.eventAt ?? 0) - Number(b.eventAt ?? 0));

  const cycles = [];
  let current = null;
  for (const event of ordered) {
    if (event.platform === "Wolt" && event.stage === "armed" && event.message === "New capture armed") {
      if (current) cycles.push(current);
      current = {
        startedAt: Number(event.eventAt ?? 0),
        appVersion: String(event.appVersion ?? ""),
        versionCode: Number(event.versionCode ?? 0),
        events: [event],
      };
      continue;
    }
    if (current) current.events.push(event);
  }
  if (current) cycles.push(current);

  const tracked = cycles.filter((cycle) => cycle.events.some((event) => ROUTE_STAGES.has(event.stage)));
  const outcomes = {
    visibleSuccess: 0,
    computedUiLost: 0,
    textIncomplete: 0,
    routeFailureOther: 0,
    unresolved: 0,
  };
  const byVersion = {};

  for (const cycle of tracked) {
    const visibleSuccess = cycle.events.some((event) =>
      event.stage === "route_ready" && /\bvisible=true\b/.test(String(event.message ?? ""))
    );
    const planReady = cycle.events.some((event) => event.stage === "route_plan_ready");
    const hiddenReady = cycle.events.some((event) =>
      event.stage === "route_ready" && /\bvisible=false\b/.test(String(event.message ?? ""))
    );
    const routeFailures = cycle.events.filter((event) => event.stage === "route_failed");
    const textIncomplete = routeFailures.some((event) =>
      /incomplete textual Wolt route/i.test(String(event.message ?? ""))
    );

    let outcome;
    if (visibleSuccess) outcome = "visibleSuccess";
    else if (planReady || hiddenReady) outcome = "computedUiLost";
    else if (textIncomplete) outcome = "textIncomplete";
    else if (routeFailures.length > 0) outcome = "routeFailureOther";
    else outcome = "unresolved";
    outcomes[outcome] += 1;

    const version = cycle.appVersion || "unknown";
    const versionStats = byVersion[version] ?? {
      offers: 0,
      visibleSuccess: 0,
      computedUiLost: 0,
      textIncomplete: 0,
      routeFailureOther: 0,
      unresolved: 0,
    };
    versionStats.offers += 1;
    versionStats[outcome] += 1;
    byVersion[version] = versionStats;
  }

  const stageCounts = {};
  for (const event of ordered) {
    const stage = String(event.stage ?? "");
    if (!stage) continue;
    stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
  }

  const offers = tracked.length;
  return {
    schema: 1,
    day,
    generatedAt: Date.now(),
    woltCaptureCycles: cycles.length,
    routeTrackedOffers: offers,
    outcomes,
    visibleSuccessRatePct: offers > 0 ? Math.round((outcomes.visibleSuccess / offers) * 1000) / 10 : null,
    visibleFailureRatePct: offers > 0 ? Math.round(((offers - outcomes.visibleSuccess) / offers) * 1000) / 10 : null,
    diagnostics: {
      routePrepareStart: stageCounts.route_prepare_start ?? 0,
      routePlanReady: stageCounts.route_plan_ready ?? 0,
      routeReady: stageCounts.route_ready ?? 0,
      routeTextOcrRecovery: stageCounts.route_text_ocr_recovery ?? 0,
      routeTextOcrRetry: stageCounts.route_text_ocr_retry ?? 0,
      routeFailed: stageCounts.route_failed ?? 0,
      overlayDifferenceDeferred: stageCounts.overlay_difference_deferred ?? 0,
      overlayReplacementConfirmed: stageCounts.overlay_replacement_confirmed ?? 0,
      windowMissing: stageCounts.window_missing ?? 0,
    },
    byVersion,
  };
}

export async function refreshCourierPilotRouteSummary(telemetryDir, day) {
  const inputPath = join(telemetryDir, `${day}.ndjson`);
  const raw = await readFile(inputPath, "utf8");
  const events = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const summary = summarizeCourierPilotRouteEvents(events, day);
  const target = join(telemetryDir, `${day}.route-summary.json`);
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await rename(temp, target);
  return summary;
}
