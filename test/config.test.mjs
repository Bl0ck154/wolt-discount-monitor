import test from "node:test";
import assert from "node:assert/strict";

import { readNumericEnv } from "../src/config.mjs";

test("numeric workflow variables use defaults when unset, blank, or invalid", () => {
  const name = "TEST_WOLT_NUMERIC_ENV";
  const previous = process.env[name];

  try {
    delete process.env[name];
    assert.equal(readNumericEnv(name, 45), 45);
    process.env[name] = "";
    assert.equal(readNumericEnv(name, 45), 45);
    process.env[name] = "  ";
    assert.equal(readNumericEnv(name, 45), 45);
    process.env[name] = "not-a-number";
    assert.equal(readNumericEnv(name, 45), 45);
    process.env[name] = "12.5";
    assert.equal(readNumericEnv(name, 45), 12.5);
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
});