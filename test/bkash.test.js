const { test, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const PaymentToken = require("../src/model/PaymentToken");
const gateway = require("../src/services/bkash");
const originalEnv = { ...process.env };
let cached, requests;

beforeEach(() => {
  Object.assign(process.env, { BKASH_ENV: "sandbox", BKASH_APP_KEY: "fake-key", BKASH_APP_SECRET: "fake-secret", BKASH_USERNAME: "fake-user", BKASH_PASSWORD: "fake-password", BKASH_CALLBACK_URL: "http://localhost:8000/api/order/bkash/callback", STOREFRONT_URL: "http://localhost:3000" });
  cached = null; requests = [];
  mock.method(PaymentToken, "updateOne", async (_filter, update) => {
    if (!cached) cached = { ...update.$setOnInsert };
    Object.assign(cached, update.$set || {});
  });
  mock.method(PaymentToken, "findById", async () => structuredClone(cached));
  mock.method(PaymentToken, "findOneAndUpdate", async (filter, update) => {
    if (cached.lockUntil > filter.lockUntil.$lte || cached.nextAttemptAt > filter.nextAttemptAt.$lte) return null;
    Object.assign(cached, update.$set); return structuredClone(cached);
  });
  mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) });
    return { ok: true, json: async () => url.includes("/auth/")
      ? { statusCode: "0000", id_token: "fake-id-token", refresh_token: "fake-refresh-token", expires_in: 3600 }
      : { transactionStatus: "Initiated", paymentId: "payment-1" } };
  });
});
afterEach(() => {
  mock.restoreAll();
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

test("v2 requests grant once, reuse the persisted token, and keep credentials in authentication only", async () => {
  await gateway.call("query/payment", { paymentId: "payment-1" });
  await gateway.call("query/payment", { paymentId: "payment-1" });
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, "https://tokenized.sandbox.bka.sh/v2/tokenized-checkout/auth/grant-token");
  assert.deepEqual(requests[0].body, { app_key: "fake-key", app_secret: "fake-secret" });
  assert.equal(requests[0].headers.username, "fake-user");
  assert.equal(requests[1].url.endsWith("/query/payment"), true);
  assert.equal(requests[1].headers.Authorization, "Bearer fake-id-token");
  assert.equal(requests[1].headers["X-App-Key"], "fake-key");
  assert.equal(requests[1].headers.password, undefined);
  assert.deepEqual(requests[1].body, { paymentId: "payment-1" });
});
test("a near-expiry token is refreshed using the persisted refresh token", async () => {
  cached = { idToken: "old", refreshToken: "old-refresh", expiresAt: new Date(Date.now() + 60000), refreshExpiresAt: new Date(Date.now() + 86400000), lockUntil: new Date(0), nextAttemptAt: new Date(0) };
  await gateway.call("query/payment", { paymentId: "payment-1" });
  assert.equal(requests[0].url.endsWith("/auth/refresh-token"), true);
  assert.equal(requests[0].body.refresh_token, "old-refresh");
  assert.equal(cached.idToken, "fake-id-token");
});
test("an authentication failure triggers cooldown instead of repeatedly exhausting token quota", async () => {
  globalThis.fetch.mock.mockImplementation(async () => {
    requests.push({ auth: true }); return { ok: false, json: async () => ({ statusCode: "9999", statusMessage: "private detail" }) };
  });
  await assert.rejects(gateway.call("query/payment", { paymentId: "payment-1" }), { status: 502 });
  await assert.rejects(gateway.call("query/payment", { paymentId: "payment-1" }), { status: 503 });
  assert.equal(requests.length, 1);
});
test("a second instance reuses the still-valid token while another refreshes", async () => {
  cached = { idToken: "existing", expiresAt: new Date(Date.now() + 120000), lockUntil: new Date(Date.now() + 40000), nextAttemptAt: new Date(Date.now() + 60000) };
  await gateway.call("query/payment", { paymentId: "payment-1" });
  assert.equal(requests.length, 1); assert.equal(requests[0].headers.Authorization, "Bearer existing");
});
