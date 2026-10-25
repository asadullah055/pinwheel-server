const mongoose = require("mongoose");
const { LIMITS, sanitizeRichText } = require("../utils/inputSecurity");

const variantSchema = new mongoose.Schema({
  sku: { type: String, required: true, maxlength: 150 },
  price: { type: Number, required: true, min: 0.01, max: LIMITS.price, validate: Number.isFinite },
  discountPrice: { type: Number, min: 0, max: LIMITS.price, validate: Number.isFinite },
  discountStartDate: { type: Date },
  discountEndDate: { type: Date },
  stock: { type: Number, required: true, min: 0, max: LIMITS.stock, validate: Number.isSafeInteger },
  availability: { type: Boolean, default: true },
  attributes: {
    type: Map,
    of: String,
  },
});

const ProductSchema = new mongoose.Schema(
  {
    productName: { type: String, required: true, trim: true, maxlength: 200 },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (images) => images.length <= 8,
        message: "A product can have a maximum of 8 images",
      },
    },
    brand: { type: mongoose.Schema.Types.ObjectId, ref: "Brand" },
    description: { type: String, required: true, maxlength: 100000 },
    shortDescription: { type: String, default: null, maxlength: 100000 },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    slug: { type: String, default: "" },
    // Dimensions
    weight: { type: Number },
    length: { type: Number },
    width: { type: Number },
    height: { type: Number },
    sku: { type: String, unique: true },
    // Warranty
    warrantyType: { type: String },
    warrantyTime: { type: String },
    warrantyPolicy: { type: String },
    shippingCharge: {
      insideDhaka: { type: Number, default: 80 },
      outsideDhaka: { type: Number, default: 120 },
    },
    status: {
      type: String,
      enum: ["published", "unpublished"],
      default: "unpublished",
    },

    // SEO
    seoTitle: { type: String, default: "" },
    seoContent: { type: String, default: "" },
    // Attributes
    attributes: [
      {
        name: { type: String, required: true },
        values: [{ type: String }],
      },
    ],
    variants: { type: [variantSchema], validate: (rows) => rows.length > 0 && rows.length <= LIMITS.variants },
  },
  { timestamps: true, optimisticConcurrency: true }
);
ProductSchema.pre("validate", function (next) {
  if (this.isModified("description") && typeof this.description === "string") this.description = sanitizeRichText(this.description);
  if (this.isModified("shortDescription") && typeof this.shortDescription === "string") this.shortDescription = sanitizeRichText(this.shortDescription);
  next();
});
ProductSchema.pre("save", function (next) {
  if (this.isModified("productName")) {
    this.slug = this.productName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }
  next();
});

ProductSchema.pre("updateOne", function (next) {
  if (this._update.productName) {
    this._update.slug = this._update.productName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
  }
  next();
});

ProductSchema.pre("findOneAndUpdate", function (next) {
  if (this._update.productName) {
    this._update.slug = this._update.productName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
  }
  next();
});
// Auto-generate slug and SKU before saving
/* ProductSchema.pre("save", async function (next) {
  if (this.isModified("title")) {
    this.slug = this.title.toLowerCase().replace(/ /g, "-");
  }

  if (!this.sku) {
    let newSKU;
    let exists = true;
    let attempts = 0; // ➡️ Count how many times we tried
    const maxAttempts = 5; // ➡️ Set maximum allowed retries

    while (exists && attempts < maxAttempts) {
      newSKU = generateSKU();
      const existingProduct = await mongoose.models.Product.findOne({
        sku: newSKU,
      });
      if (!existingProduct) {
        exists = false;
      } else {
        attempts++;
      }
    }

    if (exists) {
      return next(
        new Error("Failed to generate a unique SKU. Please try again.")
      ); 
    }
    this.sku = newSKU;
  }

  next();
}); */

ProductSchema.index(
  {
    title: "text",
    description: "text",
    "category.name": "text",
    "brand.name": "text",
  },
  {
    weights: {
      title: 5,
      description: 2,
      "category.name": 3,
      "brand.name": 4,
    },
  }
);
ProductSchema.index({ creator: 1, status: 1, createdAt: -1 });
ProductSchema.index({ status: 1, createdAt: -1, _id: -1 });
ProductSchema.index({ status: 1, category: 1, createdAt: -1, _id: -1 });
ProductSchema.index({ slug: 1, status: 1 });
module.exports = mongoose.model("Product", ProductSchema);
