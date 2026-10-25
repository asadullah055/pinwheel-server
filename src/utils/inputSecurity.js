const { z } = require("zod");
const createError = require("http-errors");
const DOMPurify = require("isomorphic-dompurify");

const LIMITS = Object.freeze({ price: 100000000, stock: 1000000, quantity: 1000, variants: 500, images: 8 });
const unsafeKey = (key) => key.startsWith("$") || /[.\[\]]/.test(key) || ["__proto__", "constructor", "prototype"].includes(key);
const assertSafeStructure = (value, depth = 0, state = { count: 0 }) => {
  if (depth > 8 || ++state.count > 12000) throw createError(400, "Input is too complex");
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (value.length > 500) throw createError(400, "Too many input items");
  } else if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw createError(400, "Invalid input object");
  }
  for (const [key, child] of Object.entries(value)) {
    if (unsafeKey(key)) throw createError(400, "Input contains an unsupported field");
    assertSafeStructure(child, depth + 1, state);
  }
};
const text = (max, min = 0) => z.string().trim().min(min).max(max)
  .refine((value) => !/[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value), "Use plain text without control characters or HTML");
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "A valid ObjectId string is required").transform((value) => value.toLowerCase());
const money = z.number().finite().min(0).max(LIMITS.price).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, "Use at most two decimal places");
const stock = z.number().int().min(0).max(LIMITS.stock);
const password = z.string().min(8).max(72).refine((value) => !value.includes("\0") && Buffer.byteLength(value, "utf8") <= 72, "Password must fit within 72 UTF-8 bytes");
const email = z.string().trim().max(254).email().transform((value) => value.toLowerCase());
const phone = z.string().trim().regex(/^\+?[0-9][0-9 -]{6,19}$/, "Enter a valid phone number");
const token = z.string().regex(/^[a-f\d]{48}$/, "Invalid order access token");
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const sanitizeRichText = (value) => DOMPurify.sanitize(value, {
  ALLOWED_TAGS: ["p", "br", "div", "span", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "blockquote", "h2", "h3", "h4", "table", "thead", "tbody", "tr", "th", "td", "a", "hr"],
  ALLOWED_ATTR: ["href", "title", "colspan", "rowspan"],
  ADD_URI_SAFE_ATTR: ["colspan", "rowspan"],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:https:\/\/|mailto:|\/(?!\/)|#)/i,
});
const richText = (required = false) => z.string().max(100000)
  .refine((value) => !value.includes("\0"), "Invalid HTML content")
  .transform(sanitizeRichText)
  .refine((value) => !required || DOMPurify.sanitize(value, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim().length > 0, "Description is required");

const safeTargetUrl = z.string().trim().max(2048).refine((value) => {
  if (/[\s\\\u0000-\u001F\u007F]/u.test(value)) return false;
  if (/^\/(?!\/)/.test(value)) return true;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
  catch { return false; }
}, "Use a secure HTTPS URL or an internal path");
const imageUrl = z.string().max(2048).refine((value) => {
  if (/[\s\\\u0000-\u001F\u007F]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com" && !url.username && !url.password && !url.search && !url.hash && !url.port && /\/image\/upload\//.test(url.pathname);
  } catch { return false; }
}, "Use a verified Cloudinary image");

const parse = (schema, value) => {
  assertSafeStructure(value);
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = createError(400, "Invalid input");
    error.details = result.error.issues.slice(0, 10).map((issue) => ({ field: issue.path.join("."), message: issue.code === "unrecognized_keys" ? "Unexpected field" : issue.message }));
    const first = error.details[0];
    error.message = first.field ? first.field + ": " + first.message : first.message;
    throw error;
  }
  return result.data;
};
const jsonField = (schema) => z.string().max(300000).transform((value, ctx) => {
  try { return parse(schema, JSON.parse(value)); }
  catch { ctx.addIssue({ code: "custom", message: "Invalid JSON field" }); return z.NEVER; }
});
const numericText = (schema) => z.string().trim().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Enter a complete decimal number").transform(Number).pipe(schema);
const optionalNumericText = (schema) => z.union([z.literal(""), numericText(schema)]).optional();
const dateText = z.string().max(35).refine((value) => {
  if (value === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10);
}, "Enter a valid ISO date");

module.exports = { z, LIMITS, unsafeKey, assertSafeStructure, text, objectId, money, stock, password, email, phone, token, escapeRegex, sanitizeRichText, richText, safeTargetUrl, imageUrl, parse, jsonField, numericText, optionalNumericText, dateText };
