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


test("reports flicker diagnostics by app version without relying on capture-cycle attribution", () => {
  const summary = summarizeCourierPilotRouteEvents([
    arm(1000, "0.15.79"),
    event(1100, "route_ready", "visible=true", "0.15.79"),
    event(2000, "screen_armed", "Offer detected directly on courier screen; notification was not required", "0.15.82"),
    event(2100, "route_ready", "Route updated cached card; visible=false", "0.15.82"),
    event(2200, "overlay_replacement_confirmed", "price=626->626", "0.15.82"),
    event(2300, "overlay_hide", "different offer is now stably visible", "0.15.82"),
    event(2400, "screen_armed", "Offer detected directly on courier screen; notification was not required", "0.15.82"),
    event(2500, "duplicate_suppressed", "Same live offer already exists as record #986", "0.15.82"),
    event(3000, "overlay_difference_observed", "price=626->626", "0.15.83"),
    event(3100, "route_ready", "Route updated cached card; visible=true", "0.15.83"),
  ]);

  assert.equal(summary.diagnostics.overlayReplacementConfirmed, 1);
  assert.equal(summary.diagnostics.overlayHideDifferentOffer, 1);
  assert.equal(summary.diagnostics.screenArmed, 2);
  assert.equal(summary.diagnostics.duplicateSuppressed, 1);
  assert.deepEqual(summary.diagnosticsByVersion["0.15.82"], {
    events: 6,
    screenArmed: 2,
    routeReadyVisible: 0,
    routeReadyHidden: 1,
    overlayDifferenceObserved: 0,
    overlayReplacementConfirmed: 1,
    overlayHideDifferentOffer: 1,
    duplicateSuppressed: 1,
  });
  assert.equal(summary.diagnosticsByVersion["0.15.83"].overlayDifferenceObserved, 1);
  assert.equal(summary.diagnosticsByVersion["0.15.83"].routeReadyVisible, 1);
});
