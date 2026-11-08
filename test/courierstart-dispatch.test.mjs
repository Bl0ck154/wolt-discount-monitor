import test from "node:test";
import assert from "node:assert/strict";
import { dispatchCourierstartWorkflow } from "../cloudflare/wolt-city-refresh/courierstart-dispatch.mjs";

test("without a Github credential, do not call GitHub", async () => {
  assert.equal(await dispatchCourierstartWorkflow({}, () => {
    throw new Error("No request expected");
  }), false);
});

test("only one scoped workflow dispatch is called", async () => {
  let calls = 0;
  const ok = await dispatchCourierstartWorkflow({ GITHUB_TOKEN: "test-only" }, async (url, request) => {
    calls++;
    assert.equal(url, "https://api.github.com/repos/Bl0ck154/Wolt-Referral-Site/actions/workflows/referral-cloudflare.yml/dispatches");
    assert.equal(request.method, "POST");
    assert.deepEqual(JSON.parse(request.body), { ref: "master" });
    assert.equal(request.headers.Authorization, "Bearer test-only");
    return { status: 204 };
  });
  assert.equal(ok, true);
  assert.equal(calls, 1);
});

test("non-success Github response is a safe failure", async () => {
  const ok = await dispatchCourierstartWorkflow({ GITHUB_TOKEN: "test-only" },
    async () => ({ status: 403 }));
  assert.equal(ok, false);
});
