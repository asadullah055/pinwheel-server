const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { changedCatalogTags, notifyStorefront } = require("../src/utils/storefrontCache");

test("catalog invalidation is limited to catalog and inventory writes", () => {
  const req = (method, originalUrl) => ({ method, originalUrl });
  assert.deepEqual(changedCatalogTags(req("GET", "/api/product/publicProducts")), []);
  assert.deepEqual(changedCatalogTags(req("POST", "/api/auth/login")), []);
  assert.deepEqual(changedCatalogTags(req("PUT", "/api/product/abc")), ["catalog-products"]);
  assert.deepEqual(changedCatalogTags(req("DELETE", "/api/category/abc")), ["catalog-categories", "catalog-products"]);
  assert.deepEqual(changedCatalogTags(req("PATCH", "/api/banner/abc/toggle-status")), ["catalog-banners"]);
  assert.deepEqual(changedCatalogTags(req("POST", "/api/order/create")), ["catalog-products"]);
});

test("cache notifications authenticate to the configured storefront and tolerate failures", async () => {
  const previousUrl = process.env.STOREFRONT_REVALIDATE_URL;
  const previousSecret = process.env.CATALOG_REVALIDATE_SECRET;
  const received = [];
  let status = 200;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    received.push({ authorization: req.headers.authorization, body: JSON.parse(body) });
    res.writeHead(status).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    process.env.STOREFRONT_REVALIDATE_URL = `http://127.0.0.1:${server.address().port}/api/catalog/revalidate`;
    process.env.CATALOG_REVALIDATE_SECRET = "local-test-cache-secret";
    await notifyStorefront({ method: "PUT", originalUrl: "/api/category/abc" });
    assert.deepEqual(received[0], {
      authorization: "Bearer local-test-cache-secret",
      body: { tags: ["catalog-categories", "catalog-products"] },
    });
    status = 503;
    await assert.doesNotReject(async () => notifyStorefront({ method: "POST", originalUrl: "/api/product/create" }));
    delete process.env.CATALOG_REVALIDATE_SECRET;
    assert.equal(notifyStorefront({ method: "POST", originalUrl: "/api/product/create" }), undefined);
    assert.equal(received.length, 2);
  } finally {
    if (previousUrl === undefined) delete process.env.STOREFRONT_REVALIDATE_URL;
    else process.env.STOREFRONT_REVALIDATE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CATALOG_REVALIDATE_SECRET;
    else process.env.CATALOG_REVALIDATE_SECRET = previousSecret;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
