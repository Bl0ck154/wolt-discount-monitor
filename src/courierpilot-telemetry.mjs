import { appendFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const CACHE_DIR = process.env.WOLT_API_CACHE_DIR ?? ".cache/wolt-api";
const TELEMETRY_DIR = join(CACHE_DIR, "courierpilot");
const MAX_BODY_BYTES = 128 * 1024;
const MAX_EVENTS = 100;
const RETENTION_DAYS = 30;
const ID_RE = /^[a-f0-9-]{8,64}$/i;

export async function ingestCourierPilotTelemetry(request) {
  const payload = await readJsonBody(request, MAX_BODY_BYTES);
  if (payload?.schema !== 1) {
    throw httpError(400, "Unsupported telemetry schema");
  }

  const installId = safeText(payload.install_id, 64);
  const sessionId = safeText(payload.session_id, 64);
  if (!ID_RE.test(installId) || !ID_RE.test(sessionId)) {
    throw httpError(400, "Invalid telemetry identity");
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  if (events.length === 0 || events.length > MAX_EVENTS) {
    throw httpError(400, "Invalid telemetry event batch");
  }

  const now = Date.now();
  const metadata = {
    installId,
    sessionId,
    appVersion: safeText(payload.app_version, 32),
    versionCode: safeInteger(payload.version_code),
    androidSdk: safeInteger(payload.android_sdk),
    deviceModel: safeText(payload.device_model, 80),
  };
  const accepted = [];
  const lines = [];

  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const eventId = safeText(event.id, 80);
    const eventAt = safeInteger(event.timestamp);
    const stage = safeText(event.stage, 48);
    if (!eventId || !stage || eventAt <= 0 || Math.abs(now - eventAt) > 14 * 86_400_000) continue;

    accepted.push(eventId);
    lines.push(JSON.stringify({
      receivedAt: now,
      eventId,
      eventAt,
      ...metadata,
      platform: safeText(event.platform, 24),
      stage,
      message: safeText(event.message, 480),
    }));
  }

  if (lines.length === 0) {
    throw httpError(400, "No valid telemetry events");
  }

  await mkdir(TELEMETRY_DIR, { recursive: true });
  const day = new Date(now).toISOString().slice(0, 10);
  await appendFile(join(TELEMETRY_DIR, `${day}.ndjson`), `${lines.join("\n")}\n`, "utf8");
  void cleanupOldTelemetry(now).catch((error) => console.error("CourierPilot telemetry cleanup failed", error));

  return { ok: true, accepted };
}

async function readJsonBody(request, maxBytes) {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw httpError(413, "Request body too large");
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      throw httpError(413, "Request body too large");
    }
    chunks.push(chunk);
  }
  if (bytes === 0) {
    throw httpError(400, "Empty request body");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "Invalid JSON");
  }
}

function safeText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\0\r\n]/g, " ")
    .slice(0, maxLength);
}

function safeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : 0;
}

async function cleanupOldTelemetry(now) {
  const cutoff = now - RETENTION_DAYS * 86_400_000;
  const names = await readdir(TELEMETRY_DIR);
  await Promise.all(names.map(async (name) => {
    const match = name.match(/^(\d{4}-\d{2}-\d{2})\.ndjson$/);
    if (!match) return;
    const timestamp = Date.parse(`${match[1]}T00:00:00Z`);
    if (Number.isFinite(timestamp) && timestamp < cutoff) {
      await unlink(join(TELEMETRY_DIR, name));
    }
  }));
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
}
