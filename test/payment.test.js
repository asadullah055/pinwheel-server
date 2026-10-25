const { test, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { getPaymentOptions, buildOrderPayment } = require("../src/utils/payment");
const gateway = require("../src/services/bkash");
const Order = require("../src/model/Order");
const Product = require("../src/model/Product");
const orderController = require("../src/controller/orderController");
const paymentController = require("../src/controller/paymentController");

const originalEnv = { ...process.env };
const id = "507f1f77bcf86cd799439011";
let order, calls, emails;

const completed = (overrides = {}) => ({
  paymentId: "pay-123", trxId: "TEST123456", transactionStatus: "Completed",
  amount: "100.00", currency: "BDT", intent: "sale", merchantInvoiceNumber: "1001",
  payerAccount: "01700000000", ...overrides,
});

const setPath = (target, path, value) => {
  if (path === "items.$[].status") { target.items.forEach((item) => { item.status = value; }); return; }
  const keys = path.split(".");
  let node = target;
  for (const key of keys.slice(0, -1)) node = node[key] ??= {};
  node[keys.at(-1)] = value;
};

beforeEach(() => {
  Object.assign(process.env, { BKASH_ENV: "sandbox", BKASH_APP_KEY: "test-key", BKASH_APP_SECRET: "test-secret", BKASH_USERNAME: "test-user", BKASH_PASSWORD: "test-pass", BKASH_CALLBACK_URL: "http://localhost:8000/api/order/bkash/callback", STOREFRONT_URL: "http://localhost:3000" });
  order = {
    _id: id, orderNumber: 1001, invoiceAccessToken: "access-token", paymentMethod: "bKash",
    paymentPlan: "Advance", paymentAmount: 100, payableAmount: 1080, paidAmount: 0,
    paymentStatus: "Pending", status: "Awaiting Payment", items: [{ status: "Awaiting Payment" }],
    bkash: { paymentId: "pay-123", callbackToken: "callback-token", signature: "signature", checkoutUrl: "https://sandbox.payment.bkash.com/test", createdAt: new Date() },
  };
  calls = []; emails = 0;
  mock.method(Order, "findById", () => {
    const query = { select() { return this; }, session() { return this; }, populate() { return this; }, then(resolve, reject) { return Promise.resolve(structuredClone(order)).then(resolve, reject); } };
    return query;
  });
  mock.method(Order, "findOneAndUpdate", async (filter, update) => {
    if (filter.status && order.status !== filter.status) return null;
    if (filter["bkash.paymentId"] && order.bkash.paymentId !== filter["bkash.paymentId"]) return null;
    if (Object.hasOwn(filter, "paidAmount") && order.paidAmount !== filter.paidAmount) return null;
    if (filter.$or && order.bkash.lockUntil > new Date()) return null;
    for (const [path, value] of Object.entries(update.$set || {})) setPath(order, path, value);
    return structuredClone(order);
  });
  mock.method(Order, "updateOne", async (filter, update) => {
    if (filter["bkash.lockId"] && filter["bkash.lockId"] !== order.bkash.lockId) return { modifiedCount: 0 };
    for (const [path, value] of Object.entries(update.$set || {})) setPath(order, path, value);
    for (const path of Object.keys(update.$unset || {})) setPath(order, path, undefined);
    return { modifiedCount: 1 };
  });
  mock.method(orderController, "findPopulatedOrderById", async () => structuredClone(order));
  mock.method(orderController, "queueOrderEmails", () => { emails++; });
  mock.method(gateway, "call", async (path, body) => { calls.push({ path, body }); return completed(); });
});

afterEach(() => {
  mock.restoreAll();
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

const run = async (handler, overrides = {}) => {
  let error;
  const res = { set() { return this; }, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; }, redirect(code, url) { this.code = code; this.url = url; return this; } };
  const req = { params: { id }, body: { token: "access-token" }, query: {}, ...overrides };
  await handler(req, res, (value) => { error = value; });
  return { res, error };
};
const callback = (status = "success") => ({ query: { orderId: id, state: "callback-token", signature: "signature", paymentID: "pay-123", status } });

test("merchant number alone does not enable automatic bKash payments", () => {
  delete process.env.BKASH_APP_KEY;
  process.env.BKASH_MERCHANT_NUMBER = "01700000000";
  assert.equal(getPaymentOptions().bkash.enabled, false);
  assert.throws(() => buildOrderPayment({ paymentMethod: "bKash", paymentPlan: "Full" }, 1080), { status: 503 });
});
test("COD remains available without gateway credentials and ignores supplied paid amount", () => {
  delete process.env.BKASH_APP_KEY;
  assert.deepEqual(buildOrderPayment({ paymentMethod: "Cash on Delivery", paidAmount: 10000 }, 1080), {
    paymentMethod: "Cash on Delivery", paymentPlan: "COD", paymentAmount: 0, paidAmount: 0, paymentStatus: "Pending",
  });
});
test("full payment charges the authoritative total including shipping", () => {
  const result = buildOrderPayment({ paymentMethod: "bKash", paymentPlan: "Full", paymentAmount: 1 }, 1080);
  assert.equal(result.paymentAmount, 1080);
  assert.equal(result.paidAmount, 0);
  assert.equal(result.status, "Awaiting Payment");
});
test("advance is exactly 100 with the rest outstanding", () => {
  const result = buildOrderPayment({ paymentMethod: "bKash", paymentPlan: "Advance" }, 1080);
  assert.equal(result.paymentAmount, 100);
  assert.equal(result.paidAmount, 0);
});
test("advance cannot exceed the order total; full payments below 100 are allowed", () => {
  assert.throws(() => buildOrderPayment({ paymentMethod: "bKash", paymentPlan: "Advance" }, 99), { status: 400 });
  assert.equal(buildOrderPayment({ paymentMethod: "bKash", paymentPlan: "Full" }, 99).paymentAmount, 99);
});
test("unknown methods and plans are rejected", () => {
  assert.throws(() => buildOrderPayment({ paymentMethod: "PayPal" }, 1080), { status: 400 });
  assert.throws(() => buildOrderPayment({ paymentMethod: "bKash", paymentPlan: "Other" }, 1080), { status: 400 });
});
test("production callback URLs require HTTPS", () => {
  process.env.BKASH_ENV = "live";
  assert.throws(() => gateway.getConfig(), { status: 503 });
});
test("only HTTPS bKash checkout URLs are accepted", () => {
  assert.equal(gateway.isCheckoutUrl("https://sandbox.payment.bkash.com/?paymentId=x"), true);
  for (const url of ["javascript:alert(1)", "https://bkash.com.evil.com", "http://sandbox.payment.bkash.com", "https://evil.com"]) assert.equal(gateway.isCheckoutUrl(url), false);
});
for (const [name, value] of Object.entries({ amount: "1.00", currency: "USD", intent: "authorization", paymentId: "another", merchantInvoiceNumber: "1002", transactionStatus: "Initiated", trxId: "" })) {
  test(`completed payment rejects mismatched ${name}`, () => {
    assert.throws(() => gateway.validateCompletedPayment(order, completed({ [name]: value })), { status: 502 });
  });
}
test("query API merchantInvoice field is accepted", () => {
  gateway.validateCompletedPayment(order, completed({ merchantInvoiceNumber: undefined, merchantInvoice: "1001" }));
});
test("forged callbacks cannot execute or credit payments", async () => {
  const request = callback(); request.query.signature = "forged";
  const { error } = await run(paymentController.bkashCallback, request);
  assert.equal(error.status, 403); assert.equal(calls.length, 0); assert.equal(order.paidAmount, 0);
});
test("successful advance callback records 100 and leaves 980 due", async () => {
  const { res, error } = await run(paymentController.bkashCallback, callback());
  assert.equal(error, undefined); assert.equal(res.code, 303);
  assert.equal(order.paidAmount, 100); assert.equal(order.paymentStatus, "Partially Paid");
  assert.equal(order.status, "Pending"); assert.equal(order.items[0].status, "Pending");
  assert.equal(orderController.prepareOrderForResponse(order).dueAmount, 980);
  assert.equal(emails, 1);
  assert.equal(new URL(res.url).search, ""); assert.match(new URL(res.url).hash, /token=access-token/);
});
test("full payment is marked paid with zero outstanding", async () => {
  order.paymentAmount = 1080; order.paymentPlan = "Full";
  gateway.call.mock.mockImplementation(async () => completed({ amount: "1080.00" }));
  await run(paymentController.bkashCallback, callback());
  assert.equal(order.paymentStatus, "Paid"); assert.equal(order.paidAmount, 1080);
  assert.equal(orderController.prepareOrderForResponse(order).dueAmount, 0);
});
test("repeated callbacks do not execute twice or send duplicate emails", async () => {
  await run(paymentController.bkashCallback, callback());
  await run(paymentController.bkashCallback, callback());
  assert.equal(calls.filter((call) => call.path === "payment/execute").length, 1);
  assert.equal(emails, 1);
});
test("execute timeout is reconciled by query; replay never re-executes", async () => {
  gateway.call.mock.mockImplementation(async (path) => {
    calls.push({ path }); if (path === "payment/execute") throw new Error("timeout");
    return completed();
  });
  await run(paymentController.bkashCallback, callback());
  assert.deepEqual(calls.map((call) => call.path), ["payment/execute", "query/payment"]);
  assert.equal(order.paidAmount, 100);
  await run(paymentController.bkashCallback, callback());
  assert.equal(calls.length, 2);
});
test("unresolved execute keeps the order unpaid and recoverable", async () => {
  gateway.call.mock.mockImplementation(async (path) => {
    calls.push({ path }); if (path === "payment/execute") throw new Error("timeout");
    return { paymentId: "pay-123", transactionStatus: "Initiated" };
  });
  const { res } = await run(paymentController.bkashCallback, callback());
  await run(paymentController.bkashCallback, callback());
  assert.equal(res.code, 303); assert.equal(order.paidAmount, 0); assert.equal(emails, 0);
  assert.equal(calls.filter((call) => call.path === "payment/execute").length, 1);
});
test("cancelled and failed verification do not execute or count as paid", async () => {
  gateway.call.mock.mockImplementation(async (path) => { calls.push({ path }); return { transactionStatus: "Initiated" }; });
  await run(paymentController.bkashCallback, callback("cancel"));
  assert.equal(order.paymentStatus, "Failed"); assert.equal(order.paidAmount, 0);
  assert.deepEqual(calls.map((call) => call.path), ["query/payment"]); assert.equal(emails, 0);
});
test("order status cannot be read or paid with an invalid token", async () => {
  const { error } = await run(paymentController.getPaymentStatus, { body: { token: "wrong" } });
  assert.equal(error.status, 403); assert.equal(calls.length, 0);
});
test("status refresh recovers a payment after a lost callback without executing", async () => {
  const { res } = await run(paymentController.getPaymentStatus);
  assert.equal(order.paidAmount, 100); assert.equal(res.body.order.dueAmount, 980);
  assert.deepEqual(calls.map((call) => call.path), ["query/payment"]);
  assert.equal(res.body.order.bkash.signature, undefined);
  assert.equal(res.body.order.bkash.callbackToken, undefined);
  assert.equal(res.body.order.bkash.checkoutUrl, undefined);
});
test("initiation resumes an existing session instead of creating a duplicate", async () => {
  gateway.call.mock.mockImplementation(async (path) => { calls.push({ path }); return { transactionStatus: "Initiated" }; });
  const { res, error } = await run(paymentController.initiateBkashPayment);
  assert.equal(error, undefined); assert.equal(res.body.checkoutUrl, order.bkash.checkoutUrl);
  assert.deepEqual(calls.map((call) => call.path), ["query/payment"]);
});
test("new session uses server amount and configured callback with a random state", async () => {
  order.bkash = {};
  gateway.call.mock.mockImplementation(async (path, body) => {
    calls.push({ path, body });
    return { paymentId: "new-payment", signature: "new-signature", bkashURL: "https://sandbox.payment.bkash.com/new" };
  });
  const { res, error } = await run(paymentController.initiateBkashPayment, { body: { token: "access-token", amount: 1 } });
  assert.equal(error, undefined); assert.equal(res.body.checkoutUrl, "https://sandbox.payment.bkash.com/new");
  assert.equal(calls[0].body.amount, "100.00");
  const callbackUrl = new URL(calls[0].body.callbackURL);
  assert.equal(callbackUrl.searchParams.get("orderId"), id);
  assert.equal(callbackUrl.searchParams.get("state"), order.bkash.callbackToken);
  assert.equal(order.paidAmount, 0);
});
test("a concurrent initiation is blocked by the database lease", async () => {
  order.bkash.lockUntil = new Date(Date.now() + 60000);
  const { error } = await run(paymentController.initiateBkashPayment);
  assert.equal(error.status, 409); assert.equal(calls.length, 0);
});

const orderRequest = () => ({ body: {
  checkoutAccessToken: "a".repeat(64),
  checkoutRequestId: "8c30ab64-6f7e-4c5b-8e16-bc953bdf04df", paymentMethod: "bKash", paymentPlan: "Full", expectedTotal: 1080,
  shippingFee: 80, shippingAddress: { fullAddress: "Dhanmondi, Dhaka" },
  customer: { name: "Customer", phone: "01700000000", email: "customer@example.com" },
  items: [{ product: id, variant: "507f1f77bcf86cd799439013", quantity: 1, price: 1 }], paidAmount: 1080,
} });

const mockProductsForOrder = () => {
  mock.method(Order, "findOne", () => ({ select: async () => null }));
  mock.method(Product, "findById", () => ({ select: async () => ({
    _id: id, creator: "507f1f77bcf86cd799439012", productName: "Test product", status: "published",
    shippingCharge: { insideDhaka: 80, outsideDhaka: 120 },
    variants: [{ _id: "507f1f77bcf86cd799439013", price: 1000, stock: 10, sku: "test-sku", availability: true }],
  }) }));
  mock.method(Product, "updateOne", async () => ({ modifiedCount: 1 }));
  mock.method(Order, "create", async (payload) => {
    order = { ...payload, _id: id, orderNumber: 1001, invoiceAccessToken: "access-token" };
    return order;
  });
};

test("creating an order ignores client prices and paid amounts, reserves stock and awaits bKash", async () => {
  mockProductsForOrder();
  const { res, error } = await run(orderController.createOrder, orderRequest());
  assert.equal(error, undefined); assert.equal(res.code, 201);
  assert.equal(order.totalAmount, 1000); assert.equal(order.payableAmount, 1080);
  assert.equal(order.paymentAmount, 1080); assert.equal(order.paidAmount, 0);
  assert.equal(order.status, "Awaiting Payment"); assert.equal(order.items[0].status, "Awaiting Payment");
  assert.equal(Product.updateOne.mock.callCount(), 1);
  assert.equal(res.body.order.checkoutRequestId, undefined);
});
test("stale displayed totals are rejected before inventory or payment changes", async () => {
  mockProductsForOrder(); const request = orderRequest(); request.body.expectedTotal = 900;
  const { error } = await run(orderController.createOrder, request);
  assert.equal(error.status, 400); assert.equal(Product.updateOne.mock.callCount(), 0); assert.equal(calls.length, 0);
});
test("tampered delivery charges are rejected before inventory changes", async () => {
  mockProductsForOrder(); const request = orderRequest(); request.body.shippingFee = 0;
  const { error } = await run(orderController.createOrder, request);
  assert.equal(error.status, 400); assert.equal(Product.updateOne.mock.callCount(), 0);
});
test("replaying the checkout request returns the same order without reserving stock again", async () => {
  mockProductsForOrder();
  order.checkoutAccessHash = require("crypto").createHash("sha256").update("a".repeat(64)).digest("hex");
  mock.method(Order, "findOne", () => ({ select: async () => structuredClone(order) }));
  const { res, error } = await run(orderController.createOrder, orderRequest());
  assert.equal(error, undefined); assert.equal(res.code, 200);
  assert.equal(Product.findById.mock.callCount(), 0); assert.equal(Product.updateOne.mock.callCount(), 0);
});
test("unpaid gateway orders cannot be moved to fulfillment by admin", async () => {
  mock.method(require("mongoose").connection, "transaction", async (callback) => callback({}));
  const { error } = await run(orderController.updateOrderStatus, { role: "admin", body: { status: "Processing" } });
  assert.equal(error.status, 409); assert.equal(order.status, "Awaiting Payment");
});
