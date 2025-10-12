const mongoose = require("mongoose");

const variantSchema = new mongoose.Schema({
  sku: { type: String, required: true },
  price: { type: Number, required: true },
  discountPrice: { type: Number },
  discountStartDate: { type: Date },
  discountEndDate: { type: Date },
  stock: { type: Number, required: true },
  availability: { type: Boolean, default: true },
  attributes: {
    type: Map,
    of: String,
  },
});

const ProductSchema = new mongoose.Schema(
  {
    productName: { type: String, required: true, trim: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    images: [{ type: String, default: null }],
    brand: { type: mongoose.Schema.Types.ObjectId, ref: "Brand" },
    description: { type: String, required: true },
    shortDescription: { type: String, default: null },
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
    status: {
      type: String,
      enum: ["published", "unpublished"],
      default: "unpublished",
    },

    // SEO
    seoTitle: { type: String, required: true },
    seoContent: { type: String, required: true },
    // Attributes
    attributes: [
      {
        name: { type: String, required: true },
        values: [{ type: String }],
      },
    ],
    variants: [variantSchema],
  },
  { timestamps: true, versionKey: false }
);
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
module.exports = mongoose.model("Product", ProductSchema);
