export const toRad = (d: number) => (d * Math.PI) / 180;
export const toDeg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in nautical miles. */
export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial true bearing from point 1 to point 2, 0-360. */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Signed shortest turn from heading a to heading b, -180..180. */
export const angleDiff = (a: number, b: number) => ((((b - a + 540) % 360) + 360) % 360) - 180;

/** The nearest item within its own radius, or null. */
export function nearestWithin<T extends { lat: number; lon: number }>(
  items: T[], lat: number, lon: number, radiusOf: (t: T) => number,
): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const it of items) {
    const d = distanceNm(lat, lon, it.lat, it.lon);
    if (d <= radiusOf(it) && d < bestD) { best = it; bestD = d; }
  }
  return best;
}
