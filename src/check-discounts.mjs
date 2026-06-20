import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PATHS } from "./config.mjs";
import { diffSnapshots, interestingOfferIndex } from "./diff.mjs";
import { fetchVilniusData } from "./wolt-api.mjs";
import { normalizeSnapshot } from "./normalize.mjs";
import { formatTelegramMessage, sendTelegramMessage } from "./telegram.mjs";

async function main() {
  const previous = await readJsonIfExists(PATHS.latest);
  const notified = (await readJsonIfExists(PATHS.notified)) ?? { activeOffers: [] };
  const current = normalizeSnapshot(await fetchVilniusData());
  const changes = diffSnapshots(previous, current);
  const currentInteresting = interestingOfferIndex(current);
  const notifiedByKey = new Map((notified.activeOffers ?? []).filter((offer) => offer.stableKey).map((offer) => [offer.stableKey, offer]));
  const newInteresting = changes.interestingAppeared.filter((offer) => !notifiedByKey.has(offer.stableKey));
  const endedNotified = [...notifiedByKey.values()].filter((offer) => !currentInteresting.has(offer.stableKey));
  const hasChanges =
    process.env.FORCE_WRITE === "true" ||
    !previous ||
    changes.appeared.length > 0 ||
    changes.disappeared.length > 0 ||
    previous.counts?.promotionsUniqueVenues !== current.counts.promotionsUniqueVenues ||
    previous.counts?.restaurantsUniqueVenues !== current.counts.restaurantsUniqueVenues;

  if (hasChanges) {
    await writeJson(PATHS.latest, current);
    await writeJson(PATHS.changes, {
      ...changes,
      newInteresting,
      endedNotified,
      notifiedSummary: {
        newInteresting: newInteresting.length,
        endedNotified: endedNotified.length,
      },
    });
    await appendChangeLog(changes, { newInteresting, endedNotified });
  }

  const shouldNotify = Boolean(previous) && (newInteresting.length > 0 || endedNotified.length > 0);
  let telegram = {
    skipped: true,
    reason: previous ? "No new interesting offers" : "Baseline created; no previous snapshot",
  };

  if (shouldNotify) {
    telegram = await sendTelegramMessage(formatTelegramMessage({
      appeared: newInteresting,
      ended: endedNotified,
      allAppeared: changes.appeared.length,
      allDisappeared: changes.disappeared.length,
    }));
  }

  if (shouldNotify && telegram.skipped === false) {
    await writeJson(PATHS.notified, buildNotifiedState({
      previous: notified,
      currentInteresting,
      appeared: newInteresting,
      ended: endedNotified,
      generatedAt: current.generatedAt,
    }));
  } else if (!shouldNotify && notifiedByKey.size) {
    await writeJson(PATHS.notified, buildNotifiedState({
      previous: notified,
      currentInteresting,
      appeared: [],
      ended: [],
      generatedAt: current.generatedAt,
    }));
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: current.generatedAt,
        counts: current.counts,
        appeared: changes.appeared.length,
        disappeared: changes.disappeared.length,
        interestingAppeared: newInteresting.length,
        interestingEnded: endedNotified.length,
        wroteFiles: hasChanges,
        telegram,
      },
      null,
      2,
    ),
  );
}

function buildNotifiedState({ previous, currentInteresting, appeared, ended, generatedAt }) {
  const endedKeys = new Set(ended.map((offer) => offer.stableKey));
  const byKey = new Map();

  for (const offer of previous.activeOffers ?? []) {
    if (!endedKeys.has(offer.stableKey)) {
      byKey.set(offer.stableKey, {
        ...offer,
        lastSeenAt: currentInteresting.has(offer.stableKey) ? generatedAt : offer.lastSeenAt,
      });
    }
  }

  for (const offer of appeared) {
    byKey.set(offer.stableKey, {
      stableKey: offer.stableKey,
      firstNotifiedAt: generatedAt,
      lastSeenAt: generatedAt,
      venue: offer.venue,
      sourcePath: offer.sourcePath,
      campaignId: offer.campaignId,
      text: offer.text,
      amount: offer.amount,
      amountType: offer.amountType,
      amountLabel: offer.amountLabel,
    });
  }

  return {
    updatedAt: generatedAt,
    activeOffers: [...byKey.values()].sort((a, b) => a.venue.name.localeCompare(b.venue.name)),
  };
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

async function appendChangeLog(changes, notification = {}) {
  const existing = (await readJsonIfExists(PATHS.log)) ?? [];
  const newInteresting = notification.newInteresting ?? changes.interestingAppeared;
  const endedNotified = notification.endedNotified ?? [];
  const entry = {
    generatedAt: changes.generatedAt,
    previousGeneratedAt: changes.previousGeneratedAt,
    appeared: changes.appeared.length,
    disappeared: changes.disappeared.length,
    interestingAppeared: changes.interestingAppeared.length,
    notifiedNew: newInteresting.length,
    notifiedEnded: endedNotified.length,
    interesting: newInteresting.slice(0, 50),
    ended: endedNotified.slice(0, 50),
  };

  await writeJson(PATHS.log, [entry, ...existing].slice(0, 200));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
