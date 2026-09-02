import test from "node:test";
import assert from "node:assert/strict";

import { TaskPool } from "../src/refresh-pool.mjs";

test("TaskPool caps concurrent work", async () => {
  const pool = new TaskPool({ concurrency: 2, maxQueue: 10, name: "test" });
  let active = 0;
  let maxActive = 0;

  const tasks = Array.from({ length: 6 }, (_, index) => pool.run(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return index;
  }));

  assert.deepEqual(await Promise.all(tasks), [0, 1, 2, 3, 4, 5]);
  assert.equal(maxActive, 2);
  assert.deepEqual(pool.stats, { active: 0, queued: 0, concurrency: 2, maxQueue: 10 });
});

test("TaskPool rejects work once the waiting queue is full", async () => {
  const pool = new TaskPool({ concurrency: 1, maxQueue: 1, name: "test" });
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = pool.run(() => firstGate);
  const second = pool.run(() => "second");
  const third = pool.run(() => "third");

  await assert.rejects(third, (error) => {
    assert.equal(error.code, "QUEUE_FULL");
    assert.equal(error.statusCode, 503);
    return true;
  });

  releaseFirst("first");
  assert.equal(await first, "first");
  assert.equal(await second, "second");
});
