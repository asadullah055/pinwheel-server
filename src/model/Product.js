const mongoose = require("mongoose");
const { MetaDataSchema } = require("./MetaData");
const generateSKU = require("../utils/skuGenerator");

const discountSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["percentage", "fixed"],
      required: true,
    },
    value: {
      type: Number,
      required: true,
    },
  },
  {
    _id: false,
    versionKey: false,
  }
);

const ProductSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    images: [{ type: String, default: null }],
    brand: { type: mongoose.Schema.Types.ObjectId, ref: "Brand" },
    description: { type: String, required: true },
    shortDescription: { type: String, default: null },
    regularPrice: { type: Number, required: true },
    stock: { type: Number, default: 0 },
    discountPrice: { type: Number, default: null },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    slug: { type: String, default: "" },
    packageHeight: { type: String, default: null },
    packageWeight: { type: String, default: null },
    packageWidth: { type: String, default: null },
    packageLength: { type: String, default: null },
    sku: { type: String,  unique: true }, 
    warrantyPolicy: { type: String, default: null },
    warrantyTime: { type: String, default: null },
    warrantyType: { type: String, default: null },
    status: {
      type: String,
      enum: ["published", "unpublished"],
      default: "unpublished",
    },
    metaData: {
      type: MetaDataSchema,
      default: {},
    },
  },
  { timestamps: true, versionKey: false }
);
ProductSchema.pre("save", function (next) {
  if (this.isModified("title")) {
    this.slug = this.title.toLowerCase().replace(/ /g, "-");
  }
  next();
});
ProductSchema.pre("updateOne", function (next) {
  if (this._update.title) {
    this._update.slug = this._update.title.toLowerCase().replace(/ /g, "-");
  }
  next();
});
ProductSchema.pre("findOneAndUpdate", function (next) {
  if (this._update.title) {
    this._update.slug = this._update.title.toLowerCase().replace(/ /g, "-");
  }
  next();
});
// Auto-generate slug and SKU before saving
ProductSchema.pre("save", async function (next) {
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
      const existingProduct = await mongoose.models.Product.findOne({ sku: newSKU });
      if (!existingProduct) {
        exists = false;
      } else {
        attempts++;
      }
    }

    if (exists) {
      return next(new Error("Failed to generate a unique SKU. Please try again.")); // Friendly error if all retries fail
    }

    this.sku = newSKU;
  }

  next();
});

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
module.exports = mongoose.model("Product", ProductSchema);
