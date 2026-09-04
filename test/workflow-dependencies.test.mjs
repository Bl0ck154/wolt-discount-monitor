import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("production updater installs dependencies before tests on every runner path", async () => {
  const workflow = await readFile(new URL("../.github/workflows/check-discounts.yml", import.meta.url), "utf8");
  const installCount = (workflow.match(/- name: Install dependencies\n\s+run: npm ci/g) ?? []).length;
  const testCount = (workflow.match(/- name: Run tests\n\s+run: node --test/g) ?? []).length;

  assert.equal(testCount, 2, "expected cloud and self-hosted test steps");
  assert.equal(installCount, testCount, "every production test path must install package-lock dependencies");

  const cloud = workflow.slice(workflow.indexOf("  cloud:"), workflow.indexOf("  self-hosted:"));
  const selfHosted = workflow.slice(workflow.indexOf("  self-hosted:"));
  for (const section of [cloud, selfHosted]) {
    assert.ok(section.indexOf("run: npm ci") < section.indexOf("run: node --test"));
  }
});
