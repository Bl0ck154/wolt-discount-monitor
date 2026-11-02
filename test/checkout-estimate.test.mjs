import test from "node:test";
import assert from "node:assert/strict";
import { canEstimateOffer, bestEstimatableOffer, estimateCheckout } from "../docs/checkout-estimate.mjs";
const money = { amount: 6.5, amountType: "money", currencyCode: "EUR", value: { scope: "broad", score: 80 } };
const percent = { amount: 30, amountType: "percent", currencyCode: "EUR", value: { scope: "broad", score: 50, maxSavings: 8, minimumSpend: 15 } };
const params = { basket: 20, deliveryFee: 3.5, serviceFee: 1, currency: "EUR" };
test("basket estimate includes the address-specific fee entered by user", () => {
 assert.deepEqual(estimateCheckout({ ...params, offer:money }), {
  status:"ok",subtotal:20,savings:6.5,deliveryFee:3.5,serviceFee:1,total:18
 });
 assert.deepEqual(estimateCheckout({ ...params, deliveryFee:7, offer:money }).total,21.5);
});
test("never assumes a delivery fee or service fee is zero", () => {
 assert.equal(estimateCheckout({...params,deliveryFee:null,offer:money}).status,"missing");
 assert.equal(estimateCheckout({...params,serviceFee:undefined,offer:money}).status,"missing");
 assert.equal(estimateCheckout({...params,deliveryFee:-1,offer:money}).status,"missing");
 assert.equal(estimateCheckout({...params,deliveryFee:Infinity,offer:money}).status,"missing");
});
test("minimum spend and max-savings cap constrain estimate", () => {
 assert.deepEqual(estimateCheckout({...params,basket:12,offer:percent}), {status:"minimum",minimumSpend:15});
 const r=estimateCheckout({...params,basket:100,offer:percent});
 assert.equal(r.savings,8);assert.equal(r.total,96.5);
});
test("item-level, multibuy, up-to-percent and delivery offers are not estimatable", () => {
 for(const patch of [{isDelivery:true},{isSelectedItems:true},{isMultibuy:true},{isUpToPercent:true},{scope:"selected"}]) {
  const {scope,...flags}=patch;
  const offer={...money,value:{...money.value,...flags,...(scope?{scope}:{})}};
  assert.equal(canEstimateOffer(offer),false);
  assert.equal(estimateCheckout({...params,offer}).status,"unsupported");
 }
 assert.equal(estimateCheckout({...params,offer:money,currency:"PLN"}).status,"unsupported");
 assert.deepEqual(bestEstimatableOffer([{...money,value:{scope:"selected",score:100}},money]),money);
});
test("checkout UI is local-only and included in the Pages artifact", async () => {
 const {readFile} = await import("node:fs/promises");
 const page=await readFile(new URL("../docs/index.html",import.meta.url),"utf8");
 const app=await readFile(new URL("../docs/app.js",import.meta.url),"utf8");
 const build=await readFile(new URL("../.github/workflows/deploy-pages.yml",import.meta.url),"utf8");
 assert.match(page,/id="checkoutDelivery"/);
 assert.match(page,/id="checkoutOtherFees"/);
 assert.match(app,/estimateCheckout/);
 assert.match(build,/docs\/checkout-estimate\.mjs/);
});
