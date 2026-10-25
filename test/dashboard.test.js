const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const {
  getDashboardPeriod,
  fillDailySales,
} = require("../src/utils/dashboard");
const { getAdminOverview } = require("../src/controller/dashboardController");
const Order = require("../src/model/Order");
const Product = require("../src/model/Product");
const User = require("../src/model/Users");

afterEach(() => mock.restoreAll());

test("today starts at Bangladesh midnight, including a UTC date rollover", () => {
  const period = getDashboardPeriod("today", new Date("2026-10-24T19:15:00Z"));
  assert.equal(period.start.toISOString(), "2026-10-24T18:00:00.000Z");
  assert.equal(period.previousStart.toISOString(), "2026-10-23T18:00:00.000Z");
  assert.equal(period.previousEnd.toISOString(), "2026-10-23T19:15:00.000Z");
});

test("rolling windows include today and compare the same elapsed portion", () => {
  const period = getDashboardPeriod("7d", new Date("2026-10-25T06:00:00Z"));
  assert.equal(period.start.toISOString(), "2026-10-18T18:00:00.000Z");
  assert.equal(period.previousStart.toISOString(), "2026-10-11T18:00:00.000Z");
  assert.equal(period.previousEnd.toISOString(), "2026-10-18T06:00:00.000Z");
  assert.equal(fillDailySales([], period).length, 7);
  assert.equal(
    fillDailySales([], getDashboardPeriod("30d", period.end)).length,
    30,
  );
});

test("month comparisons clip a shorter previous month and handle year boundaries", () => {
  const march = getDashboardPeriod("month", new Date("2026-03-31T06:00:00Z"));
  assert.equal(march.start.toISOString(), "2026-02-28T18:00:00.000Z");
  assert.equal(march.previousStart.toISOString(), "2026-01-31T18:00:00.000Z");
  assert.equal(march.previousEnd.toISOString(), march.start.toISOString());
  const january = getDashboardPeriod("month", new Date("2026-01-03T06:00:00Z"));
  assert.equal(january.previousStart.toISOString(), "2025-11-30T18:00:00.000Z");
  assert.equal(january.previousEnd.toISOString(), "2025-12-03T06:00:00.000Z");
});

test("daily charts fill missing dates without moving Dhaka sales to the UTC day", () => {
  const period = getDashboardPeriod("7d", new Date("2026-10-25T00:00:00Z"));
  const days = fillDailySales(
    [{ _id: "2026-10-20", sales: 850, orders: 2 }],
    period,
  );
  assert.deepEqual(days[0], { date: "2026-10-19", sales: 0, orders: 0 });
  assert.deepEqual(days[1], { date: "2026-10-20", sales: 850, orders: 2 });
  assert.deepEqual(days.at(-1), { date: "2026-10-25", sales: 0, orders: 0 });
});

test("rejects unsupported periods instead of accepting query operators", () => {
  for (const range of ["all", "", { $gt: "" }, ["today"]]) {
    assert.throws(() => getDashboardPeriod(range), { status: 400 });
  }
});

const response = () => ({
  code: 200,
  headers: {},
  body: null,
  status(code) {
    this.code = code;
    return this;
  },
  set(key, value) {
    this.headers[key] = value;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("seller and anonymous requests never query marketplace data", async () => {
  mock.method(Order, "aggregate", () => {
    throw new Error("must not query");
  });
  for (const role of ["seller", undefined]) {
    const res = response();
    await getAdminOverview({ role, query: {} }, res, (error) => {
      throw error;
    });
    assert.equal(res.code, 403);
  }
  assert.equal(Order.aggregate.mock.callCount(), 0);
});

test("an empty store returns complete zero values and no sensitive records", async () => {
  mock.method(Order, "aggregate", async () => []);
  mock.method(Product, "aggregate", async () => []);
  mock.method(User, "aggregate", async () => []);
  const res = response();
  await getAdminOverview(
    { role: "admin", query: { range: "7d" } },
    res,
    (error) => {
      throw error;
    },
  );
  assert.equal(res.code, 200);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.body.current.sales, 0);
  assert.equal(res.body.previous.orders, 0);
  assert.equal(res.body.catalog.outOfStock, 0);
  assert.equal(res.body.sellers.total, 0);
  assert.equal(res.body.daily.length, 7);
  assert.deepEqual(res.body.recentOrders, []);
});

test("database errors reach the error handler without a misleading zero report", async () => {
  const failure = new Error("database unavailable");
  mock.method(Order, "aggregate", async () => {
    throw failure;
  });
  mock.method(Product, "aggregate", async () => []);
  mock.method(User, "aggregate", async () => []);
  const res = response();
  let forwarded;
  await getAdminOverview({ role: "admin", query: {} }, res, (error) => {
    forwarded = error;
  });
  assert.equal(forwarded, failure);
  assert.equal(res.body, null);
});
