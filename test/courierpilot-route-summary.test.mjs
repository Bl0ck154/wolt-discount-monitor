import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCourierPilotRouteEvents } from "../src/courierpilot-route-summary.mjs";

function event(at, stage, message = "", version = "0.15.79") {
  return { eventAt: at, platform: "Wolt", stage, message, appVersion: version, versionCode: 120 };
}
function arm(at, version = "0.15.79") {
  return event(at, "armed", "New capture armed", version);
}

test("classifies visible, computed-lost and text-incomplete Wolt cycles", () => {
  const summary = summarizeCourierPilotRouteEvents([
    arm(1000),
    event(1100, "route_prepare_start"),
    event(1200, "route_plan_ready", "points=3"),
    event(1300, "route_ready", "visible=true"),
    arm(2000),
    event(2100, "route_prepare_start"),
    event(2200, "route_plan_ready", "points=3"),
    event(2300, "route_ready", "visible=false"),
    arm(3000),
    event(3100, "route_text_ocr_recovery"),
    event(3200, "route_text_ocr_retry"),
    event(3300, "route_failed", "incomplete textual Wolt route; pickups=2; dropoffs=0; deliveries=1"),
  ], "2026-09-12");

  assert.equal(summary.routeTrackedOffers, 3);
  assert.deepEqual(summary.outcomes, {
    visibleSuccess: 1,
    computedUiLost: 1,
    textIncomplete: 1,
    routeFailureOther: 0,
    unresolved: 0,
  });
  assert.equal(summary.visibleSuccessRatePct, 33.3);
  assert.equal(summary.visibleFailureRatePct, 66.7);
  assert.equal(summary.diagnostics.routeTextOcrRecovery, 1);
  assert.equal(summary.diagnostics.routeTextOcrRetry, 1);
});

test("does not count Wolt captures with no route activity as route-tracked offers", () => {
  const summary = summarizeCourierPilotRouteEvents([
    arm(1000),
    event(1100, "price_accessibility"),
    arm(2000),
    event(2100, "route_prepare_start"),
    event(2200, "route_ready", "visible=true"),
  ]);

  assert.equal(summary.woltCaptureCycles, 2);
  assert.equal(summary.routeTrackedOffers, 1);
  assert.equal(summary.outcomes.visibleSuccess, 1);
});
