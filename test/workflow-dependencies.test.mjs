import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("production updater keeps the normal monitor path dependency-free", async () => {
  const workflow = await readFile(new URL("../.github/workflows/check-discounts.yml", import.meta.url), "utf8");
  const testCount = (workflow.match(/- name: Run tests\n\s+run: node --test/g) ?? []).length;

  assert.equal(testCount, 2, "expected cloud and self-hosted test steps");
  assert.doesNotMatch(workflow, /run: npm ci/, "production monitor must not depend on npm registry availability");
});

test("direct Wolt fetch loads and runs without installed npm packages", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wolt-runtime-"));
  try {
    await cp(new URL("../src/wolt-api.mjs", import.meta.url), join(dir, "wolt-api.mjs"));
    await cp(new URL("../src/config.mjs", import.meta.url), join(dir, "config.mjs"));
    await writeFile(join(dir, "package.json"), '{"type":"module"}\n', "utf8");

    const script = `
      import { fetchJson } from "./wolt-api.mjs";
      const result = await fetchJson("https://example.test", {
        maxAttempts: 1,
        proxyDispatcher: null,
        fetchImpl: async () => new Response('{"ok":true}', { status: 200 }),
      });
      if (result.ok !== true) process.exit(2);
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, WOLT_PROXY_URL: "" },
    });

    assert.equal(child.status, 0, child.stderr || child.stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
