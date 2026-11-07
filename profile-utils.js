const INSTAGRAM_HANDLE_PATTERN = /^(?=.{1,30}$)[A-Za-z0-9](?:[A-Za-z0-9._]*[A-Za-z0-9])?$/;

export function normalizeInstagramProfileUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const candidate = raw.replace(/^@/, "");
  if (INSTAGRAM_HANDLE_PATTERN.test(candidate)) {
    return `https://www.instagram.com/${candidate}/`;
  }

  let url;
  try {
    const withScheme = /^https?:\/\//i.test(candidate)
      ? candidate
      : /^(?:www\.)?instagram\.com\//i.test(candidate)
        ? `https://${candidate}`
        : "";
    if (!withScheme) return "";
    url = new URL(withScheme);
  } catch (_) {
    return "";
  }

  const host = url.hostname.toLowerCase();
  if (!["instagram.com", "www.instagram.com"].includes(host)) return "";
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  if (url.username || url.password || url.port) return "";

  let path = url.pathname.replace(/^\/+|\/+$/g, "");
  if (!path) return "";
  try { path = decodeURIComponent(path); } catch (_) { return ""; }
  if (path.includes("/") || !INSTAGRAM_HANDLE_PATTERN.test(path)) return "";

  return `https://www.instagram.com/${path}/`;
}
