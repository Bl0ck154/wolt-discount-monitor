import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PATHS } from "./config.mjs";
import { diffSnapshots } from "./diff.mjs";
import { fetchVilniusData } from "./wolt-api.mjs";
import { normalizeSnapshot } from "./normalize.mjs";
import { formatTelegramMessage, sendTelegramMessage } from "./telegram.mjs";

async function main() {
  const previous = await readJsonIfExists(PATHS.latest);
  const current = normalizeSnapshot(await fetchVilniusData());
  const changes = diffSnapshots(previous, current);
  const hasChanges =
    process.env.FORCE_WRITE === "true" ||
    !previous ||
    changes.appeared.length > 0 ||
    changes.disappeared.length > 0 ||
    previous.counts?.promotionsUniqueVenues !== current.counts.promotionsUniqueVenues ||
    previous.counts?.restaurantsUniqueVenues !== current.counts.restaurantsUniqueVenues;

  if (hasChanges) {
    await writeJson(PATHS.latest, current);
    await writeJson(PATHS.changes, changes);
    await appendChangeLog(changes);
  }

  const shouldNotify = Boolean(previous) && changes.interestingAppeared.length > 0;
  let telegram = {
    skipped: true,
    reason: previous ? "No new interesting offers" : "Baseline created; no previous snapshot",
  };

  if (shouldNotify) {
    telegram = await sendTelegramMessage(formatTelegramMessage(changes));
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: current.generatedAt,
        counts: current.counts,
        appeared: changes.appeared.length,
        disappeared: changes.disappeared.length,
        interestingAppeared: changes.interestingAppeared.length,
        wroteFiles: hasChanges,
        telegram,
      },
      null,
      2,
    ),
  );
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function appendChangeLog(changes) {
  const existing = (await readJsonIfExists(PATHS.log)) ?? [];
  const entry = {
    generatedAt: changes.generatedAt,
    previousGeneratedAt: changes.previousGeneratedAt,
    appeared: changes.appeared.length,
    disappeared: changes.disappeared.length,
    interestingAppeared: changes.interestingAppeared.length,
    interesting: changes.interestingAppeared.slice(0, 50),
  };

  await writeJson(PATHS.log, [entry, ...existing].slice(0, 200));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
