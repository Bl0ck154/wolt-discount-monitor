#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { refreshCourierPilotRouteSummary } from "../src/courierpilot-route-summary.mjs";

const cacheDir = process.env.WOLT_API_CACHE_DIR ?? ".cache/wolt-api";
const telemetryDir = join(cacheDir, "courierpilot");
const day = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const summary = await refreshCourierPilotRouteSummary(telemetryDir, day);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
