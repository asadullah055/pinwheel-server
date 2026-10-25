const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const {
  getSellerOverview,
} = require("../src/controller/sellerDashboardController");
const {
  prepareOrderForResponse,
} = require("../src/controller/orderController");
const User = require("../src/model/Users");
const Product = require("../src/model/Product");
const Order = require("../src/model/Order");

afterEach(() => mock.restoreAll());
const sellerId = "507f1f77bcf86cd799439011";
const otherSeller = "507f1f77bcf86cd799439012";
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
const query = (value) => ({
  select() {
    return this;
  },
  lean: async () => value,
});

test("only seller sessions can request seller reports, before any database reads", async () => {
  mock.method(User, "findOne", () => {
    throw new Error("must not query");
  });
  for (const role of ["admin", undefined, "customer"]) {
    const res = response();
    await getSellerOverview({ role, id: sellerId, query: {} }, res, (error) => {
      throw error;
    });
    assert.equal(res.code, 403);
  }
  assert.equal(User.findOne.mock.callCount(), 0);
});

test("a malformed seller identity never becomes a query operator", async () => {
  mock.method(User, "findOne", () => {
    throw new Error("must not query");
  });
  for (const id of [undefined, "random", { $ne: null }]) {
    const res = response();
    await getSellerOverview({ role: "seller", id, query: {} }, res, (error) => {
      throw error;
    });
    assert.equal(res.code, 401);
  }
  assert.equal(User.findOne.mock.callCount(), 0);
});

test("a deleted or changed-role account cannot read seller aggregates", async () => {
  mock.method(User, "findOne", () => query(null));
  mock.method(Order, "aggregate", () => {
    throw new Error("must not query");
  });
  const res = response();
  await getSellerOverview(
    { role: "seller", id: sellerId, query: {} },
    res,
    (error) => {
      throw error;
    },
  );
  assert.equal(res.code, 403);
  assert.equal(Order.aggregate.mock.callCount(), 0);
});

test("an empty seller shop returns zero values without marketplace payment fields", async () => {
  mock.method(User, "findOne", () =>
    query({
      shopName: "My Shop",
      holidayMode: true,
      isVerified: true,
      bankAccountNumber: "private",
    }),
  );
  mock.method(Product, "find", () => query([]));
  mock.method(Product, "aggregate", async () => []);
  mock.method(Order, "aggregate", async () => []);
  const res = response();
  await getSellerOverview(
    { role: "seller", id: sellerId, query: { sellerId: otherSeller } },
    res,
    (error) => {
      throw error;
    },
  );
  assert.equal(res.code, 200);
  assert.equal(res.body.current.orders, 0);
  assert.equal(res.body.current.deliveredSales, 0);
  assert.equal(res.body.shop.name, "My Shop");
  assert.equal(res.body.shop.holidayMode, true);
  assert.equal(res.body.daily.length, 7);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal("recordedPayments" in res.body.current, false);
  assert.equal("bankAccountNumber" in res.body.shop, false);
  assert.equal(String(User.findOne.mock.calls[0].arguments[0]._id), sellerId);
});

test("seller report failures propagate without showing zero sales", async () => {
  const failure = new Error("database unavailable");
  mock.method(User, "findOne", () => query({ shopName: "Shop" }));
  mock.method(Product, "find", () => query([]));
  mock.method(Product, "aggregate", async () => []);
  mock.method(Order, "aggregate", async () => {
    throw failure;
  });
  const res = response();
  let forwarded;
  await getSellerOverview(
    { role: "seller", id: sellerId, query: {} },
    res,
    (error) => {
      forwarded = error;
    },
  );
  assert.equal(forwarded, failure);
  assert.equal(res.body, null);
});

test("order drilldowns respect recorded seller ownership before current product ownership", () => {
  const order = {
    items: [
      {
        seller: otherSeller,
        product: { creator: sellerId },
        price: 900,
        quantity: 3,
      },
      {
        seller: sellerId,
        product: { creator: otherSeller },
        price: 200,
        quantity: 2,
      },
      { product: { creator: sellerId }, price: 100, quantity: 1 },
    ],
    payableAmount: 5000,
    paidAmount: 4000,
    bkash: { transactionId: "private" },
  };
  const result = prepareOrderForResponse(order, {
    role: "seller",
    id: sellerId,
  });
  assert.equal(result.items.length, 2);
  assert.equal(result.totalAmount, 500);
  assert.equal(result.payableAmount, 500);
  assert.equal(result.paidAmount, undefined);
  assert.equal(result.bkash, undefined);
});
