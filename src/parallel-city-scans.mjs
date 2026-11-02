/**
 * Bounded async city tasks. Workers never share a city's paths; the caller
 * performs all index/SEO writes only after the entire batch settles.
 *
 * Results preserve the requested order even if individual cities finish in a
 * different order. Failures don't discard successful city snapshots.
 */
export async function runCityScans(ids, scan, { concurrency = 1 } = {}) {
  if (!Array.isArray(ids) || typeof scan !== "function") {
    throw new TypeError("City IDs and a scan function are required");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) {
    throw new RangeError("City scan concurrency must be between 1 and 3");
  }
  let next = 0;
  const outcome = Array(ids.length);
  async function worker() {
    while (next < ids.length) {
      const i = next++;
      try {
        outcome[i] = { status: "fulfilled", value: await scan(ids[i]) };
      } catch (reason) {
        outcome[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return {
    results: outcome.filter((x) => x.status === "fulfilled").map((x) => x.value),
    failures: outcome.flatMap((x, index) => x.status === "rejected"
      ? [{ cityId: ids[index], error: x.reason }] : []),
  };
}
