const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parse, objectId, assertSafeStructure, sanitizeRichText, safeTargetUrl, escapeRegex } = require("../src/utils/inputSecurity");
const { validateFormFields } = require("../src/utils/formSchemas");
const { contracts } = require("../src/middleware/inputValidation");
const { normalizeImage, normalizePdf } = require("../src/utils/secureForm");
const { createRequestLimiter } = require("../src/middleware/requestLimits");
const { PDFDocument, PDFName, PDFString } = require("pdf-lib");
const sharp = require("sharp");
const id = "507f1f77bcf86cd799439011";

test("IDs and nested input reject selectors, prototype keys, dotted paths and excessive depth", () => {
  for (const value of [{ $ne: null }, [id], 123, null, "bad"]) assert.throws(() => parse(objectId, value), { status: 400 });
  for (const json of ['{"user":{"$where":"x"}}', '{"__proto__":{"admin":true}}', '{"items":[{"constructor":{}}]}', '{"a.b":1}', '{"q[$ne]":"x"}']) assert.throws(() => assertSafeStructure(JSON.parse(json)), { status: 400 });
  let deep = {}; for (let i = 0; i < 10; i++) deep = { next: deep };
  assert.throws(() => assertSafeStructure(deep), { status: 400 });
  assert.equal({}.admin, undefined);
});

test("strict schemas reject extra fields and preserve legitimate Unicode and punctuation", () => {
  const body = { name: "রহিম O'Connor", email: "Seller@Example.com", password: "secure-password" };
  assert.equal(parse(contracts.register.body, body).name, body.name);
  assert.equal(parse(contracts.register.body, body).email, "seller@example.com");
  for (const extra of [{ role: "admin" }, { isVerified: true }, { name: {} }, { name: "<script>" }]) assert.throws(() => parse(contracts.register.body, { ...body, ...extra }), { status: 400 });
});

test("multipart product prices, stock and dimensions reject partial, infinite and coerced values", () => {
  for (const price of ["100abc", "Infinity", "1e309", true, null, [], -1, 0, 0.001, 100000001]) {
    assert.throws(() => validateFormFields("productUpdate", { variants: JSON.stringify([{ price, stock: 1 }]) }), { status: 400 }, String(price));
  }
  for (const stock of ["3.9", "5abc", true, null, 0.5, -1, 1000001]) assert.throws(() => validateFormFields("productUpdate", { variants: JSON.stringify([{ price: 100, stock }]) }), { status: 400 });
  for (const weight of ["10kg", "Infinity", "1e309", "-1", "0"]) assert.throws(() => validateFormFields("productUpdate", { weight }), { status: 400 });
  const valid = validateFormFields("productUpdate", { variants: JSON.stringify([{ price: "120.50", stock: "0", availability: false }]) });
  const row = JSON.parse(valid.variants)[0];
  assert.equal(row.price, 120.5); assert.equal(row.stock, 0); assert.equal(row.availability, false);
});

test("variants may only use declared attribute keys and values", () => {
  const attributes = JSON.stringify([{ name: "Color", values: ["Red", "Blue"] }]);
  const valid = validateFormFields("productUpdate", { attributes, variants: JSON.stringify([{ price: 100, stock: 1, Color: "Red" }]) });
  assert.deepEqual(JSON.parse(valid.variants)[0].attributes, { Color: "Red" });
  for (const extra of [{ Color: "Green" }, { Color: "Red", admin: "yes" }, { attributes: { $ne: "x" } }, {}]) assert.throws(() => validateFormFields("productUpdate", { attributes, variants: JSON.stringify([{ price: 100, stock: 1, ...extra }]) }), { status: 400 });
  assert.throws(() => validateFormFields("productUpdate", { attributes: JSON.stringify([{ name: "__proto__", values: ["x"] }]) }), { status: 400 });
});

test("discount periods require actual calendar dates, both endpoints and a lower discount price", () => {
  for (const extra of [
    { discountPrice: 100 }, { discountPrice: "abc" }, { discountPrice: 10, discountStartDate: "2026-02-30", discountEndDate: "2026-03-02" },
    { discountPrice: 10, discountStartDate: "2026-02-01" }, { discountPrice: 10, discountStartDate: "2026-03-02", discountEndDate: "2026-03-01" },
  ]) assert.throws(() => validateFormFields("productUpdate", { variants: JSON.stringify([{ price: 100, stock: 1, ...extra }]) }), { status: 400 });
});

test("DOMPurify preserves formatting and removes scripts, event handlers, active URLs and embeds", () => {
  const clean = sanitizeRichText('<p>বাংলা <strong>description</strong></p><script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://evil.invalid"></iframe><svg onload=alert(1)></svg><a href="javascript:alert(1)">click</a><p style="background:url(https://evil.invalid)">text</p>');
  assert.match(clean, /<strong>description<\/strong>/);
  assert.doesNotMatch(clean, /<script|onerror|<iframe|<svg|javascript:|style=|<img/i);
  assert.throws(() => validateFormFields("productUpdate", { description: "<script>alert(1)</script>" }), { status: 400 });
});

test("URLs and regex input remain data", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,x", "//evil.invalid", "/\\evil.invalid", "https://user:pass@example.com"]) assert.throws(() => parse(safeTargetUrl, value), { status: 400 });
  assert.equal(parse(safeTargetUrl, "/products"), "/products");
  assert.equal(parse(safeTargetUrl, "https://example.com/sale"), "https://example.com/sale");
  const input = "(a+)+$.*";
  assert.equal(new RegExp("^" + escapeRegex(input) + "$", "i").test(input), true);
  assert.equal(new RegExp("^" + escapeRegex(input) + "$", "i").test("aaaa"), false);
});

test("pagination and banner updates reject zero, negatives, huge limits, duplicates and selectors", () => {
  for (const limit of ["0", "-1", "101", "10abc", ["10", "20"]]) assert.throws(() => parse(contracts.list.query, { limit }), { status: 400 });
  for (const banners of [[{ id: { $ne: null }, priority: 1 }], [{ id, priority: -1 }], [{ id, priority: 0.5 }], [{ id, priority: 1 }, { id, priority: 2 }]]) assert.throws(() => parse(contracts.priorities.body, { banners }), { status: 400 });
});

test("raster uploads require the claimed format and are re-encoded without appended HTML", async () => {
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "red" } }).png().toBuffer();
  const output = await normalizeImage(Buffer.concat([png, Buffer.from("<script>alert(1)</script>")]), "image/png");
  assert.equal((await sharp(output).metadata()).format, "webp");
  assert.equal(output.includes(Buffer.from("<script>")), false);
  await assert.rejects(normalizeImage(Buffer.from("<svg onload=alert(1)>"), "image/png"), { status: 400 });
  await assert.rejects(normalizeImage(png, "image/jpeg"), { status: 400 });
});

test("PDF validation accepts inert pages and rejects active content, invalid data and excessive pages", async () => {
  const pdf = await PDFDocument.create(); pdf.addPage();
  assert.ok((await normalizePdf(Buffer.from(await pdf.save()))).length > 0);
  const action = pdf.context.obj({ S: "JavaScript", JS: PDFString.of("app.alert(1)") });
  pdf.catalog.set(PDFName.of("OpenAction"), pdf.context.register(action));
  await assert.rejects(normalizePdf(Buffer.from(await pdf.save())), { status: 400 });
  await assert.rejects(normalizePdf(Buffer.from("not a PDF")), { status: 400 });
  const large = await PDFDocument.create(); for (let i = 0; i < 11; i++) large.addPage();
  await assert.rejects(normalizePdf(Buffer.from(await large.save())), { status: 400 });
});

test("rate limiting returns Retry-After and fails closed when its shared store is unavailable", async () => {
  const req = { path: "/auth/login", ip: "127.0.0.1", body: { email: "user@example.com" }, is: () => false };
  const headers = {}; const res = { set: (key, value) => { headers[key] = value; } };
  let error;
  await createRequestLimiter(async () => ({ allowed: false, retryAfter: 12 }))(req, res, (err) => { error = err; });
  assert.equal(error.status, 429); assert.equal(headers["Retry-After"], "12");
  await createRequestLimiter(async () => { throw new Error("database down"); })(req, res, (err) => { error = err; });
  assert.equal(error.status, 503);
});

test("rate limit scopes normalize route casing and trailing slashes", async () => {
  const scopes = [];
  await createRequestLimiter(async (scope) => { scopes.push(scope); return { allowed: true }; })(
    { path: "/AUTH/LOGIN/", ip: "127.0.0.1", body: { email: "user@example.com" }, is: () => false }, {}, (error) => assert.equal(error, undefined)
  );
  assert.ok(scopes.includes("auth:/auth/login")); assert.ok(scopes.includes("account:/auth/login"));
});
