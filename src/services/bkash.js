const crypto = require("crypto");
const createError = require("http-errors");
const PaymentToken = require("../model/PaymentToken");
const { getPaymentOptions } = require("../utils/payment");

const getConfig = () => {
  if (!getPaymentOptions().bkash.enabled) throw createError(503, "bKash payment is currently unavailable");
  const callbackUrl = new URL(process.env.BKASH_CALLBACK_URL);
  const storefrontUrl = new URL(process.env.STOREFRONT_URL);
  for (const url of [callbackUrl, storefrontUrl]) {
    if (url.protocol !== "https:" && !(process.env.BKASH_ENV === "sandbox" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol === "http:")) {
      throw createError(503, "bKash payment is currently unavailable");
    }
  }
  return {
    baseUrl: `https://tokenized.${process.env.BKASH_ENV === "live" ? "pay" : "sandbox"}.bka.sh/v2/tokenized-checkout`,
    appKey: process.env.BKASH_APP_KEY.trim(), appSecret: process.env.BKASH_APP_SECRET.trim(),
    username: process.env.BKASH_USERNAME.trim(), password: process.env.BKASH_PASSWORD.trim(),
    callbackUrl, storefrontUrl,
  };
};

const request = async (config, path, body, headers = {}) => {
  try {
    const response = await fetch(`${config.baseUrl}/${path}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok || data.externalCode || (data.statusCode && data.statusCode !== "0000")) {
      throw createError(502, "bKash could not complete this request. Please try again.");
    }
    return data;
  } catch (error) {
    if (error.status) throw error;
    throw createError(502, "Unable to confirm bKash payment right now. Check payment status before trying again.");
  }
};

const getToken = async (config) => {
  const key = crypto.createHash("sha256").update(`${config.baseUrl}:${config.appKey}`).digest("hex");
  // A database lease prevents parallel cold starts from exhausting bKash's token quota.
  try {
    await PaymentToken.updateOne({ _id: key }, { $setOnInsert: { lockUntil: new Date(0), nextAttemptAt: new Date(0) } }, { upsert: true });
  } catch (error) { if (error.code !== 11000) throw error; }
  const cached = await PaymentToken.findById(key);
  if (cached?.idToken && cached.expiresAt > new Date(Date.now() + 5 * 60 * 1000)) return cached.idToken;
  const leased = await PaymentToken.findOneAndUpdate(
    { _id: key, lockUntil: { $lte: new Date() }, nextAttemptAt: { $lte: new Date() } },
    { $set: { lockUntil: new Date(Date.now() + 45000), nextAttemptAt: new Date(Date.now() + 30 * 60 * 1000) } },
    { new: true }
  );
  if (!leased) {
    // A still-valid token can be used while another instance refreshes it.
    if (cached?.idToken && cached.expiresAt > new Date(Date.now() + 30000)) return cached.idToken;
    throw createError(503, "bKash is getting ready. Please try again shortly.");
  }
  try {
    const refresh = leased.refreshToken && leased.refreshExpiresAt > new Date();
    const data = await request(config, refresh ? "auth/refresh-token" : "auth/grant-token", {
      app_key: config.appKey, app_secret: config.appSecret,
      ...(refresh ? { refresh_token: leased.refreshToken } : {}),
    }, { username: config.username, password: config.password });
    if (!data.id_token || !data.refresh_token) throw createError(502, "bKash authentication is unavailable");
    await PaymentToken.updateOne({ _id: key }, { $set: {
      idToken: data.id_token, refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + Number(data.expires_in || 3600) * 1000),
      refreshExpiresAt: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000), lockUntil: new Date(0),
    } });
    return data.id_token;
  } finally {
    await PaymentToken.updateOne({ _id: key }, { $set: { lockUntil: new Date(0) } });
  }
};

const call = async (path, body) => {
  const config = getConfig();
  const token = await getToken(config);
  return request(config, path, body, { Authorization: `Bearer ${token}`, "X-App-Key": config.appKey });
};

const isCheckoutUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname.endsWith(".bkash.com") || url.hostname.endsWith(".bka.sh"));
  } catch { return false; }
};

const validateCompletedPayment = (order, result) => {
  const invoice = result.merchantInvoiceNumber || result.merchantInvoice;
  if (result.transactionStatus !== "Completed" || result.paymentId !== order.bkash.paymentId ||
      result.currency !== "BDT" || result.intent !== "sale" ||
      !Number.isFinite(Number(result.amount)) || Math.abs(Number(result.amount) - order.paymentAmount) > 0.001 ||
      invoice !== String(order.orderNumber) || !result.trxId) {
    throw createError(502, "bKash payment details do not match this order. Please contact support.");
  }
};

module.exports = { getConfig, call, isCheckoutUrl, validateCompletedPayment };
