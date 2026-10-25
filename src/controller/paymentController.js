const crypto = require("crypto");
const mongoose = require("mongoose");
const createError = require("http-errors");
const Order = require("../model/Order");
const bkash = require("../services/bkash");
const orderController = require("./orderController");

const equalSecret = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const loadOrder = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw createError(400, "Invalid order id");
  const order = await Order.findById(id).select("+invoiceAccessToken +bkash.signature +bkash.callbackToken +bkash.lockId");
  if (!order) throw createError(404, "Order not found");
  return order;
};

const authorize = (order, req) => {
  if (!equalSecret(order.invoiceAccessToken, req.body?.token) && req.role !== "admin" &&
      !(req.id && String(order.user) === req.id)) throw createError(403, "Valid order access is required");
};

const acquire = async (order) => {
  const lockId = crypto.randomUUID();
  const claimed = await Order.findOneAndUpdate({
    _id: order._id, paymentMethod: "bKash", status: "Awaiting Payment",
    $or: [{ "bkash.lockUntil": { $lte: new Date() } }, { "bkash.lockUntil": null }],
  }, { $set: { "bkash.lockUntil": new Date(Date.now() + 120000), "bkash.lockId": lockId } }, { new: true });
  if (!claimed) throw createError(409, "Payment is being checked or the order is no longer payable. Please refresh shortly.");
  return lockId;
};

const release = (order, lockId) => Order.updateOne(
  { _id: order._id, "bkash.lockId": lockId }, { $set: { "bkash.lockUntil": new Date(0) }, $unset: { "bkash.lockId": "" } }
);

const confirm = async (order, result) => {
  bkash.validateCompletedPayment(order, result);
  const updated = await Order.findOneAndUpdate({
    _id: order._id, "bkash.paymentId": result.paymentId, status: "Awaiting Payment", paidAmount: 0,
  }, { $set: {
    paidAmount: order.paymentAmount,
    paymentStatus: order.paymentAmount >= order.payableAmount ? "Paid" : "Partially Paid",
    paymentVerifiedAt: new Date(), status: "Pending", "items.$[].status": "Pending",
    "bkash.transactionId": result.trxId, "bkash.senderNumber": result.payerAccount,
  } }, { new: true, runValidators: true });
  if (updated) orderController.queueOrderEmails(await orderController.findPopulatedOrderById(order._id, { includeInvoiceToken: true }));
};

const respondOrder = async (res, order) => {
  const populated = await orderController.findPopulatedOrderById(order._id, { includeInvoiceToken: true });
  res.set("Cache-Control", "no-store");
  return res.status(200).json({ order: orderController.prepareOrderForResponse(populated, {}, { includeInvoiceToken: true }) });
};

const initiateBkashPayment = async (req, res, next) => {
  let order, lockId;
  try {
    bkash.getConfig();
    order = await loadOrder(req.params.id);
    authorize(order, req);
    if (order.paymentMethod !== "bKash") throw createError(400, "This order does not use bKash");
    if (order.paidAmount > 0) return respondOrder(res, order);
    lockId = await acquire(order);
    // Reload after acquiring the shared lease to avoid acting on a stale payment ID.
    order = await loadOrder(order._id);
    if (order.bkash?.paymentId) {
      const result = await bkash.call("query/payment", { paymentId: order.bkash.paymentId });
      if (result.transactionStatus === "Completed") {
        await confirm(order, result);
        return respondOrder(res, order);
      }
      if (result.transactionStatus !== "Initiated") throw createError(409, "Payment status is unresolved. Check status before retrying.");
      if (!order.bkash.executeStartedAt && order.paymentStatus !== "Failed" &&
          order.bkash.createdAt > new Date(Date.now() - 23 * 60 * 60 * 1000)) {
        return res.status(200).json({ checkoutUrl: order.bkash.checkoutUrl });
      }
    }
    const callbackToken = crypto.randomBytes(32).toString("hex");
    const callback = new URL(bkash.getConfig().callbackUrl);
    callback.searchParams.set("orderId", String(order._id));
    callback.searchParams.set("state", callbackToken);
    const result = await bkash.call("payment/create", {
      payerReference: String(order._id), callbackURL: callback.href,
      amount: order.paymentAmount.toFixed(2), currency: "BDT", intent: "sale",
      merchantInvoiceNumber: String(order.orderNumber),
    });
    const checkoutUrl = result.bkashURL || result.bKashURL;
    if (!result.paymentId || !result.signature || !bkash.isCheckoutUrl(checkoutUrl)) {
      throw createError(502, "bKash did not return a valid payment session");
    }
    await Order.updateOne({ _id: order._id, "bkash.lockId": lockId }, { $set: {
      "bkash.paymentId": result.paymentId, "bkash.checkoutUrl": checkoutUrl,
      "bkash.signature": result.signature, "bkash.callbackToken": callbackToken,
      "bkash.executeStartedAt": null, "bkash.createdAt": new Date(), paymentStatus: "Pending",
    } });
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ checkoutUrl });
  } catch (error) { next(error); }
  finally { if (order && lockId) await release(order, lockId); }
};

const bkashCallback = async (req, res, next) => {
  let order, lockId;
  try {
    order = await loadOrder(req.query.orderId);
    if (!equalSecret(order.bkash?.callbackToken, req.query.state) ||
        !equalSecret(order.bkash?.signature, req.query.signature) ||
        order.bkash.paymentId !== (req.query.paymentID || req.query.paymentId)) {
      throw createError(403, "Invalid bKash payment callback");
    }
    if (order.paidAmount === 0) {
      lockId = await acquire(order);
      order = await loadOrder(order._id);
      if (!equalSecret(order.bkash.callbackToken, req.query.state) || order.bkash.paymentId !== (req.query.paymentID || req.query.paymentId)) {
        throw createError(409, "This payment session has been replaced. Please use the latest payment link.");
      }
      // A payment ID must never be executed twice, even after a network timeout.
      let result;
      if (req.query.status === "success" && !order.bkash.executeStartedAt) {
        await Order.updateOne({ _id: order._id, "bkash.lockId": lockId }, { $set: { "bkash.executeStartedAt": new Date() } });
        try { result = await bkash.call("payment/execute", { paymentId: order.bkash.paymentId }); }
        catch { /* Query below reconciles a timeout or an already-completed execute. */ }
      }
      if (!result || result.transactionStatus !== "Completed") {
        result = await bkash.call("query/payment", { paymentId: order.bkash.paymentId });
      }
      if (result.transactionStatus === "Completed") await confirm(order, result);
      else if (["cancel", "failure"].includes(req.query.status) && result.transactionStatus === "Initiated") {
        await Order.updateOne({ _id: order._id, "bkash.lockId": lockId, paidAmount: 0 }, { $set: { paymentStatus: "Failed" } });
      }
    }
    const url = new URL("/order-success", bkash.getConfig().storefrontUrl);
    // A fragment keeps the access token out of server access logs and referrers.
    url.hash = new URLSearchParams({ orderId: String(order._id), token: order.invoiceAccessToken }).toString();
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    return res.redirect(303, url.href);
  } catch (error) {
    // After authenticating the callback, always return the customer to a recoverable status page.
    if (order && equalSecret(order.bkash?.callbackToken, req.query.state) && equalSecret(order.bkash?.signature, req.query.signature)) {
      const url = new URL("/order-success", bkash.getConfig().storefrontUrl);
      url.hash = new URLSearchParams({ orderId: String(order._id), token: order.invoiceAccessToken }).toString();
      res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      return res.redirect(303, url.href);
    }
    next(error);
  } finally { if (order && lockId) await release(order, lockId); }
};

const getPaymentStatus = async (req, res, next) => {
  try {
    const order = await loadOrder(req.params.id);
    authorize(order, req);
    if (order.paymentMethod === "bKash" && order.paidAmount === 0 && order.bkash?.paymentId && order.status === "Awaiting Payment") {
      const result = await bkash.call("query/payment", { paymentId: order.bkash.paymentId });
      if (result.transactionStatus === "Completed") await confirm(order, result);
    }
    return respondOrder(res, order);
  } catch (error) { next(error); }
};

module.exports = { initiateBkashPayment, bkashCallback, getPaymentStatus };
