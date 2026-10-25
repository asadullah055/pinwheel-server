const crypto = require("crypto");
const createError = require("http-errors");
const RequestLimit = require("../model/RequestLimit");

// Fixed windows are persisted in MongoDB so cold starts and separate instances
// share the same counters. Expired windows are removed by a TTL index.
const consume = async (scope, identity, max, windowMs) => {
  const bucket = Math.floor(Date.now() / windowMs);
  const id = crypto.createHash("sha256").update(`${scope}:${identity}:${bucket}`).digest("hex");
  const expiresAt = new Date((bucket + 1) * windowMs);
  let counter;
  const write = () => RequestLimit.findOneAndUpdate({ _id: id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt } }, { new: true, upsert: true }).lean();
  try { counter = await write(); }
  catch (error) { if (error.code !== 11000) throw error; counter = await write(); }
  return { allowed: counter.count <= max, retryAfter: Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000)) };
};
const createRequestLimiter = (store = consume) => async (req, res, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress;
    const path = req.path.toLowerCase().replace(/\/+/g, "/").replace(/\/+$/, "");
    const rules = [["api", ip, 600, 60000]];
    if (/^\/auth\/(?:login|register|forgot-password|send-otp|verify-otp|reset-password)$/.test(path)) {
      rules.push(["auth:" + path, ip, 30, 15 * 60000]);
      if (typeof req.body?.email === "string") rules.push(["account:" + path, req.body.email.trim().toLowerCase(), 30, 15 * 60000]);
    }
    if (path === "/order/create") rules.push(["checkout", ip, 20, 15 * 60000]);
    if (path.endsWith("/invoice")) rules.push(["invoice", ip, 20, 60000]);
    if (path === "/product/images" || path.endsWith("/create") || (req.is("multipart/form-data") && req.method !== "GET")) rules.push(["uploads", ip, 60, 15 * 60000]);
    for (const rule of rules) {
      const result = await store(...rule);
      if (!result.allowed) {
        res.set("Retry-After", String(result.retryAfter));
        return next(createError(429, "Too many requests. Please try again later"));
      }
    }
    next();
  } catch { next(createError(503, "Request protection is temporarily unavailable")); }
};
module.exports = { consume, createRequestLimiter };
