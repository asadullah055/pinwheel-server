const { z, LIMITS, text, objectId, money, stock, phone, richText, safeTargetUrl, imageUrl, parse, jsonField, numericText, optionalNumericText, dateText, unsafeKey } = require("./inputSecurity");

const decimal = (schema) => z.union([schema, numericText(schema)]);
const optionalMoney = z.union([z.literal(""), z.null(), decimal(money)]).optional();
const attributeName = text(50, 1).refine((name) => !unsafeKey(name) && !["_id", "sku", "price", "discountPrice", "discountStartDate", "discountEndDate", "stock", "availability", "attributes"].includes(name), "Invalid attribute name");
const attribute = z.object({ _id: objectId.optional(), name: attributeName, values: z.array(text(120, 1)).min(1).max(100).refine((v) => new Set(v).size === v.length, "Duplicate attribute values") }).strict();
const attributes = z.array(attribute).max(10).refine((v) => new Set(v.map((a) => a.name)).size === v.length, "Duplicate attribute names");
const variant = z.object({
  _id: objectId.optional(), sku: text(150).optional(), price: decimal(money.refine((n) => n > 0, "Price must be positive")),
  stock: decimal(stock), discountPrice: optionalMoney,
  discountStartDate: dateText.nullable().optional(), discountEndDate: dateText.nullable().optional(),
  availability: z.boolean().optional(), attributes: z.record(attributeName, text(120, 1)).optional(),
}).catchall(text(120, 1)).superRefine((v, ctx) => {
  if (typeof v.discountPrice === "number" && v.discountPrice > 0 && v.discountPrice >= v.price) ctx.addIssue({ code: "custom", path: ["discountPrice"], message: "Discount must be less than price" });
  const start = v.discountStartDate, end = v.discountEndDate;
  if (Boolean(start) !== Boolean(end) || (start && (!v.discountPrice || new Date(end) < new Date(start)))) ctx.addIssue({ code: "custom", path: ["discountStartDate"], message: "Provide a discount and a valid start/end period" });
});
const productFields = {
  productName: text(200, 1), description: richText(true), shortDescription: richText().optional(), category: objectId, brand: objectId,
  slug: z.string().max(250).regex(/^[a-z\d-]*$/).optional(),
  weight: optionalNumericText(z.number().finite().positive().max(100000)),
  length: optionalNumericText(z.number().finite().positive().max(100000)),
  width: optionalNumericText(z.number().finite().positive().max(100000)),
  height: optionalNumericText(z.number().finite().positive().max(100000)),
  shippingInsideDhaka: optionalNumericText(money), shippingOutsideDhaka: optionalNumericText(money),
  warrantyType: z.enum(["no warranty", "brand warranty", "seller warranty"]).optional(), warrantyTime: text(80).optional(), warrantyPolicy: text(2000).optional(),
  status: z.enum(["published", "unpublished"]).optional(), seoTitle: text(200).optional(), seoContent: text(1000).optional(),
  attributes: jsonField(attributes).optional(), variants: jsonField(z.array(variant).min(1).max(LIMITS.variants)),
  existingImages: jsonField(z.array(z.string().transform((url) => url.replace(/^http:\/\/res\.cloudinary\.com\//, "https://res.cloudinary.com/")).pipe(imageUrl)).max(LIMITS.images).refine((v) => new Set(v).size === v.length, "Duplicate images")).optional(),
};
const productCreate = z.object(productFields).strict();
const productUpdate = productCreate.partial().refine((fields) => Object.keys(fields).length > 0, "Provide product fields to update");
const taxonomy = z.object({ name: text(120, 1), status: z.enum(["active", "inactive"]).optional() }).strict();
const banner = z.object({ bannerType: z.enum(["main", "side"]), targetUrl: safeTargetUrl, priority: numericText(z.number().int().min(0).max(10000)).optional(), startDate: dateText.optional(), endDate: dateText.optional(), isActive: z.enum(["true", "false"]).optional() }).strict();
const seller = z.object({
  name: text(120, 1), shopName: text(150, 1), mobileNumber: phone, shopLocation: text(1000, 1), holidayMode: z.enum(["true", "false"]).optional(),
  holidayStartDate: dateText.optional(), holidayEndDate: dateText.optional(),
  nationalIdentityCardNo: z.string().regex(/^(?:\d{10}|\d{13}|\d{17})?$/, "NID must have 10, 13 or 17 digits").optional(),
  bankAccountName: text(150).optional(), bankAccountNumber: z.string().regex(/^[0-9 -]{0,34}$/).optional(), bankNameOrMfs: text(150).optional(), bankRoutingNumber: z.string().regex(/^(?:\d{9})?$/, "Routing number must have nine digits").optional(), bankBranchName: text(150).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.holidayMode === "true" && (!v.holidayStartDate || !v.holidayEndDate || new Date(v.holidayEndDate) < new Date(v.holidayStartDate))) ctx.addIssue({ code: "custom", path: ["holidayStartDate"], message: "Provide a valid holiday period" });
});
const schemas = { productCreate, productUpdate, taxonomyCreate: taxonomy, taxonomyUpdate: taxonomy, bannerCreate: banner, bannerUpdate: banner.partial(), seller, image: z.object({}).strict() };
const variantKeys = new Set(["_id", "sku", "price", "discountPrice", "discountStartDate", "discountEndDate", "stock", "availability", "attributes"]);
const validateFormFields = (kind, raw, existing) => {
  const fields = parse(schemas[kind], raw);
  if (kind.startsWith("banner")) {
    const start = fields.startDate === undefined ? existing?.startDate : fields.startDate;
    const end = fields.endDate === undefined ? existing?.endDate : fields.endDate;
    if (end && (!start || new Date(end) < new Date(start))) throw require("http-errors")(400, "Banner end date must follow its start date");
  }
  if (kind.startsWith("product")) {
    const declared = fields.attributes || existing?.attributes || [];
    const allowed = new Map(declared.map((a) => [a.name, a.values]));
    if (fields.variants) {
      const seenIds = new Set(), seenSkus = new Set(), seenCombinations = new Set();
      fields.variants = fields.variants.map((row) => {
        if (kind === "productCreate" && row._id) throw require("http-errors")(400, "New variants must not specify an ID");
        if (row._id && seenIds.has(row._id)) throw require("http-errors")(400, "Duplicate variant ID");
        if (row.sku && seenSkus.has(row.sku)) throw require("http-errors")(400, "Duplicate variant SKU");
        if (row._id) seenIds.add(row._id);
        if (row.sku) seenSkus.add(row.sku);
        const values = { ...row.attributes };
        for (const [key, value] of Object.entries(row)) {
          if (variantKeys.has(key)) continue;
          if (!allowed.has(key) || (values[key] !== undefined && values[key] !== value)) throw require("http-errors")(400, "Unexpected variant attribute");
          values[key] = value;
          delete row[key];
        }
        for (const [key, value] of Object.entries(values)) {
          if (!allowed.has(key) || !allowed.get(key).includes(value)) throw require("http-errors")(400, "Variant attributes must match the product attributes");
        }
        if (Object.keys(values).length !== allowed.size) throw require("http-errors")(400, "Each variant must include all product attributes");
        const combination = JSON.stringify([...allowed.keys()].map((key) => values[key]));
        if (seenCombinations.has(combination)) throw require("http-errors")(400, "Duplicate variant attributes");
        seenCombinations.add(combination);
        return { ...row, attributes: values };
      });
    } else if (fields.attributes && existing) {
      // Do not let an attributes-only edit invalidate the retained variants.
      for (const row of existing.variants || []) {
        if (row.availability === false) continue;
        const values = row.attributes instanceof Map ? Object.fromEntries(row.attributes) : row.attributes || {};
        if (Object.keys(values).length !== allowed.size || Object.entries(values).some(([key, value]) => !allowed.get(key)?.includes(value))) throw require("http-errors")(400, "Update variants together with changed attributes");
      }
    }
    for (const key of ["attributes", "variants", "existingImages"]) if (fields[key] !== undefined) fields[key] = JSON.stringify(fields[key]);
  }
  return fields;
};
module.exports = { validateFormFields };
