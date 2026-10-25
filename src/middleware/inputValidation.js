const createError = require("http-errors");
const { z, LIMITS, text, objectId, money, stock, password, email, phone, token, parse, assertSafeStructure } = require("../utils/inputSecurity");

const empty = z.object({}).strict();
const pageNumber = (max) => z.string().regex(/^[1-9]\d{0,5}$/).transform(Number).pipe(z.number().int().max(max));
const pagination = { page: pageNumber(10000).optional(), limit: pageNumber(100).optional() };
const idParams = z.object({ id: objectId }).strict();
const statuses = ["Pending", "Processing", "Confirm", "Shipped", "Delivered", "Cancelled", "Returned", "Refunded", "Failed", "Completed", "Awaiting Payment"];
const customer = z.object({ name: text(120, 1), phone, email: email.nullable().optional() }).strict();
const addressFields = Object.fromEntries(["fullAddress", "street", "addressLine", "displayAddress", "address", "city", "state", "postalCode", "country", "division", "district", "upazila", "area"].map((key) => [key, text(key === "fullAddress" || key.includes("Address") || key === "address" || key === "street" || key === "addressLine" ? 1000 : 100).optional()]));
const address = z.object(addressFields).strict().refine((value) => [value.fullAddress, value.street, value.addressLine, value.displayAddress, value.address].some(Boolean), "Shipping address is required");
const orderItem = z.object({ product: objectId, variant: objectId.optional(), variantId: objectId.optional(), quantity: z.number().int().min(1).max(LIMITS.quantity) }).strict()
  .refine((item) => !(item.variant && item.variantId && item.variant !== item.variantId), "Conflicting variant IDs");
const createOrderBody = z.object({
  items: z.array(orderItem).min(1).max(100), shippingAddress: address,
  paymentMethod: z.enum(["Cash on Delivery", "bKash"]), paymentPlan: z.enum(["COD", "Full", "Advance"]).optional(),
  customer: customer.optional(), shippingFee: money.default(0), expectedTotal: money.optional(),
  checkoutRequestId: z.string().uuid({ version: "v4" }).optional(),
  checkoutAccessToken: z.string().regex(/^[a-f\d]{64}$/).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.checkoutRequestId && !value.checkoutAccessToken) ctx.addIssue({ code: "custom", path: ["checkoutAccessToken"], message: "Checkout access token is required" });
  if (!value.checkoutRequestId && value.checkoutAccessToken) ctx.addIssue({ code: "custom", path: ["checkoutRequestId"], message: "Checkout request ID is required" });
  if (value.paymentMethod === "bKash" && (!value.checkoutRequestId || value.expectedTotal === undefined || !["Full", "Advance"].includes(value.paymentPlan))) ctx.addIssue({ code: "custom", path: ["paymentPlan"], message: "bKash checkout details are required" });
  if (value.paymentMethod === "Cash on Delivery" && value.paymentPlan && value.paymentPlan !== "COD") ctx.addIssue({ code: "custom", path: ["paymentPlan"], message: "Invalid cash-on-delivery plan" });
});
const quickVariant = z.object({ _id: objectId, price: money.refine((n) => n > 0).optional(), discountPrice: money.optional(), stock: stock.optional(), availability: z.boolean().optional() }).strict();
const callbackQuery = z.object({
  orderId: objectId, state: z.string().regex(/^[a-f\d]{64}$/), signature: z.string().min(1).max(512).regex(/^[a-z\d+/=_-]+$/i),
  paymentID: z.string().min(1).max(150).regex(/^[a-z\d_-]+$/i).optional(), paymentId: z.string().min(1).max(150).regex(/^[a-z\d_-]+$/i).optional(), status: z.enum(["success", "cancel", "failure"]),
}).strict().refine((q) => Boolean(q.paymentID || q.paymentId) && !(q.paymentID && q.paymentId && q.paymentID !== q.paymentId), "Invalid payment ID");
const contracts = {
  empty: {}, id: { params: idParams },
  register: { body: z.object({ name: text(120, 1), email, password, role: z.literal("seller").optional() }).strict() },
  login: { body: z.object({ email, password: z.string().min(1).max(1024).refine((p) => !p.includes("\0")) }).strict() },
  email: { body: z.object({ email }).strict() },
  otp: { body: z.object({ email, otp: z.string().regex(/^\d{6}$/) }).strict() },
  resetPassword: { body: z.object({ email, otp: z.string().regex(/^\d{6}$/), newPassword: password }).strict() },
  changePassword: { body: z.object({ oldPassword: z.string().min(1).max(1024), newPassword: password, confirmPassword: password }).strict().refine((p) => p.newPassword === p.confirmPassword, "Passwords do not match") },
  profile: { body: z.object({ name: text(120, 1) }).strict() },
  multipart: { multipart: true }, multipartId: { multipart: true, params: idParams },
  list: { query: z.object(pagination).strict() },
  products: { query: z.object({ ...pagination, sku: text(100).optional(), status: z.enum(["published", "unpublished"]).optional() }).strict() },
  publicProducts: { query: z.object({ ...pagination, category: objectId.optional(), search: text(100).optional(), q: text(100).optional() }).strict() },
  slug: { params: z.object({ slug: z.string().min(1).max(250).regex(/^[a-z\d-]+$/) }).strict() },
  productStatus: { params: idParams, body: z.object({ status: z.enum(["published", "unpublished"]) }).strict() },
  quickProduct: { body: z.object({ id: objectId, variants: z.array(quickVariant).min(1).max(LIMITS.variants) }).strict().refine((v) => new Set(v.variants.map((row) => row._id)).size === v.variants.length, "Duplicate variants") },
  banners: { query: z.object({ ...pagination, bannerType: z.enum(["main", "side"]).optional() }).strict() },
  priorities: { body: z.object({ banners: z.array(z.object({ id: objectId, priority: z.number().int().min(0).max(10000) }).strict()).min(1).max(100) }).strict().refine((v) => new Set(v.banners.map((b) => b.id)).size === v.banners.length, "Duplicate banners") },
  cart: { body: z.object({ productId: objectId, quantity: z.number().int().min(1).max(LIMITS.quantity).default(1) }).strict() },
  order: { body: createOrderBody },
  payment: { params: idParams, body: z.object({ token: token.optional() }).strict() },
  invoice: { params: idParams, query: z.object({ token: token.optional() }).strict() },
  orderStatus: { params: idParams, body: z.object({ status: z.enum(statuses) }).strict() },
  itemStatus: { params: z.object({ orderId: objectId, itemId: objectId }).strict(), body: z.object({ status: z.enum(statuses) }).strict() },
  callback: { query: callbackQuery },
  dashboard: { query: z.object({ range: z.enum(["today", "7d", "30d", "month"]).optional() }).strict() },
};
const validateRequest = (name) => {
  const contract = contracts[name];
  if (!contract) throw new Error("Unknown input contract: " + name);
  return (req, res, next) => {
    try {
      const query = parse(contract.query || empty, req.query);
      Object.defineProperty(req, "query", { value: query, writable: true, configurable: true });
      req.params = parse(contract.params || empty, req.params);
      if (contract.multipart) {
        if (!req.is("multipart/form-data")) throw createError(415, "Use multipart/form-data");
      } else {
        if (contract.body && !req.is("application/json")) throw createError(415, "Use application/json");
        req.body = parse(contract.body || empty, req.body === undefined ? {} : req.body);
      }
      next();
    } catch (error) { next(error); }
  };
};
const rejectUnsafeInput = (req, res, next) => {
  try {
    if (req.originalUrl.length > 8192) throw createError(414, "Request URL is too long");
    assertSafeStructure(req.query);
    assertSafeStructure(req.body);
    next();
  } catch (error) { next(error); }
};
module.exports = { validateRequest, rejectUnsafeInput, contracts, createOrderBody };
