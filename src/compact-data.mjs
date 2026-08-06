import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import {
  compactChangeLog,
  compactChangesDocument,
  compactCitiesIndex,
  compactNotifiedState,
  compactSnapshot,
  jsonText,
} from "./public-snapshot.mjs";

const root = process.argv.find((arg) => arg.startsWith("--root="))?.slice("--root=".length) ?? "docs/data";
const checkOnly = process.argv.includes("--check");
const files = await jsonFiles(root);
let beforeTotal = 0;
let afterTotal = 0;
let changed = 0;

for (const path of files) {
  const before = await readFile(path, "utf8");
  const value = JSON.parse(before.replace(/^\uFEFF/, ""));
  const compacted = compactValue(path, value);
  const after = jsonText(compacted);
  beforeTotal += Buffer.byteLength(before);
  afterTotal += Buffer.byteLength(after);
  if (before !== after) {
    changed += 1;
    if (!checkOnly) {
      await writeFile(path, after, "utf8");
    }
  }
  console.log(`${relative(process.cwd(), path)}: ${formatBytes(Buffer.byteLength(before))} -> ${formatBytes(Buffer.byteLength(after))}`);
}

console.log(JSON.stringify({
  root,
  files: files.length,
  changed,
  checkOnly,
  beforeBytes: beforeTotal,
  afterBytes: afterTotal,
  savedBytes: beforeTotal - afterTotal,
  savedPercent: beforeTotal ? Number(((beforeTotal - afterTotal) / beforeTotal * 100).toFixed(1)) : 0,
}, null, 2));

if (checkOnly && changed > 0) {
  process.exitCode = 1;
}

function compactValue(path, value) {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.endsWith("/latest.json")) return compactSnapshot(value);
  if (normalized.endsWith("/changes-log.json")) return compactChangeLog(value);
  if (normalized.endsWith("/changes.json")) return compactChangesDocument(value);
  if (normalized.endsWith("/notified-offers.json")) return compactNotifiedState(value);
  if (normalized.endsWith("/cities.json")) return compactCitiesIndex(value);
  return value;
}

async function jsonFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await jsonFiles(path));
    else if (entry.isFile() && extname(entry.name) === ".json" && (await stat(path)).size > 0) result.push(path);
  }
  return result.sort();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
}
