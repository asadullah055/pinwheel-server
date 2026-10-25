const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

// No production credentials or services are used by this suite.
const replaceModule = (name, exports) => {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
replaceModule("../secret", { accessSecretKey: "local-security-access-secret", refreshSecretKey: "local-security-refresh-secret" });
replaceModule("../src/config/db", async () => {});
let emails = [];
let emailFailure = false;
let allowUploads = false;
let uploadCalls = [];
replaceModule("../src/utils/sendEmail", { sendEmail: async (mail) => {
  if (emailFailure) throw new Error("Simulated SMTP failure");
  emails.push(mail);
} });
replaceModule("../src/helper/cloudinary", {
  uploadToCloudinary: async (path) => {
    if (!allowUploads) throw new Error("External uploads disabled in tests");
    const image = await require("fs/promises").readFile(path);
    uploadCalls.push({ path, image });
    const publicId = "products/" + new mongoose.Types.ObjectId();
    return { public_id: publicId, secure_url: "https://res.cloudinary.com/test/image/upload/" + publicId + ".webp" };
  },
  deleteFromCloudinary: async () => { throw new Error("External deletions disabled in tests"); },
  getCloudinaryUploadSignature: () => { throw new Error("External signatures disabled in tests"); },
});
replaceModule("../src/utils/invoice", {
  buildInvoicePdf: async () => Buffer.from("local invoice"),
  buildInvoiceEmailHtml: () => "local invoice", buildSellerOrderEmailHtml: () => "local order",
});
const app = require("../app");
const Users = require("../src/model/Users");
const Product = require("../src/model/Product");
const Order = require("../src/model/Order");
const Banner = require("../src/model/Banner");
const Brand = require("../src/model/Brand");
const Category = require("../src/model/Category");
const UploadAsset = require("../src/model/UploadAsset");
const RequestLimit = require("../src/model/RequestLimit");
const { generateAccessToken, generateRefreshToken } = require("../src/utils/generateToken");
const { hashOtp } = require("../src/utils/authSecurity");
const bcrypt = require("bcryptjs");
let repl, server, base;
before(async () => {
  repl = await MongoMemoryReplSet.create({ binary: { version: "7.0.24" }, replSet: { count: 1 } });
  await mongoose.connect(repl.getUri(), { dbName: "cartout_security_tests" });
  await Promise.all([Users.init(), Product.init(), Order.init(), UploadAsset.init(), RequestLimit.init()]);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}, { timeout: 180000 });
after(async () => {
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  await mongoose.disconnect();
  if (repl) await repl.stop();
});
beforeEach(async () => {
  await Promise.all([Users, Product, Order, Banner, Brand, Category, UploadAsset, RequestLimit].map((model) => model.deleteMany({})));
  emails = []; emailFailure = false;
  allowUploads = false; uploadCalls = [];
});
const user = (extra = {}) => Users.create({ name: "Local seller", email: "seller@example.invalid", password: "old-password-123", ...extra });
const cookie = async (account) => `accessToken=${await generateAccessToken(account)}`;
const request = (url, body, headers = {}, method = "POST") => fetch(base + url, {
  method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});
const read = (url, auth) => fetch(base + url, { headers: auth ? { Cookie: auth } : {} });
const makeProduct = (owner, extra = {}) => Product.create({ productName: "Local product", description: "Description", creator: owner._id,
  sku: new mongoose.Types.ObjectId().toString(), status: "published", variants: [{ sku: "SKU-1", price: 100, stock: 5 }], ...extra });
const makeOrder = (owner, products, extra = {}) => Order.create({
  sellers: [owner._id], items: products.map((product) => ({ product: product._id, seller: owner._id,
    variant: product.variants[0]._id, quantity: 1, price: 100, stockAdjusted: false, status: "Cancelled" })),
  status: "Cancelled", totalAmount: products.length * 100, payableAmount: products.length * 100,
  shippingAddress: { fullAddress: "Dhaka" }, paymentMethod: "Cash on Delivery", ...extra,
});
const edit = (id, form, auth) => fetch(base + "/api/product/" + id, { method: "PUT", headers: { Cookie: auth }, body: form });

test("registration rejects an injected admin role and valid registration returns no password", async () => {
  const attack = { name: "Attacker", email: "new@example.invalid", password: "test-password-123", role: "admin" };
  assert.equal((await request("/api/auth/register", attack)).status, 400);
  assert.equal(await Users.countDocuments(), 0);
  const response = await request("/api/auth/register", { ...attack, role: "seller" });
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.user.role, "seller"); assert.equal(data.user.password, undefined);
  const saved = await Users.findOne({ email: "new@example.invalid" }).select("+password");
  assert.equal(saved.role, "seller"); assert.ok(await bcrypt.compare("test-password-123", saved.password));
});
test("legacy mixed-case emails still log in and cannot be registered twice", async () => {
  await user({ email: "Legacy@Example.invalid" });
  assert.equal((await request("/api/auth/login", { email: "legacy@example.invalid", password: "old-password-123" })).status, 200);
  assert.equal((await request("/api/auth/register", { email: "LEGACY@example.invalid", name: "Duplicate", password: "test-password-123" })).status, 409);
});
test("login rejects query objects and missing passwords as invalid input", async () => {
  assert.equal((await request("/api/auth/login", { email: { $ne: null }, password: "test-password" })).status, 400);
  assert.equal((await request("/api/auth/login", { email: "user@example.invalid" })).status, 400);
});
test("seller edits are denied for another owner's product, and owner edits succeed", async () => {
  const owner = await user(), other = await user({ email: "other@example.invalid" });
  const product = await makeProduct(owner);
  const form = new FormData(); form.set("description", "Changed");
  assert.equal((await edit(product._id, form, await cookie(other))).status, 403);
  assert.equal((await Product.findById(product._id)).description, "Description");
  assert.equal((await edit(product._id, form, await cookie(owner))).status, 200);
  assert.equal((await Product.findById(product._id)).description, "Changed");
});
test("drafts are hidden publicly and managed drafts require owner or admin", async () => {
  const owner = await user(), other = await user({ email: "other@example.invalid" });
  const product = await makeProduct(owner, { status: "unpublished" });
  assert.equal((await read("/api/product/" + product._id)).status, 404);
  assert.equal((await read("/api/product/manage/" + product._id)).status, 401);
  assert.equal((await read("/api/product/manage/" + product._id, await cookie(other))).status, 403);
  assert.equal((await read("/api/product/manage/" + product._id, await cookie(owner))).status, 200);
});
test("public cards return only listing data and keep pagination, search and visibility correct", async () => {
  const owner = await user();
  const product = await makeProduct(owner, {
    productName: "Visible card", description: "Searchable detail " + "x".repeat(10000),
    images: ["https://res.cloudinary.com/test/image/upload/one.webp", "https://res.cloudinary.com/test/image/upload/two.webp"],
    variants: [{ sku: "CARD", price: 150, stock: 3, attributes: { Color: "Red" }, discountPrice: 100 }],
  });
  await makeProduct(owner, { productName: "Out of stock card", variants: [{ sku: "EMPTY", price: 100, stock: 0 }] });
  await makeProduct(owner, { productName: "Hidden draft", status: "unpublished" });
  await makeProduct(owner, { productName: "Unavailable card", variants: [{ sku: "OFF", price: 100, stock: 1, availability: false }] });

  const response = await read("/api/product/publicProducts?page=1&limit=10");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.totalProducts, 2);
  assert.equal(data.products.length, 2);
  const card = data.products.find((row) => row._id === String(product._id));
  assert.equal(card.description, undefined);
  assert.equal(card.shortDescription, undefined);
  assert.equal(card.creator.email, undefined);
  assert.deepEqual(card.images, [product.images[0]]);
  assert.equal(card.creator._id, String(owner._id));
  assert.equal(card.variants[0]._id, String(product.variants[0]._id));
  assert.equal(card.variants[0].attributes.Color, "Red");
  assert.equal(card.variants[0].discountPrice, 100);
  assert.ok(Buffer.byteLength(JSON.stringify(data)) < 4000);

  const first = await (await read("/api/product/publicProducts?page=1&limit=1")).json();
  const second = await (await read("/api/product/publicProducts?page=2&limit=1")).json();
  assert.notEqual(first.products[0]._id, second.products[0]._id);
  const empty = await (await read("/api/product/publicProducts?page=3&limit=1")).json();
  assert.equal(empty.products.length, 0);
  assert.equal(empty.totalProducts, 2);
  assert.equal(empty.totalPages, 2);
  const search = await (await read("/api/product/publicProducts?search=Searchable")).json();
  assert.equal(search.products[0]._id, String(product._id));
  const detail = await (await read("/api/product/" + product._id)).json();
  assert.equal(detail.product.description, product.description);
  assert.equal(detail.product.images.length, 2);
});

test("password change hashes the password and revokes old access and refresh tokens", async () => {
  const account = await user(); const oldCookie = await cookie(account);
  const refreshCookie = `refreshToken=${await generateRefreshToken(account)}`;
  const response = await request("/api/auth/update-password", { oldPassword: "old-password-123", newPassword: "new-password-456", confirmPassword: "new-password-456" }, { Cookie: oldCookie }, "PUT");
  assert.equal(response.status, 200);
  const saved = await Users.findById(account._id).select("+password +tokenVersion");
  assert.ok(await bcrypt.compare("new-password-456", saved.password)); assert.equal(saved.tokenVersion, 1);
  assert.equal((await read("/api/auth/profile", oldCookie)).status, 401);
  assert.equal((await read("/api/auth/refresh", refreshCookie)).status, 401);
  assert.equal((await request("/api/auth/login", { email: account.email, password: "new-password-456" })).status, 200);
});
test("profile updates cannot bypass the old-password requirement", async () => {
  const account = await user();
  assert.equal((await request("/api/auth/update-profile", { password: "bypass-password" }, { Cookie: await cookie(account) }, "PUT")).status, 400);
  assert.equal((await request("/api/auth/update-profile", { name: "Updated name" }, { Cookie: await cookie(account) }, "PUT")).status, 200);
});
test("logout invalidates copied access and refresh tokens", async () => {
  const account = await user(); const auth = await cookie(account);
  const refresh = `refreshToken=${await generateRefreshToken(account)}`;
  assert.equal((await request("/api/auth/logout", {}, { Cookie: auth })).status, 200);
  assert.equal((await read("/api/auth/profile", auth)).status, 401);
  assert.equal((await read("/api/auth/refresh", refresh)).status, 401);
});
test("refresh succeeds without disclosing the access JWT in its response", async () => {
  const account = await user();
  const response = await read("/api/auth/refresh", `refreshToken=${await generateRefreshToken(account)}`);
  assert.equal(response.status, 200); assert.equal((await response.json()).accessToken, undefined);
  assert.ok(response.headers.getSetCookie().some((c) => c.startsWith("accessToken=")));
});
test("account removal and role changes are checked by access middleware", async () => {
  const account = await user({ role: "admin" }), auth = await cookie(account);
  await Users.updateOne({ _id: account._id }, { $set: { role: "seller" } });
  assert.equal((await read("/api/auth/sellers", auth)).status, 403);
  await Users.deleteOne({ _id: account._id });
  assert.equal((await read("/api/auth/profile", auth)).status, 401);
});
test("untrusted preview origins cannot read CORS responses or submit mutations", async () => {
  const origin = "https://pinwheel-dash-attacker-controlled.vercel.app";
  const preflight = await fetch(base + "/api/auth/profile", { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET" } });
  assert.equal(preflight.headers.get("access-control-allow-origin"), null);
  assert.equal((await request("/api/auth/register", {}, { Origin: origin })).status, 403);
  const trusted = await fetch(base, { headers: { Origin: "https://pinwheel-dash.vercel.app" } });
  assert.equal(trusted.headers.get("access-control-allow-origin"), "https://pinwheel-dash.vercel.app");
});
test("password reset sends a hashed, purpose-bound, single-use OTP and revokes sessions", async () => {
  const account = await user(); const auth = await cookie(account);
  assert.equal((await request("/api/auth/forgot-password", { email: account.email })).status, 200);
  assert.equal(emails.length, 1);
  const otp = emails[0].html.match(/<strong>(\d{6})<\/strong>/)[1];
  const saved = await Users.findById(account._id).select("+otp");
  assert.equal(saved.otp, hashOtp(otp)); assert.equal(saved.otpPurpose, "reset-password");
  assert.equal((await request("/api/auth/verify-otp", { email: account.email, otp })).status, 400);
  assert.equal((await request("/api/auth/forgot-password", { email: account.email })).status, 429);
  const payload = { email: account.email, otp, newPassword: "reset-password-123" };
  assert.equal((await request("/api/auth/reset-password", payload)).status, 200);
  assert.equal((await request("/api/auth/reset-password", payload)).status, 400);
  assert.equal((await read("/api/auth/profile", auth)).status, 401);
  assert.ok(await bcrypt.compare(payload.newPassword, (await Users.findById(account._id).select("+password")).password));
});
test("email OTP body is verified, cannot reset passwords, and cannot be replayed", async () => {
  const account = await user();
  assert.equal((await request("/api/auth/send-otp", { email: account.email })).status, 200);
  const otp = emails[0].html.match(/<strong>(\d{6})<\/strong>/)[1];
  assert.equal((await request("/api/auth/reset-password", { email: account.email, otp, newPassword: "test-password-123" })).status, 400);
  assert.equal((await request("/api/auth/verify-otp", { email: account.email, otp })).status, 200);
  assert.equal((await Users.findById(account._id)).isVerified, true);
  assert.equal((await request("/api/auth/verify-otp", { email: account.email, otp })).status, 400);
});
test("five wrong codes exhaust the challenge, and expired codes are rejected", async () => {
  const account = await user();
  await Users.updateOne({ _id: account._id }, { $set: { otp: hashOtp("123456"), otpPurpose: "reset-password", otpAttempts: 0, otpExpires: new Date(Date.now() + 60000) } });
  for (let i = 0; i < 5; i++) assert.equal((await request("/api/auth/reset-password", { email: account.email, otp: "999999", newPassword: "test-password-123" })).status, 400);
  assert.equal((await request("/api/auth/reset-password", { email: account.email, otp: "123456", newPassword: "test-password-123" })).status, 400);
  await Users.updateOne({ _id: account._id }, { $set: { otpAttempts: 0, otpExpires: new Date(Date.now() - 1000) } });
  assert.equal((await request("/api/auth/reset-password", { email: account.email, otp: "123456", newPassword: "test-password-123" })).status, 400);
});
test("SMTP failure is reported and does not leave a usable OTP", async () => {
  const account = await user(); emailFailure = true;
  assert.equal((await request("/api/auth/forgot-password", { email: account.email })).status, 503);
  assert.equal((await Users.findById(account._id).select("+otp")).otp, null);
});
test("failed multi-product reactivation rolls back every inventory write", async () => {
  const admin = await user({ role: "admin" });
  const first = await makeProduct(admin), second = await makeProduct(admin, { productName: "Empty product", variants: [{ sku: "SKU-2", price: 100, stock: 0 }] });
  const order = await makeOrder(admin, [first, second]);
  const response = await request(`/api/order/${order._id}/status`, { status: "Pending" }, { Cookie: await cookie(admin) }, "PATCH");
  assert.equal(response.status, 400);
  assert.equal((await Product.findById(first._id)).variants[0].stock, 5);
  assert.equal((await Order.findById(order._id)).status, "Cancelled");
});
test("failure saving an order rolls back the stock restoration", async (context) => {
  const admin = await user({ role: "admin" }), product = await makeProduct(admin);
  const order = await makeOrder(admin, [product], { status: "Pending", items: [{ product: product._id, seller: admin._id,
    variant: product.variants[0]._id, quantity: 1, price: 100, stockAdjusted: true, status: "Pending" }] });
  context.mock.method(Order.prototype, "save", async () => { throw new Error("Simulated order write failure"); });
  const response = await request(`/api/order/${order._id}/status`, { status: "Cancelled" }, { Cookie: await cookie(admin) }, "PATCH");
  assert.equal(response.status, 500);
  assert.equal((await Product.findById(product._id)).variants[0].stock, 5);
  assert.equal((await Order.findById(order._id)).status, "Pending");
});
test("concurrent cancellations restore stock once; reactivation reserves it once", async () => {
  const admin = await user({ role: "admin" }), product = await makeProduct(admin);
  const order = await makeOrder(admin, [product], { status: "Pending", items: [{ product: product._id, seller: admin._id, variant: product.variants[0]._id, quantity: 1, price: 100, stockAdjusted: true, status: "Pending" }] });
  const auth = await cookie(admin);
  const results = await Promise.all([1, 2].map(() => request(`/api/order/${order._id}/status`, { status: "Cancelled" }, { Cookie: auth }, "PATCH")));
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.equal((await Product.findById(product._id)).variants[0].stock, 6);
  assert.equal((await request(`/api/order/${order._id}/status`, { status: "Pending" }, { Cookie: auth }, "PATCH")).status, 200);
  assert.equal((await Product.findById(product._id)).variants[0].stock, 5);
});
test("seller item cancellation is scoped and idempotent", async () => {
  const owner = await user(), other = await user({ email: "other@example.invalid" }), product = await makeProduct(owner);
  const order = await makeOrder(owner, [product], { status: "Pending", items: [{ product: product._id, seller: owner._id, variant: product.variants[0]._id, quantity: 1, price: 100, stockAdjusted: true, status: "Pending" }] });
  const url = `/api/order/${order._id}/items/${order.items[0]._id}/status`;
  assert.equal((await request(url, { status: "Cancelled" }, { Cookie: await cookie(other) }, "PATCH")).status, 403);
  const auth = await cookie(owner);
  const responses = await Promise.all([1, 2].map(() => request(url, { status: "Cancelled" }, { Cookie: auth }, "PATCH")));
  assert.deepEqual(responses.map((r) => r.status), [200, 200]);
  assert.equal((await Product.findById(product._id)).variants[0].stock, 6);
});
test("product edits preserve existing variant IDs and retain removed variants for order references", async () => {
  const account = await user(), product = await makeProduct(account);
  const originalId = String(product.variants[0]._id);
  const form = new FormData(); form.set("variants", JSON.stringify([{ sku: "SKU-1", price: 120, stock: 5 }]));
  assert.equal((await edit(product._id, form, await cookie(account))).status, 200);
  assert.equal(String((await Product.findById(product._id)).variants[0]._id), originalId);
  const removed = new FormData(); removed.set("variants", JSON.stringify([{ sku: "NEW-SKU", price: 80, stock: 2 }]));
  assert.equal((await edit(product._id, removed, await cookie(account))).status, 200);
  const retained = (await Product.findById(product._id)).variants.id(originalId);
  assert.ok(retained); assert.equal(retained.availability, false);
});
test("foreign variant IDs and stale product snapshots cannot overwrite inventory", async () => {
  const account = await user(), product = await makeProduct(account);
  const form = new FormData(); form.set("variants", JSON.stringify([{ _id: new mongoose.Types.ObjectId(), sku: "BAD", price: 100, stock: 5 }]));
  assert.equal((await edit(product._id, form, await cookie(account))).status, 400);
  const stale = await Product.findById(product._id);
  await Product.updateOne({ _id: product._id, "variants._id": product.variants[0]._id }, { $inc: { "variants.$.stock": -1, __v: 1 } });
  stale.description = "Stale update";
  await assert.rejects(stale.save(), { name: "VersionError" });
  assert.equal((await Product.findById(product._id)).variants[0].stock, 4);
});
test("legacy products without a version field are initialized before editing", async () => {
  const account = await user(), product = await makeProduct(account);
  await Product.collection.updateOne({ _id: product._id }, { $unset: { __v: "" } });
  const form = new FormData(); form.set("description", "Edited legacy product");
  assert.equal((await edit(product._id, form, await cookie(account))).status, 200);
  const saved = await Product.findById(product._id);
  assert.ok(Number.isInteger(saved.__v)); assert.equal(saved.description, "Edited legacy product");
});
test("quick updates reject NoSQL selectors for product and variant IDs", async () => {
  const owner = await user(), other = await user({ email: "victim@example.invalid" });
  const own = await makeProduct(owner), victim = await makeProduct(other);
  const headers = { Cookie: await cookie(owner) };
  const attack = { id: { $ne: null }, variants: [{ _id: String(victim.variants[0]._id), price: 1 }] };
  assert.equal((await request("/api/product/updatePrice", attack, headers, "PUT")).status, 400);
  assert.equal((await request("/api/product/updatePrice", { id: String(own._id), variants: [{ _id: { $ne: null }, price: 1 }] }, headers, "PUT")).status, 400);
  assert.equal((await request("/api/product/updatePrice", { id: String(own._id), variants: attack.variants }, headers, "PUT")).status, 400);
  assert.equal((await Product.findById(victim._id)).variants[0].price, 100);
});
test("quick updates validate values before writing and allow an owner's valid update", async () => {
  const owner = await user(), product = await makeProduct(owner);
  const headers = { Cookie: await cookie(owner) };
  for (const values of [{ price: { $gt: 0 } }, { price: -1 }, { stock: -1 }, { stock: 0.5 }, { availability: "true" }]) {
    const response = await request("/api/product/updatePrice", { id: String(product._id), variants: [{ _id: String(product.variants[0]._id), ...values }] }, headers, "PUT");
    assert.equal(response.status, 400);
  }
  const response = await request("/api/product/updatePrice", { id: String(product._id), variants: [{ _id: String(product.variants[0]._id), price: 120, stock: 4 }] }, headers, "PUT");
  assert.equal(response.status, 200);
  const saved = await Product.findById(product._id);
  assert.equal(saved.variants[0].price, 120); assert.equal(saved.variants[0].stock, 4);
});
test("three sequential wrong passwords lock the account for thirty minutes", async () => {
  const account = await user();
  for (let i = 0; i < 3; i++) assert.equal((await request("/api/auth/login", { email: account.email, password: "wrong-password" })).status, 401);
  const saved = await Users.findById(account._id);
  assert.equal(saved.loginAttempts, 3);
  assert.ok(saved.lockUntil > new Date(Date.now() + 29 * 60 * 1000));
  assert.equal((await request("/api/auth/login", { email: account.email, password: "old-password-123" })).status, 403);
});

test("JSON, query and path boundaries reject unexpected fields, selectors and invalid types", async () => {
  const account = await user(), auth = { Cookie: await cookie(account) }, product = await makeProduct(account);
  for (const extra of [{ role: "admin" }, { name: {} }, { name: ["name"] }]) assert.equal((await request("/api/auth/update-profile", { name: "Name", ...extra }, auth, "PUT")).status, 400);
  const pollution = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"email":"x@example.com","password":"password","__proto__":{"admin":true}}' });
  assert.equal(pollution.status, 400); assert.equal({}.admin, undefined);
  for (const query of ["limit=999999", "limit=-1", "page=0", "limit=10&limit=20", "search[$ne]=x", "unexpected=x"]) assert.equal((await read("/api/product/publicProducts?" + query)).status, 400, query);
  assert.equal((await read("/api/product/not-an-id")).status, 400);
  assert.equal((await request("/api/cart/add", { productId: String(product._id), quantity: true }, auth)).status, 400);
  assert.equal((await Users.findById(account._id)).name, "Local seller");
});

test("malformed, oversized and unsupported request bodies return controlled errors", async () => {
  for (const [body, type, status] of [["{", "application/json", 400], [JSON.stringify({ email: "x".repeat(140000) }), "application/json", 413], ["email=x&password=y", "application/x-www-form-urlencoded", 415], ["[]", "application/json", 400]]) {
    const response = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": type }, body });
    assert.equal(response.status, status);
    assert.doesNotMatch((await response.json()).message, /SyntaxError|CastError|stack|MongoServerError/);
  }
  assert.equal((await read("/api/order/invalid")).headers.get("x-content-type-options"), "nosniff");
});

test("banner selector updates are rejected before any write and valid priorities still work", async () => {
  const admin = await user({ role: "admin" });
  const banner = await Banner.create({ bannerType: "main", bannerURL: "https://example.com/a.webp", targetUrl: "/products", priority: 1 });
  const headers = { Cookie: await cookie(admin) };
  for (const banners of [[{ id: { $ne: null }, priority: 0 }], [{ id: String(banner._id), priority: -1 }], [{ id: String(banner._id), priority: 1.5 }]]) assert.equal((await request("/api/banner/update-priority", { banners }, headers, "PATCH")).status, 400);
  assert.equal((await Banner.findById(banner._id)).priority, 1);
  assert.equal((await request("/api/banner/update-priority", { banners: [{ id: String(banner._id), priority: 7 }] }, headers, "PATCH")).status, 200);
  assert.equal((await Banner.findById(banner._id)).priority, 7);
});

test("multipart rejects invalid numbers, unknown/repeated fields and nested operators without writes", async () => {
  const owner = await user(), product = await makeProduct(owner), auth = await cookie(owner);
  for (const fields of [
    { variants: JSON.stringify([{ price: "100abc", stock: 1 }]) }, { variants: JSON.stringify([{ price: "Infinity", stock: 1 }]) },
    { variants: JSON.stringify([{ price: 100, stock: 1.2 }]) }, { variants: '[{"price":100,"stock":1,"attributes":{"$ne":"x"}}]' },
    { role: "admin" }, { attributes: "{}" }, { description: "<script>alert(1)</script>" },
  ]) {
    const form = new FormData(); for (const [key, value] of Object.entries(fields)) form.set(key, value);
    assert.equal((await edit(product._id, form, auth)).status, 400);
  }
  const repeated = new FormData(); repeated.append("productName", "One"); repeated.append("productName", "Two");
  assert.equal((await edit(product._id, repeated, auth)).status, 400);
  const html = new FormData(); html.set("description", '<p>বাংলা <strong>text</strong></p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">link</a>');
  assert.equal((await edit(product._id, html, auth)).status, 200);
  const saved = await Product.findById(product._id);
  assert.match(saved.description, /<strong>text<\/strong>/); assert.doesNotMatch(saved.description, /<script|<img|onerror|javascript:/);
  assert.equal(saved.variants[0].price, 100);
});

const imageForm = (content, type = "image/png") => {
  const form = new FormData(); form.append("image", new Blob([content], { type }), "sample.png"); return form;
};
const upload = (form, auth) => fetch(base + "/api/product/images", { method: "POST", headers: { Cookie: auth }, body: form });

test("upload endpoint rejects fake, oversized and unexpected files before external upload", async () => {
  const account = await user(), auth = await cookie(account); allowUploads = true;
  assert.equal((await upload(imageForm("<script>alert(1)</script>"), auth)).status, 400);
  assert.equal((await upload(imageForm("<svg onload=alert(1)>", "image/svg+xml"), auth)).status, 400);
  assert.equal((await upload(imageForm(Buffer.alloc(500 * 1024 + 1)), auth)).status, 413);
  const unknown = new FormData(); unknown.set("notAnImage", new Blob(["x"], { type: "image/png" }), "x.png");
  assert.equal((await upload(unknown, auth)).status, 400); assert.equal(uploadCalls.length, 0);
});

test("validated uploads are re-encoded, owned and cleaned up; foreign images are rejected", async () => {
  const account = await user(), auth = await cookie(account);
  const png = await require("sharp")({ create: { width: 4, height: 4, channels: 3, background: "red" } }).png().toBuffer();
  allowUploads = true;
  const response = await upload(imageForm(png), auth); assert.equal(response.status, 201);
  const { url } = await response.json();
  assert.equal((await UploadAsset.findOne({ url })).owner.toString(), String(account._id));
  assert.equal((await require("sharp")(uploadCalls[0].image).metadata()).format, "webp");
  await new Promise((resolve) => setTimeout(resolve, 30));
  await assert.rejects(require("fs/promises").access(uploadCalls[0].path));
  assert.equal((await fetch(base + "/api/product/image-signature", { method: "POST", headers: { Cookie: auth } })).status, 410);
  const other = await user({ email: "other@example.invalid" }), product = await makeProduct(other), otherAuth = await cookie(other);
  for (const value of [url, "https://evil.invalid/x.webp", "javascript:alert(1)"]) {
    const form = new FormData(); form.set("existingImages", JSON.stringify([value]));
    assert.equal((await edit(product._id, form, otherAuth)).status, 400);
  }
  const own = await makeProduct(account), form = new FormData(); form.set("existingImages", JSON.stringify([url]));
  assert.equal((await edit(own._id, form, auth)).status, 200);
});

test("product creation escapes regex names and accepts verified owned images", async () => {
  const owner = await user(), auth = await cookie(owner); await makeProduct(owner);
  const category = await Category.create({ name: "Category" }), brand = await Brand.create({ name: "Brand" });
  const url = "https://res.cloudinary.com/test/image/upload/products/owned.webp";
  await UploadAsset.create({ owner: owner._id, url, publicId: "products/owned" });
  const form = new FormData();
  for (const [key, value] of Object.entries({ productName: ".*", description: "<p>Valid product</p>", category: String(category._id), brand: String(brand._id), variants: JSON.stringify([{ price: 100, stock: 2 }]), existingImages: JSON.stringify([url]) })) form.set(key, value);
  const response = await fetch(base + "/api/product/create", { method: "POST", headers: { Cookie: auth }, body: form });
  assert.equal(response.status, 201, JSON.stringify(await response.json()));
});

test("invalid order input cannot reserve stock and checkout retries require their separate secret", async () => {
  const owner = await user(), product = await makeProduct(owner);
  const payload = { items: [{ product: String(product._id), variant: String(product.variants[0]._id), quantity: 1 }], shippingAddress: { fullAddress: "Dhaka" }, shippingFee: 80, paymentMethod: "Cash on Delivery", customer: { name: "Customer", phone: "01700000000", email: "customer@example.com" }, checkoutRequestId: require("crypto").randomUUID(), checkoutAccessToken: "a".repeat(64) };
  for (const extra of [{ paidAmount: 180 }, { customer: { ...payload.customer, name: {} } }, { items: [{ ...payload.items[0], quantity: true }] }, { items: [{ ...payload.items[0], variant: "bad" }] }]) assert.equal((await request("/api/order/create", { ...payload, ...extra })).status, 400);
  assert.equal((await Product.findById(product._id)).variants[0].stock, 5);
  const first = await request("/api/order/create", payload); assert.equal(first.status, 201);
  assert.equal((await first.json()).order.checkoutAccessHash, undefined);
  assert.equal((await request("/api/order/create", { ...payload, checkoutAccessToken: "b".repeat(64) })).status, 403);
  assert.equal((await request("/api/order/create", payload)).status, 200);
  assert.equal((await Product.findById(product._id)).variants[0].stock, 4); assert.equal(await Order.countDocuments(), 1);
});

test("concurrent rate counters share a database window and hash identities", async () => {
  const { consume } = require("../src/middleware/requestLimits");
  const checks = await Promise.all(Array.from({ length: 8 }, () => consume("local-test", "private-identity", 3, 60000)));
  assert.equal(checks.filter((c) => c.allowed).length, 3);
  const row = await RequestLimit.findOne({}); assert.equal(row.count, 8);
  assert.match(row._id, /^[a-f\d]{64}$/); assert.equal(JSON.stringify(row).includes("private-identity"), false);
});

test("upload count and account quotas are enforced before external writes", async () => {
  const owner = await user(), auth = await cookie(owner); allowUploads = true;
  const png = await require("sharp")({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
  const repeated = imageForm(png); repeated.append("image", new Blob([png], { type: "image/png" }), "second.png");
  assert.equal((await upload(repeated, auth)).status, 413);
  const { consume } = require("../src/middleware/requestLimits");
  await Promise.all(Array.from({ length: 120 }, () => consume("account-uploads", String(owner._id), 120, 15 * 60000)));
  const response = await upload(imageForm(png), auth);
  assert.equal(response.status, 429); assert.ok(Number(response.headers.get("Retry-After")) > 0);
  assert.equal(uploadCalls.length, 0);
});

test("valid taxonomy, banner and seller forms remain compatible with strict multipart validation", async () => {
  const owner = await user({ role: "admin" }), auth = await cookie(owner); allowUploads = true;
  const png = await require("sharp")({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
  for (const kind of ["brand", "category"]) {
    const form = new FormData(); form.set("name", "বাংলা " + kind); form.set("image", new Blob([png], { type: "image/png" }), "sample.png");
    const response = await fetch(base + "/api/" + kind + "/create", { method: "POST", headers: { Cookie: auth }, body: form });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
  }
  const banner = new FormData(); banner.set("bannerType", "main"); banner.set("targetUrl", "https://example.com/sale"); banner.set("priority", "0"); banner.set("isActive", "true"); banner.set("bannerImage", new Blob([png], { type: "image/png" }), "sample.png");
  assert.equal((await fetch(base + "/api/banner/create", { method: "POST", headers: { Cookie: auth }, body: banner })).status, 201);
  const profile = new FormData();
  for (const [key, value] of Object.entries({ name: "বাংলা Seller", shopName: "Shop", mobileNumber: "01700000000", shopLocation: "Dhaka", holidayMode: "false", holidayStartDate: "", holidayEndDate: "", nationalIdentityCardNo: "", bankAccountName: "", bankAccountNumber: "", bankNameOrMfs: "", bankRoutingNumber: "", bankBranchName: "" })) profile.set(key, value);
  assert.equal((await fetch(base + "/api/auth/seller-profile", { method: "PUT", headers: { Cookie: auth }, body: profile })).status, 200);
  assert.equal((await Users.findById(owner._id)).shopName, "Shop");
});
