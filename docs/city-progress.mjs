// Progress is stage-based: GitHub Actions does not expose per-venue percent.
export const SCAN_PHASES = new Set(["checking","queued","scanning","ready","delayed","error"]);
export function progressStep(phase) {
  if (phase === "ready") return 3;
  if (phase === "scanning") return 2;
  return 1;
}
export function progressFromCoordinator(value) {
  return value?.state === "queued" ? "queued" :
    value?.state === "dispatched" ? "scanning" : "checking";
}
export function elapsedTime(startedAt, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return String(minutes).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
}
