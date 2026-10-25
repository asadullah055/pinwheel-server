const createError = require("http-errors");

const ADVANCE_AMOUNT = 100;
const getPaymentOptions = () => {
  const enabled = ["BKASH_APP_KEY", "BKASH_APP_SECRET", "BKASH_USERNAME", "BKASH_PASSWORD", "BKASH_CALLBACK_URL", "STOREFRONT_URL"]
    .every((name) => Boolean(process.env[name]?.trim())) && ["sandbox", "live"].includes(process.env.BKASH_ENV);
  return { bkash: { enabled, advanceAmount: ADVANCE_AMOUNT } };
};

const buildOrderPayment = ({ paymentMethod, paymentPlan }, total) => {
  if (paymentMethod === "Cash on Delivery") {
    return { paymentMethod, paymentPlan: "COD", paymentStatus: "Pending", paymentAmount: 0, paidAmount: 0 };
  }
  if (paymentMethod !== "bKash") {
    throw createError(400, "Choose Cash on Delivery or bKash payment");
  }
  const options = getPaymentOptions().bkash;
  if (!options.enabled) throw createError(503, "bKash payment is currently unavailable");
  if (!["Full", "Advance"].includes(paymentPlan)) {
    throw createError(400, "Choose full payment or advance payment");
  }
  if (paymentPlan === "Advance" && total < ADVANCE_AMOUNT) {
    throw createError(400, "Advance payment requires an order total of at least Tk 100. Choose full payment.");
  }
  return {
    paymentMethod, paymentPlan, paymentAmount: paymentPlan === "Advance" ? ADVANCE_AMOUNT : total,
    paidAmount: 0, paymentStatus: "Pending", status: "Awaiting Payment",
  };
};

module.exports = { ADVANCE_AMOUNT, getPaymentOptions, buildOrderPayment };
