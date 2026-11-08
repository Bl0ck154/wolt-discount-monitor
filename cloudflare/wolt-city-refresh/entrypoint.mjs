// The existing public Wolt Worker remains unchanged. This small wrapper adds
// a private named Cloudflare RPC entrypoint for CourierStart's conditional
// workflow dispatch; service-binding RPC is not a public HTTP endpoint.
import { WorkerEntrypoint } from "cloudflare:workers";
import worker from "./worker.mjs";
import { dispatchCourierstartWorkflow } from "./courierstart-dispatch.mjs";

export default worker;

export class CourierstartDispatcher extends WorkerEntrypoint {
  async dispatch() {
    return dispatchCourierstartWorkflow(this.env);
  }
}
