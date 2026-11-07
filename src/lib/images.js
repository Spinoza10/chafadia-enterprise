import { API_BASE } from "./api";

// Seeded products reference bundled images as "asset:<file>"; uploads are served by the API.
const bundled = import.meta.glob("../assets/images/*.{png,jpg,jpeg,webp}", { eager: true, query: "?url", import: "default" });
const byName = Object.fromEntries(Object.entries(bundled).map(([path, url]) => [path.split("/").pop(), url]));

export function imageUrl(src) {
  if (!src) return "";
  if (src.startsWith("asset:")) return byName[src.slice(6)] || "";
  if (src.startsWith("/uploads/")) return `${API_BASE}${src}`;
  return src;
}
