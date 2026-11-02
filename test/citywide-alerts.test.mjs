import test from "node:test";
import assert from "node:assert/strict";
import { diffSnapshots } from "../src/diff.mjs";

test("a citywide campaign must not trigger one-off discount notifications", () => {
  const venues = Array.from({ length: 12 }, (_, i) => ({
    slug: "venue-" + i,
    offers: [
      { text: "40% off whole basket", amount: 40, amountType: "percent",
        value: { score: 94, isDelivery: false } },
    ],
  }));
  const changes = diffSnapshots(null, { generatedAt: "2026-11-02T01:00:00Z", counts: {}, venues });
  assert.equal(changes.appeared.length, 12);
  assert.equal(changes.interestingAppeared.length, 0);
});
