const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { buildInvoicePdf } = require("../src/utils/invoice");

test("serverless invoices pass resolved browser arguments to Puppeteer", async (t) => {
  const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
    import("@sparticuz/chromium"),
    import("puppeteer-core"),
  ]);
  const previousVercel = process.env.VERCEL;
  t.after(() => {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  });
  process.env.VERCEL = "1";
  // Exercise the production branch even when Chrome is installed locally.
  t.mock.method(fs, "existsSync", () => false);
  t.mock.method(chromium, "executablePath", async () => "/tmp/chromium");

  const pdf = Buffer.from("%PDF-1.7\nserverless invoice");
  const close = t.mock.fn(async () => {});
  const page = {
    setContent: t.mock.fn(async () => {}),
    evaluate: async () => {},
    emulateMediaType: async () => {},
    pdf: t.mock.fn(async () => pdf),
  };
  const launch = t.mock.method(puppeteer, "launch", async (options) => {
    // Use Puppeteer's actual argument parser, which threw options.filter when
    // the serverless launch options contained an unresolved Promise.
    const args = await puppeteer.defaultArgs(options);
    assert.ok(args.includes("--no-sandbox"));
    assert.ok(args.includes("--headless"));
    assert.ok(Array.isArray(options.args));
    assert.ok(options.args.every((arg) => typeof arg === "string"));
    assert.equal(options.executablePath, "/tmp/chromium");
    assert.equal(options.headless, "shell");
    return { newPage: async () => page, close };
  });

  assert.deepEqual(await buildInvoicePdf({ items: [] }), pdf);
  assert.equal(launch.mock.callCount(), 1);
  assert.match(page.setContent.mock.calls[0].arguments[0], /<!DOCTYPE html>/i);
  assert.equal(page.pdf.mock.calls[0].arguments[0].format, "A4");
  assert.equal(close.mock.callCount(), 1);
});
