const { waitUntil } = require("@vercel/functions");

function changedCatalogTags(req) {
  if (!req || ["GET", "HEAD", "OPTIONS"].includes(req.method)) return [];
  const path = (req.originalUrl || "").split("?")[0];
  if (/^\/api\/banner(?:\/|$)/.test(path)) return ["catalog-banners"];
  if (/^\/api\/category(?:\/|$)/.test(path)) return ["catalog-categories", "catalog-products"];
  if (/^\/api\/(?:product|brand|order)(?:\/|$)/.test(path)) return ["catalog-products"];
  return [];
}

function notifyStorefront(req) {
  const url = process.env.STOREFRONT_REVALIDATE_URL;
  const secret = process.env.CATALOG_REVALIDATE_SECRET;
  const tags = changedCatalogTags(req);
  if (!url || !secret || !tags.length) return;

  // Catalog writes should still succeed if the storefront is temporarily unavailable.
  const notification = fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ tags }),
    signal: AbortSignal.timeout(3000),
  }).then((response) => {
    if (!response.ok) throw new Error("Cache refresh rejected");
  }).catch(() => console.warn("Storefront cache refresh failed; timed revalidation remains enabled"));
  if (process.env.VERCEL) waitUntil(notification);
  return notification;
}

module.exports = { changedCatalogTags, notifyStorefront };
