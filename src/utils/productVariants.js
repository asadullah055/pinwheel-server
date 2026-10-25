const mongoose = require("mongoose");
const createError = require("http-errors");

// Keep references held by carts and orders, including variants removed from the form.
const reconcileVariants = (incoming, existing = []) => {
  const byId = new Map(existing.map((v) => [String(v._id), v]));
  const bySku = new Map(existing.map((v) => [v.sku, v]));
  const seen = new Set();
  const result = incoming.map((variant) => {
    let original;
    if (variant._id) {
      if (!mongoose.isObjectIdOrHexString(variant._id) || !byId.has(String(variant._id))) {
        throw createError(400, "Variant does not belong to this product");
      }
      original = byId.get(String(variant._id));
    } else if (variant.sku && bySku.has(variant.sku)) {
      // Support an already-open dashboard using the previous serialization format.
      original = bySku.get(variant.sku);
    }
    if (!original) return variant;
    const id = String(original._id);
    if (seen.has(id)) throw createError(400, "Duplicate variant");
    seen.add(id);
    return { ...variant, _id: original._id };
  });
  for (const variant of existing) {
    if (!seen.has(String(variant._id))) {
      const retained = typeof variant.toObject === "function" ? variant.toObject() : { ...variant };
      result.push({ ...retained, availability: false });
    }
  }
  return result;
};
module.exports = { reconcileVariants };
