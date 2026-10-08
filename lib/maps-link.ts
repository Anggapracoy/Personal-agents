/** A Maps center coordinate alone does not select a place or request a route. */
export function actionableMapsLink(href: string): string {
  try {
    const url = new URL(href);
    if (!["https:", "http:"].includes(url.protocol) || url.hostname !== "maps.apple.com" || url.username || url.password) return href;
    // Existing place IDs, modern place links, searches, and explicit routes already
    // carry their intended action. Only repair legacy coordinate-center links.
    if (!["", "/"].includes(url.pathname) || url.searchParams.has("daddr") || url.searchParams.has("auid") || url.searchParams.has("place-id")) return href;
    const center = url.searchParams.get("ll");
    if (!center || !/^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/.test(center)) return href;
    const [latitude, longitude] = center.split(",").map(Number);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return href;
    url.searchParams.set("daddr", `${latitude},${longitude}`);
    url.searchParams.delete("ll");
    return url.href;
  } catch { return href; }
}
