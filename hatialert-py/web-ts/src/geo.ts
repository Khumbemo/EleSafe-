/* Map projection maths. Real geography on the UTM zone 46N grid
   (EPSG:32646), the same forward formula as hatialert/geo.py.
   tools/check_i18n.cjs checks utmKm against PROJ reference values, so
   keep this file to plain, type-strippable TypeScript. */

export type Km = [number, number]; // [easting, northing] in km

/** WGS84 (lat, lon) to UTM zone 46N (easting, northing) in km. */
export const utmKm = (() => {
  const f = 1 / 298.257223563, n = f / (2 - f), A = 6378137 / (1 + n) * (1 + n * n / 4 + n ** 4 / 64);
  const al = [n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16, 13 * n * n / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240];
  const c = 2 * Math.sqrt(n) / (1 + n), rad = Math.PI / 180;
  return (lat: number, lon: number): Km => {
    const phi = lat * rad, dl = (lon - 93) * rad;
    const t = Math.sinh(Math.atanh(Math.sin(phi)) - c * Math.atanh(c * Math.sin(phi)));
    const xi = Math.atan2(t, Math.cos(dl)), eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
    let e = eta, nn = xi;
    al.forEach((a, j) => { const k = 2 * (j + 1); e += a * Math.cos(k * xi) * Math.sinh(k * eta); nn += a * Math.sin(k * xi) * Math.cosh(k * eta); });
    return [(500000 + 0.9996 * A * e) / 1000, (0.9996 * A * nn) / 1000];
  };
})();

/** Point `km` from (lat, lng) on bearing `deg` (sphere, as in domain.py). */
export function destination(lat: number, lng: number, km: number, deg: number): [number, number] {
  const R = 6371.0088, d = km / R, th = deg * Math.PI / 180, p1 = lat * Math.PI / 180, l1 = lng * Math.PI / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 * 180 / Math.PI, l2 * 180 / Math.PI];
}
